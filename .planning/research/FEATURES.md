# Feature Landscape: AI-Powered IRC Trivia Bot

**Domain:** IRC trivia game bot with AI question generation
**Researched:** 2026-03-28
**Overall confidence:** HIGH (core IRC trivia conventions well-established; AI-specific patterns MEDIUM from 2024-2025 implementations)

---

## Table Stakes

Features users expect from any trivia bot. Missing = product feels broken or incomplete.

| Feature | Why Expected | Complexity | Notes |
|---------|--------------|------------|-------|
| `!start` / `!stop` game commands | Universal in every IRC trivia bot (trebek, triviabot, QuizBot) | Low | Any player can start; owner can stop |
| Race-style answer detection | First correct answer wins; core game mechanic | Low | Listen to all channel messages during active question |
| Per-question timer with auto-advance | If no one answers, game stalls; must timeout and reveal answer | Low | 30s default is standard (QuizBot); make configurable |
| `!scores` / `!leaderboard` command | Players need to see standings without leaving IRC | Low | Show top N players; triggered anytime |
| `!skip` / `!next` command | Stuck questions kill momentum; users expect to skip | Low | Skip current question, advance to next |
| Score persistence across restarts | Losing scores on restart is unacceptable | Low | File-based JSON is sufficient for v1 |
| Correct answer announcement | After timeout or win, reveal the answer in channel | Low | "The answer was: X" |
| Winner announcement | Acknowledge who got it right and their new score | Low | "Nick gets a point! (Total: 5)" |
| `!help` command | First thing new users try | Low | Show available commands in-channel |
| Question counter display | "Question 3/10" — players track progress | Low | Display with each question |
| Bot reconnect on disconnect | IRC connections drop; bot must recover without restart | Medium | Exponential backoff recommended |
| Flood/rate limiting on output | Undernet will disconnect a bot that bursts too many lines; standard practice is max ~5 lines/burst | Medium | Especially important when announcing questions + scores together |

---

## Differentiators

Features that are only possible (or dramatically better) because this bot uses AI. These are the competitive advantage over static-bank bots.

| Feature | Value Proposition | Complexity | Notes |
|---------|-------------------|------------|-------|
| Dynamic question generation on any topic | Static bots have fixed banks; AI generates fresh questions on configured or requested topics indefinitely | High | Core differentiator; uses Claude API per question |
| AI answer judging (semantic correctness) | Static bots require exact string match; AI can accept "Roosevelt", "FDR", "Franklin D. Roosevelt" as all correct | Medium | LLM-as-judge approach; one API call per answer attempt or batch the question+answer at generation time |
| Configurable topics via IRC command | Owner sets topic mid-game: `!topic history` — impossible with static banks | Low-Medium | Pass topic to Claude prompt; store in session state |
| Configurable difficulty via IRC command | `!difficulty hard` adjusts Claude prompt constraints | Low-Medium | Prompt parameter; three levels: easy/medium/hard |
| Fallback question cache | If Claude API is slow or unavailable, pre-generated questions prevent game stall | Medium | Generate N questions ahead; cache locally |
| Hallucination-resistant generation | Prompt Claude to include an authoritative answer alongside the question; validate internally before asking | Medium | Prompt engineering: "Generate question and confirmed answer; do not ask if you are uncertain" |
| Topic variety within a session | Rotate through sub-topics automatically to prevent fatigue | Low | Expand configured topic list in prompt |

---

## Game Commands: Complete Command Surface

### Player Commands (anyone in channel)

| Command | Function | Notes |
|---------|----------|-------|
| `!start [count]` | Start a game; optional question count | Default 10 if no count given |
| `!stop` | Stop current game | Confirm with score summary |
| `!skip` | Skip current question | Reveal answer, advance |
| `!scores` | Show leaderboard (top 10) | Works mid-game and outside game |
| `!score [nick]` | Show specific player's score | Own score if no nick given |
| `!help` | List available commands | |

### Owner Commands (owner nick only)

| Command | Function | Notes |
|---------|----------|-------|
| `!topic <topic>` | Set question topic | Takes effect next question |
| `!difficulty <easy|medium|hard>` | Set difficulty level | Takes effect next question |
| `!questions <N>` | Set questions per game | |
| `!join <#channel>` | Join a channel | |
| `!part [#channel]` | Part current or specified channel | |
| `!setscore <nick> <N>` | Override a player's score | Admin correction |
| `!resetscore <nick>` | Reset a player's score to 0 | |
| `!resetscores` | Reset all scores | Dangerous; confirm before executing |
| `!reload` | Reload config from file | |
| `!say <text>` | Make bot say something in channel | Utility |

**Note:** Owner is identified by IRC nickname only (per PROJECT.md constraint). No password auth in v1.

---

## Scoring Mechanics

Standard approach confirmed across multiple IRC trivia bots (QuizBot, AeroSteveO/TriviaBot, trebek):

| Mechanic | Recommended for v1 | Rationale |
|----------|-------------------|-----------|
| +1 point per correct answer | Yes — simple, standard | Complexity stays low; race tension comes from speed not points |
| Speed bonus (faster = more points) | No — defer to v2 | Adds scoring complexity; AI answer judging already adds latency |
| Win streak multiplier | No — defer to v2 | Valuable differentiator but adds state tracking |
| Scores persist to file (JSON) | Yes | Simple, sufficient for IRC channel scale |
| Weekly/monthly resets | No — defer to v2 | Adds cron/scheduling complexity |
| All-time leaderboard | Yes | Single persistent file |

---

## Answer Evaluation: AI-Specific Design

The most important differentiator is how answers are judged. Two viable approaches:

