# Domain Pitfalls

**Domain:** AI-powered IRC trivia bot (Node.js, Undernet)
**Researched:** 2026-03-28

---

## Critical Pitfalls

Mistakes that cause rewrites, runaway costs, or broken gameplay.

---

### Pitfall 1: Flooding Yourself Off the Server

**What goes wrong:** The bot sends too many messages in rapid succession — announcing a question, confirming a winner, announcing scores, posting next-question countdown — and Undernet's ircu daemon disconnects it with "Excess Flood" or "Max sendQ exceeded". The bot drops off and the game dies silently.

**Why it happens:** IRC servers maintain a per-connection send buffer. ircu (Undernet's daemon) imposes strict per-user send-rate limits. When a trivia bot sends a burst (question + separator + hint + score announcement) it can blow through the limit in under a second. Most developers test in quiet channels and don't see the problem until real play with actual traffic.

**Consequences:** Disconnection mid-game. Scores may not save if the disconnect happens before persistence flush. Players who just answered get no feedback. Bot may reconnect into a broken game state (question is "active" but nobody is playing).

**Warning signs:**
- "Excess Flood" in quit message during bursts
- Bot disconnects immediately after posting a hint or score list
- Works fine in testing but fails when game moves fast

**Prevention:**
- Use irc-framework (kiwiirc) — it has built-in message queue with configurable flood delay. As of v4.14.0 (September 2024) it is the most actively maintained Node.js IRC client with IRCv3 compliance.
- Set `message_delay` (or equivalent) to at least 400–600ms between outgoing messages.
- Keep game output lean: one line per event, no decorative separators.
- Never send score lists with more than 5–10 entries in one burst; truncate or paginate with delay.
- Queue all outgoing messages through a single rate-limited sender, not ad-hoc `client.say()` calls scattered across the code.

**Phase to address:** Phase 1 (IRC connection and core bot structure). Build the rate-limited sender before any game logic.

---

### Pitfall 2: Nickname-Only Owner Auth Is Trivially Spoofable

**What goes wrong:** Any user who changes their nickname to the owner's configured nickname can issue owner commands. Undernet has no NickServ — nicknames are not registered or protected by the network.

**Why it happens:** IRC does not enforce nickname ownership. On Undernet specifically, there is no NickServ equivalent; anyone can `/nick OwnerName` if the owner is not currently connected. The project explicitly chose nickname-based auth for simplicity, but without any secondary check this is a complete authentication bypass.

**Consequences:** Any channel member can steal the owner nick (when owner is away) and issue commands: stop the game, change topics, make the bot join/part channels, potentially abuse the bot.

**Warning signs:**
- A user in channel with the owner's exact nickname who is not from the owner's expected hostmask
- Commands being executed when the owner reports they did not send them

**Prevention:**
- Combine nickname check with hostmask (username@host) check. Store the owner's expected hostmask pattern (e.g., `*!user@trusted.host`) in config alongside the nickname. Reject commands if the hostmask does not match even if the nick matches.
- On Undernet, if the owner logs in to X, the WHOIS response includes their X account name in the "account" field. The bot can issue a WHOIS and check the X account as a secondary factor — this is harder to spoof since it requires knowing the X account password.
- At minimum, log all owner-command attempts with the full `nick!user@host` for post-hoc auditing.
- Document the security tradeoff in config: "This bot uses nickname + hostmask auth. It is not cryptographically secure."

**Phase to address:** Phase 1 (owner command handling). This must be designed correctly from the start — retrofitting auth is painful.

---

### Pitfall 3: AI Response Latency Breaks Race-Style Gameplay

**What goes wrong:** Answer judging is sent to the Claude API. At p95, Claude Haiku can take 3–8 seconds to respond. In a race-style game, the first player to type the correct answer wins. If judging is async and takes 5 seconds, a second player who answers after the first but before the API responds gets "congratulations" before the first player's result comes back — or both answers are judged "correct" and both score a point.

**Why it happens:** LLM judging is inherently async. The naive implementation fires an API call per answer message received, then scores on the response. Multiple near-simultaneous answers each trigger separate API calls, all of which resolve asynchronously.

**Consequences:** Broken "first correct answer wins" contract. Double-scoring. Players feel the game is unfair. At high latency spikes (30s outliers are documented), the game appears frozen.

**Warning signs:**
- Multiple "correct!" announcements for the same question
- Visible delay between a player typing the answer and the bot responding
- Complaints from players that someone else "also got it" on the same question

**Prevention:**
- Lock the question immediately on first received answer: set a "judging in flight" flag before firing the API call. Ignore subsequent answer attempts until the API responds or a short timeout elapses.
- Use a two-phase approach: synchronous pre-filter (fast string normalization + fuzzy match against the known answer) to catch obvious correct answers without an API round-trip; only call the API for ambiguous cases.
- Use claude-haiku-4-5 for answer judging specifically — it is the fastest model and answer judging prompts are short.
- Set max_tokens to 10–20 for judging (response is just "CORRECT" or "INCORRECT"). This dramatically reduces latency.
- Implement a hard per-answer timeout (e.g., 3 seconds): if the API does not respond, fall back to the synchronous fuzzy matcher result.

**Phase to address:** Phase 2 (game loop and answer judging). Design the answer-received handler with locking from the start.

---

### Pitfall 4: AI Generates Unfair or Unanswerable Questions

**What goes wrong:** Claude generates a question where the "expected answer" in the structured output is overly specific (e.g., "Mount Everest, 8,848.86m" when "Mount Everest" should suffice), or the question contains a subtle factual error, or the answer is ambiguous (multiple correct answers possible). Players answer correctly but are judged wrong. Or Claude hallucinates a question with a false premise.

**Why it happens:** LLMs predict plausible text, not verified facts. Even capable models produce factual errors at a non-trivial rate, especially for obscure topics. Without explicit instructions, Claude tends toward overly precise expected answers.

**Consequences:** Player frustration. Players argue the answer is correct. Repeated incidents destroy trust in the bot. If the bot reveals "the answer" and it is factually wrong, the bot looks broken.

**Warning signs:**
- Players consistently arguing about answer correctness for a topic category
- Bot reveals answers that are obviously wrong
- Answer judging accepts bizarre non-answers (over-permissive prompt)

**Prevention:**
- In the question-generation prompt, instruct Claude to: (1) provide the canonical short-form answer (not overly qualified), (2) list 2–3 acceptable answer variants, (3) flag if the question has known ambiguity.
- Request temperature 0 or low temperature for question generation — reduces creative hallucination.
- Separate generation from judging: generate question + canonical answer + variants in one API call; use the variants list for judging rather than re-asking the model.
- Store generated questions with their answers before revealing them — if the bot crashes mid-question, the answer is recoverable.
- Include a `!skip` command that lets the owner skip unanswerable questions mid-game.

**Phase to address:** Phase 2 (question generation prompt engineering). Invest time in the system prompt before building game loop.

---

### Pitfall 5: Answer Judging Over-Rejects or Over-Accepts

**What goes wrong:** The LLM judge either rejects clearly correct answers (common spelling variants, abbreviations, leading articles like "the") or accepts non-answers (one-word near-matches, "yes", partial sentences). Research shows LLM judges can be outperformed by simple substring matching on fuzzy tasks, while also injecting too much "background knowledge" and accepting loosely related answers.

**Why it happens:** LLM judges over-reason. A question about "The Beatles" with answer "Beatles" — the model may accept "rocks" because it associates rock music. Or it may reject "beatles" (lowercase) due to unexpected strictness. Without a rubric, behavior is inconsistent between calls.

**Consequences:** Players learn to game the judge with partial phrases. Or players with correct answers in slightly different forms are unfairly rejected.

**Warning signs:**
- Single-word non-answers being accepted ("music", "England" for a Beatles question)
- Correct answers with obvious typos consistently rejected
- Behavior differs between identical-looking answers across questions

**Prevention:**
- Use a structured judging prompt with explicit rubric: "Accept if the core factual content matches, ignoring: case, leading/trailing articles (the/a/an), common abbreviations, minor spelling errors (1-2 character transpositions). Reject if: a different entity/place/person is named, the answer is only loosely thematically related."
- Always pass the expected answer AND the player's answer in the same prompt. Never rely on the model's background knowledge alone.
- Use few-shot examples in the system prompt: 3–4 examples of accept and reject with brief reasoning.
- For short expected answers (under 20 characters), run a fast Levenshtein distance check first (distance <= 2 = likely correct, pass to LLM for confirmation only if distance is 3–5).

**Phase to address:** Phase 2 (answer judging). Build and test the judging prompt in isolation before wiring into game loop.

---

### Pitfall 6: Score Persistence Corruption on Crash or Concurrent Access

**What goes wrong:** Scores are written to a JSON file or SQLite database. The bot crashes (SIGKILL, network drop, unhandled exception) mid-write, leaving a truncated or malformed file. On next restart, the file fails to parse and all scores are lost. Or, if two async operations write simultaneously (e.g., a game ends while a previous write is still in-flight), the file is partially overwritten.

**Why it happens:** Node.js's `fs.writeFile` is not atomic — it truncates then writes. A crash between truncate and write completes leaves an empty file. JSON append-on-write patterns are especially fragile. Developers test with graceful shutdowns and never hit the crash path.

**Consequences:** Score history wiped on any unclean shutdown. Players lose leaderboard standing. Hard to reproduce in dev environment.

**Warning signs:**
- JSON file is 0 bytes or truncated after a crash
- Scores reset unexpectedly after a bot restart
- Async write errors silently swallowed in the event loop

**Prevention:**
- Use atomic writes: write to a `.tmp` file, then `fs.renameSync()` to the final path. `rename` is atomic on POSIX filesystems.
- Alternatively use SQLite via `better-sqlite3` (synchronous API, no async write race conditions). Note: A WAL-mode bug affecting SQLite 3.7.0–3.51.2 was patched in 3.51.3 (March 2026) — ensure the bundled SQLite version is up to date.
- Wrap all persistence in a single-writer queue (no concurrent writes to the same store).
- On startup, validate the scores file/DB before trusting it. Have a backup copy (`.bak`) from the last successful write.
- Register `process.on('SIGTERM')` and `process.on('uncaughtException')` handlers to flush scores before exit.

**Phase to address:** Phase 1 (persistence layer). Atomic writes must be the default from day one.

---

### Pitfall 7: Game State Corruption After Netsplit or Reconnect

**What goes wrong:** The bot disconnects from Undernet (netsplit, ping timeout, server restart). On reconnect, the in-memory game state says a game is in progress — a question is "active", a timer is running, scores are partially accumulated — but the bot is no longer in the channel and players have no context. The timer fires, reveals the answer to nobody, and the bot tries to send to a channel it hasn't rejoined.

**Why it happens:** IRC connections are not reliable. Undernet netsplits are real and can last minutes. The reconnect event re-joins the channel, but the game state machine is still mid-game. Most bots initialize game state once at startup and never reset it on reconnect.

**Consequences:** "Orphaned" game timer sends messages to wrong channel or before channel join completes. Scores from partial game are counted. Bot appears to announce answers for questions never asked. Channel sees the bot rejoin and immediately start a countdown.

**Warning signs:**
- Bot announces an answer immediately after reconnecting to a channel
- Channel receives double-join announcements
- Score announcements reference a game the channel never saw

**Prevention:**
- On any disconnect event, cancel all game timers and reset game state to "idle".
- On reconnect and channel rejoin, do not automatically resume a game — require an explicit start command.
- Use a single authoritative game state object per channel with an explicit state machine (IDLE, STARTING, QUESTION_ACTIVE, JUDGING, BETWEEN_QUESTIONS). Transitions are only valid from specific states. Reconnect always transitions to IDLE.
- Buffer any outgoing messages through a "connected" gate — drop messages silently if the IRC connection is not established.

**Phase to address:** Phase 1 (IRC connection handling) and Phase 2 (game state machine). The state machine must be defined before game logic is built.

---

### Pitfall 8: Runaway Claude API Costs

**What goes wrong:** The bot calls Claude for every answer attempt, not just the first plausible one. In an active channel, 10 players all typing guesses per question results in 10 API calls per question. At 30 questions per game session, that's 300 API calls — plus 30 for generation. With no rate limiting or budget cap, a busy channel can spend dollars per hour.

**Why it happens:** The naive implementation is: message received → looks like an answer → call Claude to judge. No pre-filter, no deduplication, no locking.

**Consequences:** Unexpected API bills. Anthropic's default rate limits may also cause 429 errors mid-game if the bot sends too many rapid requests.

**Prevention:**
- Lock question on first answer attempt: only one judging API call in flight at a time per channel (see Pitfall 3).
- Pre-filter with fast string matching (Levenshtein, lowercase normalization) before touching the API. The API call is only for cases the fast filter cannot resolve.
- Use prompt caching for the system prompt across judging calls (90% token cost reduction on the cached portion).
- Use claude-haiku-4-5 for judging ($1/$5 per million tokens input/output) — not Sonnet or Opus.
- Add per-channel and global daily API call counters. If the counter exceeds a configurable limit, pause judging and notify the channel.
- Set `max_tokens: 20` on all judging calls — the response is binary, never needs more.

**Phase to address:** Phase 2 (API integration). Cost controls must be in place before any public deployment.

---

### Pitfall 9: Question Repetition Within and Across Sessions

**What goes wrong:** Claude, without guidance, regenerates questions it has already asked in the same session — or across sessions. Players notice "we just had this question" and feel the "infinite variety" value proposition is broken. With no deduplication, the same handful of "obvious" questions for a topic (e.g., "What is the capital of France?" for Geography) dominate.

**Why it happens:** The LLM has no memory of previous API calls. Each call is stateless. Without recent question history in the context, it converges on the most statistically likely questions for a topic.

**Consequences:** Perceived repetitiveness. Experienced players memorize the small set and win trivially. The core differentiator (fresh questions) is undermined.

**Warning signs:**
- Same question text or near-identical question appearing in the same game session
- Players pre-answering questions before they finish typing

**Prevention:**
- Maintain a per-session "asked questions" set (in memory, keyed by normalized question text or a hash).
- Pass the last 5–10 question topics/subjects to Claude in the generation prompt: "Do not ask about: [list]."
- For cross-session deduplication, persist a bloom filter or hash set of recently used question hashes (last 100–500 questions). Check before accepting a generated question.
- Instruct Claude explicitly: "Generate an unusual or non-obvious question about [topic]. Avoid the most common trivia about this topic."

**Phase to address:** Phase 2 (question generation). Build the deduplication layer alongside the generation call.

---

### Pitfall 10: Undernet-Specific: Bot May Not Be Allowed on Some Servers

**What goes wrong:** Undernet's bot policy requires bots to be approved and requires operators to check the server's MOTD before connecting automated clients. Not all Undernet servers allow bots. Connecting a bot to a server that disallows bots can result in the connection being refused, the bot being G-lined (network-wide ban by IP), or the channel being flagged by channel services.

**Why it happens:** Undernet's documentation states: "No unapproved bots" in channels, and "Users must first find out which servers allow bot connections since not all of them do." Developers ignore the MOTD and connect to the nearest/fastest server.

**Consequences:** IP G-line prevents the bot from reconnecting from that IP. Channel Manager account can be at risk if the channel is associated with bot abuse.

**Warning signs:**
- Connection refused or immediate disconnect on connect
- Quit message includes "G-lined" or "K-lined"
- X issues a warning in the channel

**Prevention:**
- Read the MOTD of the target Undernet server at startup (`/MOTD`). Log it. Check manually before first deploy.
- Configure the bot to connect to a specific Undernet server known to allow bots (often listed in network documentation).
- Set a unique and identifiable bot username/ident (not "user" or "bot") and GECOS (real name field) that clearly identifies the bot and its purpose. This is standard Undernet courtesy.
- Do not run multiple bot instances (clone bots) — this is explicitly prohibited and causes channel purges.

**Phase to address:** Phase 1 (IRC connection configuration). Server selection is a deployment decision, not a code decision, but the bot must log the MOTD for operator awareness.

---

## Moderate Pitfalls

---

### Pitfall 11: Silent Failures in Async Error Paths

**What goes wrong:** Claude API call fails (network error, 529 overloaded, timeout). The error is caught but the game loop does not advance — the question stays "active" with no answer reveal, no next question, and no player feedback. The game silently stalls.

**Prevention:**
- Every API call must have a timeout and an error handler that advances the game state (reveal answer, move to next question) regardless of whether the call succeeded.
- Use a dead-man's timer: if no judging resolution within N seconds, force-reveal the answer.
- Log all API errors with full context (channel, question, error code) for debugging.

**Phase to address:** Phase 2 (game loop error handling).

---

### Pitfall 12: Answer Timing Window Too Short or Too Long

**What goes wrong:** Question timeout is too short for the difficulty (players never have time to answer) or too long (channel goes quiet waiting). With AI-generated questions, difficulty is inconsistent, so a fixed timeout fits poorly.

**Prevention:**
- Use a configurable per-game timeout (default 30s). Allow owner to adjust mid-session.
- Implement a hint system that reveals one character of the answer at N-second intervals — this gives a natural difficulty slope within each question.
- Do not use timeouts under 20 seconds for any question.

**Phase to address:** Phase 2 (game configuration).

---

### Pitfall 13: Scores Attributed to Wrong Nick After Nick Change

**What goes wrong:** A player answers correctly, then immediately changes their nickname before the score is written. The score is attributed to the old nickname. On leaderboard display, this creates phantom entries or misses the current nick.

**Prevention:**
- Score the answer at the moment it is determined correct, attributing it to the nick!user@host triple, not just the nickname.
- Display leaderboard by nickname at display time, but store internally by user@host. If the same user@host appears under multiple nicks, use the most recent one.
- This is a known edge case — document it as "expected behavior" in config/docs rather than over-engineering a fix for v1.

**Phase to address:** Phase 2 (scoring). Low-effort mitigation is sufficient for v1.

---

## Minor Pitfalls

---

### Pitfall 14: CTCP VERSION Spam

**What goes wrong:** Curious channel users send CTCP VERSION requests to the bot. Some IRC scripts auto-respond with server info, user count, or other data. If many users do this simultaneously, the bot's outgoing queue floods with CTCP replies.

**Prevention:** Ignore or minimally handle CTCP requests. Respond to VERSION with a brief static string ("aitrivia bot"). Do not auto-respond to CTCP PING or other requests.

**Phase to address:** Phase 1 (bot configuration). One-line fix.

---

### Pitfall 15: Long Question Text Wrapping Badly in IRC Clients

**What goes wrong:** Claude generates a 200-word question. IRC has a 512-byte line limit (including protocol overhead). Long questions get truncated mid-sentence by the server.

**Prevention:**
- In the generation prompt, specify maximum question length: "Keep the question under 300 characters."
- Add a server-side check: if the question text exceeds 400 characters, truncate and log a warning.
- IRC line limit is 512 bytes total including `PRIVMSG #channel :` overhead — safe limit for question text is ~400 characters.

**Phase to address:** Phase 2 (question generation prompt).

---

### Pitfall 16: Node.js IRC Library Choice — node-irc Is Unmaintained

**What goes wrong:** The most commonly cited Node.js IRC library (`node-irc` / `irc` on npm) has had its last commit in 2016 and 78+ open issues. Using it risks hitting known bugs (encoding issues, flood protection edge cases, Undernet-specific protocol quirks) with no upstream fixes available.

**Prevention:**
- Use `irc-framework` (kiwiirc). Latest release v4.14.0 in September 2024, actively maintained, IRCv3 compliant, designed for both bots and full clients. It has explicit flood protection configuration.
- Do not use `irc` (npm package backed by martynsmith/node-irc) for new projects.

**Phase to address:** Phase 1 (dependency selection). Choose correctly at the start.

---

## Phase-Specific Warnings

| Phase Topic | Likely Pitfall | Mitigation |
|-------------|----------------|------------|
| IRC connection setup | Flood self-disconnect | Rate-limited send queue, irc-framework |
| Owner auth | Nick spoofing | Hostmask + nick check, optional X account check |
| Question generation | Hallucination, repetition | Low temp, dedup history, answer variants in output |
| Answer judging | Latency races, over-accept | Lock on first answer, fast pre-filter, rubric prompt |
| Scoring | Nick change attribution | Score by user@host, display by current nick |
| Persistence | Crash corruption | Atomic writes, startup validation |
| Game state | Reconnect orphan timers | Reset to IDLE on any disconnect |
| API costs | Unbounded call volume | Pre-filter, lock, haiku model, max_tokens cap |
| Deployment | Undernet bot policy | Check server MOTD, single instance only |

---

## Sources

- [Undernet Flood Protection Documentation](https://www.undernet.org/docs/noflood) — Flood categories and consequences on Undernet
- [node-irc Flood Protection API](https://node-irc.readthedocs.io/en/latest/API.html) — `floodProtection` and `floodProtectionDelay` options
- [irc-framework on GitHub](https://github.com/kiwiirc/irc-framework) — Actively maintained Node.js IRC library (v4.14.0, Sept 2024)
- [IRC Phishing with Typosquatting](https://blog.yossarian.net/2015/05/28/IRC-Phishing-With-Typosquatting) — Nickname spoofing attack patterns
- [Undernet IRC FAQ Part 1](https://www.undernet.org/docs/undernet-irc-faq-part-i) — X bot auth, WHOIS account field, Undernet quirks
- [Undernet Rules](https://www.undernet.org/rules/) — Bot approval policy
- [Claude Latency Reduction Guide](https://platform.claude.com/docs/en/test-and-evaluate/strengthen-guardrails/reduce-latency) — Model selection, max_tokens, streaming for latency
- [Claude Pricing](https://platform.claude.com/docs/en/about-claude/pricing) — Haiku vs Sonnet cost tradeoffs; prompt caching 90% savings
- [LLM-as-Judge Practical Guide](https://towardsdatascience.com/llm-as-a-judge-a-practical-guide/) — Over-reasoning, rubric design, few-shot examples for consistent judging
- [SQLite WAL Corruption Bug](https://sqlite.org/wal.html) — WAL-mode corruption risk; bug patched in 3.51.3 (March 2026)
- [MansionNET QuizBot](https://github.com/MansionNET/QuizBot) — Reference AI-powered IRC trivia bot; fallback questions, multi-channel state
- [QuakeNet Quit Message FAQ](https://www.quakenet.org/help/general/what-do-those-quit-messages-mean) — "Max sendQ exceeded" disconnect explanation
- [PARROT LLM Trivia Benchmark](https://www.redblock.ai/resources/blog/parrot-how-we-used-game-show-trivia-to-build-an-llm-benchmark) — Simple string matching outperforming LLM judges on fuzzy trivia tasks
