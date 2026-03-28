# Project Research Summary

**Project:** aitrivia — AI-powered IRC trivia bot
**Domain:** IRC game bot with LLM question generation and answer evaluation
**Researched:** 2026-03-28
**Confidence:** HIGH

## Executive Summary

aitrivia is a Node.js IRC bot that uses the Claude API to generate fresh trivia questions on configurable topics and judge player answers semantically. The established pattern for this domain is a five-component architecture — IRC layer, command handler, game engine, AI layer, and persistence layer — with strict ownership boundaries and a per-channel state machine. All reference implementations (QuizBot, trebek, TriviaBot) follow the same race-style game loop: one active question, first correct answer wins, configurable timer with auto-reveal. The AI integration is the sole differentiator over static-bank bots, and it must be designed carefully to avoid the performance and cost traps that make LLM trivia bots frustrating in practice.

The recommended stack is well-established: Node.js 22 LTS, irc-framework v4.14.0 (the only actively maintained Node.js IRC library), @anthropic-ai/sdk with claude-haiku-4-5 as the model (fastest, cheapest, sufficient), better-sqlite3 for crash-safe score persistence, and vitest for testing. The most important architectural decision is that answer judging must NOT call the Claude API per player guess — instead, answer variants should be generated alongside the question in a single API call and matched locally at race time. This eliminates the latency and cost explosion that breaks real-time gameplay.

The three highest risks are: (1) flooding the Undernet server with burst output and getting disconnected, which must be solved at the IRC layer before any game logic exists; (2) running unbounded Claude API calls per answer guess, which is expensive and introduces race conditions; and (3) game state becoming corrupted after a netsplit or reconnect. All three are Phase 1 and Phase 2 concerns and must be designed correctly from the start — they are very difficult to retrofit.

## Key Findings

### Recommended Stack

Node.js 22 LTS is the correct runtime — Node 24 is not yet safe due to better-sqlite3 V8 API breakage. irc-framework is the only viable IRC client; all alternatives are unmaintained. claude-haiku-4-5 is the correct model tier for this workload — Sonnet costs 3x more with no meaningful quality gain for trivia generation or answer evaluation. better-sqlite3's synchronous API eliminates async write race conditions in IRC event handlers. For config, node-config handles YAML (operator-friendly) while dotenv isolates the API key from committed files.

**Core technologies:**
- Node.js 22 LTS — runtime — LTS until April 2027; required for better-sqlite3 prebuild compatibility
- irc-framework ^4.14.0 — IRC client — only actively maintained Node.js IRC library; built-in flood control, auto-reconnect, IRCv3
- @anthropic-ai/sdk ^0.36+ / claude-haiku-4-5 — AI integration — official SDK, lowest cost + latency model for trivia workload
- better-sqlite3 ^12.4.6 — persistence — synchronous API, crash-safe, zero infrastructure; do not use node:sqlite (experimental)
- node-config ^3.3.12 + dotenv ^16.x — configuration — YAML for operator-editable settings; dotenv for API key isolation
- vitest ^2.x — testing — native ESM, TypeScript-ready, no transform boilerplate

**Critical version note:** Do NOT use Node 24. better-sqlite3 v12.x has reported V8 API breakage on Node 24. Use Node 22 LTS.

### Expected Features

**Must have (table stakes):**
- `!start` / `!stop` — universal expectation; any player can start
- Race-style answer detection — first correct answer wins; core mechanic
- Per-question timer with auto-reveal — 30s default; configurable
- `!scores` / leaderboard command — always-on, not game-gated
- `!skip` command — stuck questions kill momentum
- Winner and correct-answer announcement — per question
- Score persistence across restarts — losing scores is unacceptable
- `!help` command — first thing new users try
- IRC reconnect with exponential backoff — connections drop on Undernet
- Rate-limited outbound message queue — prevents Undernet flood disconnect

