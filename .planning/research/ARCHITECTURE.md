# Architecture Patterns

**Domain:** AI-powered IRC trivia bot (Node.js, Undernet)
**Researched:** 2026-03-28
**Confidence:** HIGH (core patterns well-established; AI evaluation layer is novel combination)

---

## Recommended Architecture

Five discrete components with strict ownership boundaries. No component reaches across its boundary into another's internal state.

```
┌─────────────────────────────────────────────────────────┐
│                     IRC Layer                           │
│  (irc-framework: connect, send, receive, reconnect)     │
└───────────────┬─────────────────────────────────────────┘
                │ raw IRC events (message, join, part, nick)
                ▼
┌─────────────────────────────────────────────────────────┐
│                  Command Handler                        │
│  (parse !commands, auth owner by nick, route to engine) │
└───────────────┬─────────────────────────────────────────┘
                │ structured commands (start, stop, score, etc.)
                ▼
┌─────────────────────────────────────────────────────────┐
│              Game Engine  (per-channel Map)             │
│  (state machine: IDLE → ASKING → JUDGING → SCORED)      │
│  (timers, round tracking, answer queue)                 │
└──────────┬────────────────────────┬────────────────────┘
           │ question request        │ answer check request
           ▼                        ▼
┌──────────────────┐    ┌──────────────────────────────────┐
│    AI Layer      │    │           AI Layer               │
│  (generate Q)   │    │  (evaluate answer correctness)   │
│  Claude API      │    │  Claude API                      │
└──────────────────┘    └──────────────────────────────────┘
           │ question + answer key   │ correct/incorrect + explanation
           └────────────┬───────────┘
                        │ game events (correct, timeout, round-end)
                        ▼
┌─────────────────────────────────────────────────────────┐
│              Persistence Layer                          │
│  (scores, session state — better-sqlite3)               │
└─────────────────────────────────────────────────────────┘
```

---

## Component Boundaries

| Component | Owns | Exposes | Does NOT touch |
|-----------|------|---------|----------------|
| **IRC Layer** | TCP connection, reconnect logic, flood control | `on(event, cb)`, `say(channel, text)`, `join(channel)`, `part(channel)` | Game state, commands, AI |
| **Command Handler** | Command parsing, owner auth, command routing | `register(cmd, handler)`, command dispatch | Game state, IRC details, AI |
| **Game Engine** | Per-channel state machines, timers, round lifecycle | `start(channel)`, `stop(channel)`, `submitAnswer(channel, nick, text)`, events | IRC directly, AI directly |
| **AI Layer** | Claude API calls, prompt construction, response parsing | `generateQuestion(topic, difficulty)`, `evaluateAnswer(question, answer, attempt)` | IRC, game state, scores |
| **Persistence Layer** | SQLite reads/writes, score aggregation | `addScore(nick, channel, pts)`, `getScores(channel)`, `getLeaderboard(channel, limit)` | IRC, game logic, AI |

---

## Data Flow

### Question Generation Flow

```
owner issues !trivia start
  → Command Handler validates owner nick
  → Command Handler calls GameEngine.start(channel)
  → GameEngine transitions channel state: IDLE → ASKING
  → GameEngine calls AILayer.generateQuestion(topic, difficulty)
  → AILayer calls Claude API (async, awaited)
  → AILayer returns { question, answer, hint? }
  → GameEngine stores answer internally (never sent to IRC)
  → GameEngine via event "question:ready" → Command Handler → IRC Layer → channel
  → GameEngine starts timeout timer
```

### Answer Evaluation Flow

```
player types message in channel
  → IRC Layer emits "message" event
  → Command Handler: not a !command → GameEngine.submitAnswer(channel, nick, text)
  → GameEngine: state must be ASKING (else ignored)
  → GameEngine calls AILayer.evaluateAnswer(question, storedAnswer, playerText)
  → AILayer calls Claude API (async, awaited)
  → AILayer returns { correct: bool, normalized: string }
  → if correct:
      GameEngine transitions: ASKING → SCORED
      GameEngine emits "answer:correct" { nick, channel }
      Persistence.addScore(nick, channel, 1)
      IRC Layer announces correct answer + score
      GameEngine schedules next question or ends round
  → if incorrect:
      GameEngine stays in ASKING state
      IRC Layer: silent (no "wrong answer" spam) OR soft hint
```