**Approach A — Pre-generate accepted answers (recommended for v1):**
When Claude generates the question, also generate 3-5 accepted answer variants. Store locally. Use simple string normalization (lowercase, strip punctuation, trim whitespace) for comparison. No extra API call per player guess.

- Pros: Fast, cheap, no API call per guess, immune to player flooding with guesses
- Cons: May miss creative valid answers Claude didn't anticipate

**Approach B — LLM-as-judge per answer:**
Pass each player's answer to Claude for correctness evaluation.

- Pros: Accepts any semantically correct answer
- Cons: Latency per guess (IRC feels slow), cost scales with guesses, risk of prompt injection from players
- Verdict: Too slow and expensive for real-time race gameplay in v1

**Recommendation:** Use Approach A for v1. Store canonical answer + accepted variants at question generation time. Apply normalization before comparison.

---

## IRC-Specific Features

| Feature | Why It Matters | Complexity |
|---------|----------------|------------|
| Rate limiting outbound messages | Undernet disconnects bots that burst; keep to ~1 msg/200ms | Medium |
| PING/PONG keepalive | IRC server drops silent connections; respond to server PINGs | Low |
| Reconnect with backoff | Network drops are common; exponential backoff (1s → 2s → 4s → max 60s) | Low-Medium |
| Channel mode awareness | Don't respond during +m (moderated) mode without voice | Low |
| CTCP VERSION response | Standard IRC bot courtesy; also prevents some anti-bot kicks | Low |
| Ignore CTCP floods | Undernet flood docs note 1 CTCP per 60s is standard | Low |
| Nick collision handling | If bot's nick is taken on reconnect, append _ suffix | Low |

---

## Anti-Features

Features to deliberately NOT build in v1.

| Anti-Feature | Why Avoid | What to Do Instead |
|--------------|-----------|-------------------|
| Web UI / dashboard | Out of scope per PROJECT.md; IRC is the interface | IRC-only; all control through commands |
| Multi-network support | Adds connection management complexity; Undernet-specific quirks already handled | Single network, single config block |
| Team/group scoring | Adds session state complexity; individual scoring covers the core use case | Individual scoring only |
| NickServ / SASL auth | Undernet uses X (CService), not NickServ; SASL not standard on Undernet | X login in config if channel needs it |
| Per-user password auth | Nickname-based owner auth is sufficient per PROJECT.md | Nickname check only |
| Hint system (letter reveal) | Adds state machine complexity; AI-judged answers make hints unnecessary — just skip | Use `!skip` instead |
| Question voting / flagging | qwizbot has this; adds overhead with minimal benefit for small channels | Owner uses `!skip` to skip bad questions |
| Multiple concurrent games per bot | Adds channel isolation complexity; single-channel focus is simpler | One active game per channel is fine |
| LLM-as-judge per guess (real-time) | Too slow and costly for race-style gameplay | Pre-generate answer variants at question time |
| Score resets on schedule (weekly/monthly) | Adds scheduling complexity; all-time scores are fine for v1 | Manual `!resetscores` if needed |
| Trivia categories as a menu | Static categories are a static-bank concept; AI takes a topic string directly | Free-form topic string via `!topic` |

---

## Feature Dependencies

```
Score persistence → Leaderboard display command
Score persistence → Score-per-player command
Question generation (Claude) → Answer variant generation (same API call)
Answer variant generation → Answer evaluation at race time
Game start → Active question state → Timer → Auto-advance
Owner nick check → Owner commands
IRC connection → Everything else
Reconnect logic → Persistent operation
```

---

## MVP Recommendation

Ship these, in this order of implementation priority:

**Must have (MVP):**
1. IRC connection + reconnect (foundation for everything)
2. Rate-limited message output (prevents Undernet kick)
3. `!start` / `!stop` with question counter
4. Claude question generation with accepted answer variants
5. Race answer detection + winner announcement
6. Per-question timer with auto-reveal
7. Score tracking + persistence to JSON
8. `!scores` leaderboard
9. `!skip` command
10. Owner commands: `!topic`, `!difficulty`, `!join`, `!part`
11. `!help` command

**Defer post-MVP:**
- Speed bonuses and streak multipliers
- `!setscore` / `!resetscore` admin commands (useful but not launch-critical)
- Fallback question cache (add when API reliability is validated)
- CTCP handling niceties (add after core loop works)

---

## Sources

- [MansionNET/QuizBot — Mistral AI IRC trivia bot](https://github.com/MansionNET/QuizBot) — HIGH confidence (current, AI-powered reference implementation)
- [AeroSteveO/TriviaBot — Java IRC trivia bot with command list](https://github.com/AeroSteveO/TriviaBot/blob/master/src/rapternet/irc/bots/triviabot/TriviaBot.java) — HIGH confidence (source code, explicit command list)
- [epitron/trebek — Ruby IRC trivia bot](https://github.com/epitron/trebek) — HIGH confidence (source code)
- [rawsonj/triviabot — Python IRC trivia bot](https://github.com/rawsonj/triviabot) — MEDIUM confidence (limited docs)
- [evilnet/qwizbot — Perl IRC trivia bot](https://github.com/evilnet/qwizbot) — MEDIUM confidence (limited docs)
- [Undernet flood protection docs](https://www.undernet.org/docs/noflood) — HIGH confidence (official Undernet documentation)
- [EvidentlyAI: LLM-as-a-Judge guide](https://www.evidentlyai.com/llm-guide/llm-as-a-judge) — MEDIUM confidence (2025, credible ML evaluation source)
- [Lazyre: Building AI-powered trivia bot](https://www.lazyre.com/blog/building-advanced-ai-trivia-bot-discord) — LOW confidence (blog, single source)