**Should have (AI differentiators):**
- Dynamic question generation via Claude on any topic
- Pre-generated answer variants for semantic matching (3-5 variants per question, no API call per guess)
- `!topic <topic>` owner command — impossible with static-bank bots
- `!difficulty <easy|medium|hard>` owner command
- Question deduplication (per-session history passed to Claude prompt)

**Defer to v2+:**
- Speed bonuses, streak multipliers
- Fallback question cache (add after API reliability validated)
- Weekly/monthly score resets
- `!setscore` / `!resetscore` admin commands
- CTCP niceties beyond a static VERSION response

### Architecture Approach

Five discrete components with strict ownership boundaries and no cross-boundary state access. The game engine holds a `Map<channelName, ChannelGame>` — each entry is an independent state machine (IDLE → ASKING → JUDGING → SCORED). The AI layer exposes exactly two functions: `generateQuestion(topic, difficulty)` and `evaluateAnswer(question, correctAnswer, attempt)`. Both are stateless and minimal-token. The persistence layer uses synchronous better-sqlite3 to avoid async write races in IRC event callbacks. The command handler is a pure router with no state of its own.

**Major components:**
1. IRC Layer — TCP connection, reconnect logic, rate-limited send queue, raw event emission
2. Command Handler — `!command` parsing, owner nick+hostmask auth, routing to game engine
3. Game Engine — per-channel state machines, timers, round lifecycle, answer locking
4. AI Layer — Claude API calls, prompt construction, JSON response parsing
5. Persistence Layer — better-sqlite3 reads/writes, score aggregation, session logging

**Suggested build order (bottom-up):** IRC Layer → Persistence Layer → AI Layer → Game Engine → Command Handler

### Critical Pitfalls

1. **Flood disconnect (Pitfall 1)** — All outbound messages must route through a single rate-limited sender with 400-600ms between messages. Build this before any game logic. irc-framework's built-in message queue handles this; configure it explicitly.

2. **API latency breaks race gameplay (Pitfall 3)** — Set a "judging in flight" lock immediately on first answer received; drop or queue subsequent guesses. Use pre-generated answer variants (Approach A from FEATURES.md) for zero-latency matching. Reserve Claude API calls for ambiguous cases only.

3. **Runaway API costs (Pitfall 8)** — One judging API call in flight per channel maximum. Pre-filter with Levenshtein before touching the API. Set `max_tokens: 20` on all judging calls. Use claude-haiku-4-5 only.

4. **Game state corruption on reconnect (Pitfall 7)** — Any disconnect event must cancel all timers and reset all channel states to IDLE. Buffer outgoing messages through a "connected" gate. Design this into the state machine from day one.

5. **Score persistence corruption on crash (Pitfall 6)** — Use better-sqlite3 with WAL mode (verify SQLite >= 3.51.3 for the March 2026 WAL bug fix). Wrap all writes in transactions. Register SIGTERM / uncaughtException handlers to flush before exit.

**Secondary pitfalls worth noting:** Owner auth must use nick + hostmask (not nick alone — trivially spoofable on Undernet). AI-generated questions must use low temperature + deduplication history to avoid repetition. Question text must be capped at ~300 characters to avoid IRC line-length truncation.

## Implications for Roadmap

Based on research, suggested phase structure:

### Phase 1: Foundation — IRC Bot + Persistence

**Rationale:** Everything depends on a working, flood-safe IRC connection and crash-safe persistence. These have no dependencies on each other and can be built in parallel. The rate-limited send queue and atomic score writes must exist before game logic is layered on top — both are very difficult to retrofit correctly.

**Delivers:** Bot that connects to Undernet (with LoC/X auth), joins configured channels, responds to PING, reconnects with exponential backoff, and has a working SQLite score store with atomic writes.

**Addresses:** IRC connection (table stakes), score persistence (table stakes), bot reconnect (table stakes)

