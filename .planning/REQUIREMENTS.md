# Requirements: aitrivia

**Defined:** 2026-03-28
**Core Value:** The bot generates fresh, engaging trivia questions on any topic via AI — no stale question banks.

## v1 Requirements

### IRC Connectivity

- [ ] **IRC-01**: Bot connects to Undernet using irc-framework with configurable server/port
- [ ] **IRC-02**: Bot authenticates with Undernet X bot via LoC (Login on Connect) from config
- [ ] **IRC-03**: Bot automatically reconnects after disconnect or netsplit
- [ ] **IRC-04**: Bot resets all active game state to IDLE on disconnect (no orphaned timers)
- [ ] **IRC-05**: All outbound IRC messages pass through a rate-limited send queue (flood protection)
- [ ] **IRC-06**: Bot responds to server PINGs to maintain connection

### Bot Management

- [ ] **BOT-01**: Owner can make bot join a channel with `!join #channel`
- [ ] **BOT-02**: Owner can make bot part a channel with `!part #channel`
- [ ] **BOT-03**: Bot joins configured default channels on startup
- [ ] **BOT-04**: Bot ignores commands from non-owners

### Owner Auth

- [ ] **AUTH-01**: Owner is identified by IRC nickname AND hostmask (not nickname alone)
- [ ] **AUTH-02**: Owner list is configurable in the config file
- [ ] **AUTH-03**: Bot rejects commands from users matching owner nickname but wrong hostmask

### Game Mechanics

- [ ] **GAME-01**: Owner or player (configurable) can start a trivia game in a channel with `!start`
- [ ] **GAME-02**: Owner can stop an active game with `!stop`
- [ ] **GAME-03**: Owner or player can skip the current question with `!skip`
- [ ] **GAME-04**: Each channel has independent game state (multi-channel isolation)
- [ ] **GAME-05**: Bot announces each question to the channel with a configurable timeout
- [ ] **GAME-06**: First player to send a correct answer in the channel wins the point
- [ ] **GAME-07**: Bot announces the correct answer and winner when a round ends (by correct answer or timeout)
- [ ] **GAME-08**: Game ends after a configurable number of questions, then announces final scores
- [ ] **GAME-09**: Additional answer attempts during AI evaluation are dropped (per-question lock prevents race conditions)

### AI Integration

- [ ] **AI-01**: Bot generates trivia questions via Claude Haiku based on configured topics
- [ ] **AI-02**: Each question generation call returns the question text, canonical answer, and 3-5 accepted answer variants in one API call
- [ ] **AI-03**: Answer matching uses the pre-generated variants (no per-guess API calls during gameplay)
- [ ] **AI-04**: Answer comparison is case-insensitive and strips leading/trailing whitespace
- [ ] **AI-05**: Bot uses a synchronous Levenshtein pre-filter before any variant check to handle obvious typos
- [ ] **AI-06**: Questions include configurable difficulty level in the generation prompt

### Scoring & Persistence

- [ ] **SCORE-01**: Player scores are stored in SQLite (better-sqlite3) and persist across bot restarts
- [ ] **SCORE-02**: `!scores` displays the top scores for the current game session in-channel
- [ ] **SCORE-03**: `!leaderboard` displays the all-time top scores for that channel
- [ ] **SCORE-04**: Score writes use atomic transactions to prevent corruption on crash

### Configuration

- [ ] **CONF-01**: Config file (YAML) controls: server, port, nick, LoC credentials, default channels, owner list, topics, difficulty, question count, timeout
- [ ] **CONF-02**: `ANTHROPIC_API_KEY` is loaded from `.env` only, never from config file
- [ ] **CONF-03**: Owner can change active topics for a channel via `!topic <topic>` IRC command
- [ ] **CONF-04**: Owner can change difficulty for a channel via `!difficulty <easy|medium|hard>` IRC command
- [ ] **CONF-05**: Config file changes do not require restart for IRC commands (read at game start)

## v2 Requirements

### Enhanced Owner Controls

- **OWN2-01**: Owner can set per-channel question count via `!rounds <n>`
- **OWN2-02**: Owner can set per-channel timeout via `!timeout <seconds>`
- **OWN2-03**: Owner can reload config from file without restarting bot

### Question Quality

- **QQ-01**: Cross-session question deduplication (avoid repeating recent questions)
- **QQ-02**: Question cache for pre-loading next question during current question's answer window
- **QQ-03**: API call counter and cost tracking logged to file

### Player Experience

- **PX-01**: Players can see their own score with `!myscore`
- **PX-02**: Bot announces streak when same player answers multiple consecutive questions

### Security

- **SEC-01**: Optional X account verification via WHOIS for stronger owner auth
- **SEC-02**: Configurable per-channel command cooldown to prevent spam

## Out of Scope

| Feature | Reason |
|---------|--------|
| Web UI or dashboard | IRC is the interface — adding web layer is scope creep for v1 |
| Multi-network support | Undernet-first; SASL/NickServ differences add complexity |
| Team/group scoring | Individual scoring is simpler and covers the core use case |
| Hint system (progressive letter reveal) | AI variant generation eliminates the need; `!skip` handles stuck cases |
| LLM judging per player guess | Incompatible with race-style gameplay due to latency; variants solve it |
| Voice/audio | IRC text only |
| Per-user passwords | Owner by nick+hostmask is sufficient for IRC bot convention |
| Multiple simultaneous games per channel | One active game per channel is the standard model |

## Traceability

| Requirement | Phase | Status |
|-------------|-------|--------|
| IRC-01 | Phase 1 | Pending |
| IRC-02 | Phase 1 | Pending |
| IRC-03 | Phase 1 | Pending |
| IRC-04 | Phase 1 | Pending |
| IRC-05 | Phase 1 | Pending |
| IRC-06 | Phase 1 | Pending |
| BOT-03 | Phase 1 | Pending |
| BOT-04 | Phase 1 | Pending |
| AUTH-01 | Phase 1 | Pending |
| AUTH-02 | Phase 1 | Pending |
| AUTH-03 | Phase 1 | Pending |
| SCORE-01 | Phase 1 | Pending |
| SCORE-04 | Phase 1 | Pending |
| CONF-01 | Phase 1 | Pending |
| CONF-02 | Phase 1 | Pending |
| GAME-01 | Phase 2 | Pending |
| GAME-02 | Phase 2 | Pending |
| GAME-03 | Phase 2 | Pending |
| GAME-04 | Phase 2 | Pending |
| GAME-05 | Phase 2 | Pending |
| GAME-06 | Phase 2 | Pending |
| GAME-07 | Phase 2 | Pending |
| GAME-08 | Phase 2 | Pending |
| GAME-09 | Phase 2 | Pending |
| AI-01 | Phase 2 | Pending |
| AI-02 | Phase 2 | Pending |
| AI-03 | Phase 2 | Pending |
| AI-04 | Phase 2 | Pending |
| AI-05 | Phase 2 | Pending |
| AI-06 | Phase 2 | Pending |
| SCORE-02 | Phase 2 | Pending |
| SCORE-03 | Phase 2 | Pending |
| BOT-01 | Phase 3 | Pending |
| BOT-02 | Phase 3 | Pending |
| CONF-03 | Phase 3 | Pending |
| CONF-04 | Phase 3 | Pending |
| CONF-05 | Phase 3 | Pending |

**Coverage:**
- v1 requirements: 35 total
- Mapped to phases: 35
- Unmapped: 0 ✓

---
*Requirements defined: 2026-03-28*
*Last updated: 2026-03-28 after roadmap creation (BOT-01, BOT-02 moved Phase 1 → Phase 3)*