### Timeout Flow

```
GameEngine timer fires while state = ASKING
  → GameEngine emits "question:timeout" { channel, answer }
  → IRC Layer announces correct answer
  → GameEngine transitions: ASKING → IDLE (or next question)
```

---

## State Machine (per channel)

Each active channel gets one `ChannelGame` instance managing an independent state machine.

```
IDLE
  ─── start command ──→ ASKING
                           │
                    answer received ──→ JUDGING (AI call in flight)
                           │                │
                    timeout fires           ├─ correct ──→ SCORED ──→ IDLE (or ASKING if rounds remain)
                                            └─ incorrect ──→ ASKING (back to waiting)
```

States:

| State | Meaning | Valid Transitions |
|-------|---------|-------------------|
| `IDLE` | No active game | → `ASKING` (on start) |
| `ASKING` | Question posed, awaiting answers | → `JUDGING` (answer attempt), → `IDLE` (timeout or stop) |
| `JUDGING` | Claude evaluating an answer | → `ASKING` (wrong), → `SCORED` (correct) |
| `SCORED` | Round resolved | → `ASKING` (next round), → `IDLE` (game over or stop) |

**Critical:** Only one answer enters JUDGING at a time. While in JUDGING, additional answer attempts are queued or dropped (drop is simpler for v1 — prevents race conditions with parallel Claude calls).

---

## Multi-Channel Game State Isolation

Use a `Map<channelName, ChannelGame>` on the GameEngine. Each entry is a fully independent state machine instance with its own:

- Current state enum
- Active question + stored answer
- Timeout timer handle
- Round counter
- Pending answer queue

No global mutable state outside this Map. Operations are keyed by channel name throughout the call chain.

```javascript
// Conceptual shape — not implementation code
class GameEngine {
  #channels = new Map()   // channelName → ChannelGame

  start(channel) { ... }
  stop(channel) { ... }
  submitAnswer(channel, nick, text) { ... }
}
```

Channels that are not in the Map have no active game (IDLE by implication). This means the engine can safely handle joins to new channels without initialization ceremony.

---

## AI Layer Design

Two distinct operations, kept as separate functions (not one "AI" god-object):

### generateQuestion(topic, difficulty)

- Input: topic string, difficulty enum (easy/medium/hard)
- Calls Claude with a compact system prompt: generate one trivia question, return JSON `{ question, answer }`
- Answer is stored server-side only — never sent to IRC
- Returns structured object; throws on API failure (GameEngine catches and announces "AI unavailable")
- Prompt budget: keep under 200 tokens input. No conversation history needed.

### evaluateAnswer(question, correctAnswer, playerAttempt)

- Input: original question text, stored answer, player's raw IRC text
- Calls Claude: "Is this attempt correct? Ignore case, minor spelling, articles."
- Returns `{ correct: boolean }` — binary only for v1
- Do not send channel history or player metadata to Claude (cost/privacy)
- Prompt budget: under 150 tokens input. Single-turn, no history.

**Confidence:** MEDIUM — specific Claude prompt structure needs validation in phase; the architectural separation is HIGH confidence.

---

## Command Handler Design

Commands are prefixed with `!` and dispatched by channel message events.

```
!trivia start [topic] [rounds]   → GameEngine.start(channel, options)
!trivia stop                     → GameEngine.stop(channel)
!score                           → Persistence.getScores(channel) → IRC
!leaderboard                     → Persistence.getLeaderboard(channel) → IRC
!join #channel                   → IRC Layer.join(channel)          [owner only]
!part #channel                   → IRC Layer.part(channel)          [owner only]
!topic <newtopic>                → GameEngine.setTopic(channel, t)  [owner only]
```

Owner auth check: `event.nick === config.ownerNick`. Simple string equality. Runs before routing for owner-gated commands. Non-owners calling owner commands get no response (silent drop — no "you are not authorized" to avoid exposing the check).

Command handler does not hold state. It is a pure router.

---

## Persistence Layer Design

Use `better-sqlite3` (synchronous API, fastest SQLite binding for Node.js, no promise overhead on simple reads/writes).

Schema (two tables):

```sql
CREATE TABLE scores (
  nick       TEXT NOT NULL,
  channel    TEXT NOT NULL,
  points     INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (nick, channel)
);

CREATE TABLE game_sessions (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  channel    TEXT NOT NULL,
  topic      TEXT,
  rounds     INTEGER,
  started_at INTEGER NOT NULL,
  ended_at   INTEGER
);
```