**Avoids:** Pitfall 1 (flood disconnect), Pitfall 6 (persistence corruption), Pitfall 7 (reconnect state corruption), Pitfall 10 (Undernet bot policy — read MOTD at startup)

**Research flag:** Standard patterns — no additional research needed. irc-framework docs and better-sqlite3 docs are authoritative.

### Phase 2: Game Engine + AI Layer

**Rationale:** With IRC and persistence working, the game engine and AI layer can be built and tested against mocked IRC/DB interfaces. Answer variant pre-generation (the critical architectural decision) must be implemented here — not deferred. The judging lock must be designed into the state machine before wiring real players.

**Delivers:** Full game loop — `!start`, `!stop`, `!skip`, per-question timer, race answer detection, Claude question generation with pre-generated answer variants, winner announcement, per-round scoring, `!scores` leaderboard.

**Uses:** @anthropic-ai/sdk (claude-haiku-4-5), better-sqlite3 persistence layer from Phase 1

**Implements:** Game Engine (state machine), AI Layer (generateQuestion + evaluateAnswer)

**Avoids:** Pitfall 3 (API latency race), Pitfall 4 (unfair questions), Pitfall 5 (answer over-accept/reject), Pitfall 8 (runaway costs), Pitfall 9 (question repetition)

**Research flag:** Prompt engineering for question generation + answer judging needs validation during implementation. The architectural separation is HIGH confidence; the exact prompt structure is MEDIUM. Build the prompt in isolation and test before wiring into game loop.

### Phase 3: Owner Commands + Polish

**Rationale:** Owner commands (`!topic`, `!difficulty`, `!join`, `!part`) are layered on top of a working game loop. Auth (nick + hostmask check) should be defined in Phase 1 but the full owner command surface belongs here. CTCP handling and question length guards are low-effort additions once the core loop is validated.

**Delivers:** Full owner command surface, `!help` output, nick+hostmask owner auth, CTCP VERSION response, question character length guard, configurable game parameters via IRC commands.

**Avoids:** Pitfall 2 (nick spoofing), Pitfall 15 (question text truncation), Pitfall 14 (CTCP VERSION spam)

**Research flag:** Standard patterns — no additional research needed.

### Phase 4: Hardening + Cost Controls

**Rationale:** After the core loop is working and validated with real Undernet gameplay, add the resilience layer: API cost counters, per-session question dedup, silent-failure dead-man timers, and score attribution by user@host.

**Delivers:** Per-channel daily API call counter with configurable limit, question deduplication bloom filter (cross-session), dead-man timer for stalled judging calls, hostmask-based score attribution, prompt caching for judging system prompt.

**Avoids:** Pitfall 8 (runaway costs), Pitfall 9 (question repetition), Pitfall 11 (silent async failures), Pitfall 13 (nick-change score attribution)

**Research flag:** Prompt caching implementation needs brief API docs review (Anthropic cache_control headers). Otherwise standard patterns.

### Phase Ordering Rationale

- Phase 1 before everything: flood disconnect and persistence corruption are catastrophic, invisible in dev, and hard to fix after the fact
- IRC Layer and Persistence Layer within Phase 1 can be built in parallel — neither depends on the other
- AI Layer can be developed in parallel with Game Engine in Phase 2 — wire together at the end
- Owner commands deferred to Phase 3 because they depend on a working game loop to be meaningful
- Cost/hardening deferred to Phase 4 because you need real usage patterns to tune the controls correctly

### Research Flags

Phases needing deeper research during planning:
- **Phase 2 (prompt engineering):** The question generation and answer judging system prompts need iterative testing against the Claude API before they can be considered stable. Specifically: temperature setting, answer variant count, judging rubric wording, and few-shot examples for the judging prompt. Plan for a prompt-validation spike before wiring into the game loop.

Phases with standard patterns (research-phase not needed):
- **Phase 1:** irc-framework and better-sqlite3 are well-documented; Undernet LoC auth is documented by CService; no novel patterns
- **Phase 3:** Owner command routing and CTCP handling are established IRC bot patterns
- **Phase 4:** Bloom filter dedup and API cost counters are standard; prompt caching is documented in Anthropic official docs

## Confidence Assessment

| Area | Confidence | Notes |
|------|------------|-------|
| Stack | HIGH | All choices verified against npm registry and official docs; version constraints confirmed (Node 22, better-sqlite3 v12, irc-framework v4.14.0) |
| Features | HIGH | IRC trivia bot conventions are well-established across multiple reference implementations with source code |
| Architecture | HIGH | Five-component split with per-channel Map state machine is the correct pattern; AI answer evaluation separation is well-reasoned |
| Pitfalls | HIGH | All critical pitfalls verified against official network docs, npm library behavior, and LLM evaluation research |

**Overall confidence:** HIGH

### Gaps to Address

- **Claude prompt structure (answer judging):** The judging rubric and few-shot examples need empirical testing. The architecture for where and when to call the API is HIGH confidence; the exact prompt wording is MEDIUM. Allocate time in Phase 2 for prompt tuning before game loop integration.
- **Undernet server selection:** The code cannot determine which Undernet servers allow bots — this is a deployment/operator decision. Document in config that the operator must check the target server's MOTD before deploying. Log MOTD at startup.
- **SQLite WAL version:** better-sqlite3's bundled SQLite version must be >= 3.51.3 to avoid the WAL corruption bug patched in March 2026. Verify the exact bundled version during Phase 1 setup.

## Sources

### Primary (HIGH confidence)
- https://www.npmjs.com/package/irc-framework (v4.14.0, Sep 2024) — IRC client library
- https://github.com/kiwiirc/irc-framework — irc-framework API and flood control
- https://platform.claude.com/docs/en/about-claude/models/overview — Claude model selection, verified Mar 2026
- https://www.npmjs.com/package/@anthropic-ai/sdk — Anthropic SDK
- https://github.com/WiseLibs/better-sqlite3 — SQLite binding
- https://www.undernet.org/docs/x-commands-english — Undernet X auth commands
- https://cservice.undernet.org/docs/xcmds.txt — Undernet LoC documentation
- https://www.undernet.org/docs/noflood — Undernet flood protection
- https://www.undernet.org/rules/ — Undernet bot policy
- https://nodejs.org/api/events.html — Node.js EventEmitter
- https://platform.claude.com/docs/en/test-and-evaluate/develop-tests — LLM-graded evaluation pattern
- https://platform.claude.com/docs/en/test-and-evaluate/strengthen-guardrails/reduce-latency — Claude latency reduction
- https://sqlite.org/wal.html — SQLite WAL mode, WAL corruption bug (patched 3.51.3)

### Secondary (MEDIUM confidence)
- https://github.com/MansionNET/QuizBot — AI-powered IRC trivia bot reference implementation
- https://github.com/AeroSteveO/TriviaBot — Java IRC trivia bot with explicit command surface
- https://github.com/epitron/trebek — Ruby IRC trivia bot
- https://github.com/FlyingFathead/IRCBot-OpenAI-API — AI+IRC bot structure reference
- https://www.evidentlyai.com/llm-guide/llm-as-a-judge — LLM-as-judge patterns
- https://towardsdatascience.com/llm-as-a-judge-a-practical-guide/ — LLM judge rubric design
- https://dev.to/lovestaco/understanding-better-sqlite3-the-fastest-sqlite-library-for-nodejs-4n8 — better-sqlite3 Node.js usage

### Tertiary (LOW confidence)
- https://www.lazyre.com/blog/building-advanced-ai-trivia-bot-discord — AI trivia bot patterns (Discord context; verify IRC applicability)
- https://www.redblock.ai/resources/blog/parrot-how-we-used-game-show-trivia-to-build-an-llm-benchmark — LLM trivia evaluation benchmarks

---
*Research completed: 2026-03-28*
*Ready for roadmap: yes*