`game_sessions` is optional for v1 but costs nothing to add and enables future analytics.

All writes are wrapped in transactions for atomicity. `addScore` uses `INSERT OR REPLACE` with `points = points + delta`.

File stored at `data/scores.db` (not in project root, not in `src/`).

---

## Suggested Build Order

Dependencies flow bottom-up. Build from lowest to highest:

1. **IRC Layer** — foundation; everything else depends on having a working IRC connection
2. **Persistence Layer** — no dependencies; can be developed and tested in isolation
3. **AI Layer** — no dependencies; requires Claude API key in env; testable in isolation
4. **Game Engine** — depends on AI Layer interface and Persistence Layer interface; wire real dependencies last, mock during dev
5. **Command Handler** — depends on Game Engine and IRC Layer; integrates everything

This order means each component can be tested independently before integration. The Command Handler is the last thing assembled — it is the integration seam.

---

## Scalability Considerations

This is a single-process Node.js bot. Relevant concern is Claude API latency during JUDGING state.

| Concern | At launch (1-3 channels) | If channels grow (10+) |
|---------|--------------------------|------------------------|
| Claude API latency (1-3s per eval) | Acceptable; one game per channel | Consider answer queue with concurrency limit |
| SQLite write contention | None; better-sqlite3 serializes | Still fine; IRC bots don't generate DB write storms |
| Memory per channel | Negligible (one state machine object) | Still negligible |
| IRC flood control | irc-framework handles; use `say()` not raw write | Same |

No architectural changes needed until well beyond typical IRC channel counts. The Map-per-channel design already handles horizontal channel scaling within a single process.

---

## Anti-Patterns to Avoid

### Anti-Pattern 1: Global game state
**What:** Single `currentQuestion` / `currentChannel` variable shared across all channels.
**Why bad:** Breaks multi-channel support entirely; race conditions when two channels answer simultaneously.
**Instead:** Per-channel Map as described above.

### Anti-Pattern 2: Evaluating every message with Claude
**What:** Pass every IRC message to Claude to check if it's a correct answer.
**Why bad:** API cost explosion; latency makes "race" feel broken; burns rate limits.
**Instead:** Only call Claude when channel state is ASKING. Ignore messages in IDLE state.

### Anti-Pattern 3: Sending answer to IRC channel
**What:** Echoing the stored answer in the question announcement so players can "verify."
**Why bad:** Spoils the game; answer must stay server-side only.
**Instead:** Store answer in ChannelGame instance memory; only reveal on timeout or game end.

### Anti-Pattern 4: Storing conversation history in AI calls
**What:** Passing full IRC channel history to Claude for "context."
**Why bad:** Token cost grows unboundedly; not needed for trivia Q generation or answer eval.
**Instead:** Each Claude call is stateless and minimal.

### Anti-Pattern 5: Monolithic bot.js
**What:** All logic (IRC, commands, game, AI, DB) in one file.
**Why bad:** Untestable; impossible to reason about; common in tutorial IRC bots.
**Instead:** The five-component split described here.

---

## Sources

- [kiwiirc/irc-framework — GitHub](https://github.com/kiwiirc/irc-framework) — irc-framework API design (HIGH confidence, official repo)
- [Node.js EventEmitter Documentation](https://nodejs.org/api/events.html) — per-channel EventEmitter isolation pattern (HIGH confidence, official docs)
- [better-sqlite3 — DEV Community](https://dev.to/lovestaco/understanding-better-sqlite3-the-fastest-sqlite-library-for-nodejs-4n8) — SQLite binding for Node.js (MEDIUM confidence, community article)
- [FlyingFathead/IRCBot-OpenAI-API — GitHub](https://github.com/FlyingFathead/IRCBot-OpenAI-API) — reference AI+IRC bot structure (MEDIUM confidence, similar domain)
- [Claude API — Define success criteria and build evaluations](https://platform.claude.com/docs/en/test-and-evaluate/develop-tests) — LLM-graded evaluation pattern for answer correctness (HIGH confidence, official docs)
- [Discord.js SQLite Points System](https://anidiots.guide/coding-guides/sqlite-based-points-system/) — bot score persistence pattern (MEDIUM confidence, community guide, different platform but identical pattern)
