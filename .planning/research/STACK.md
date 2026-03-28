# Technology Stack

**Project:** aitrivia — AI-powered IRC trivia bot
**Target network:** Undernet
**Researched:** 2026-03-28
**Overall confidence:** HIGH (all core choices verified against official sources or npm registry)

---

## Recommended Stack

### Runtime

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| Node.js | 22 LTS | Runtime | LTS through April 2027; native ESM; `node:sqlite` experimental but better-sqlite3 prebuilds fully support it. Do NOT use Node 24 yet — better-sqlite3 v12.x has reported V8 API breakage on Node 24. |

### IRC Client

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| irc-framework | ^4.14.0 | IRC client, event model, message matching | Actively maintained by KiwiIRC (v4.14.0 released Sep 2024). Built for bots — provides `matchMessage()`, middleware pipeline, auto-reconnect, IRCv3 CAP negotiation, and built-in rate limiting via message queue. All alternatives are effectively abandoned: `node-irc` / `irc` (martynsmith) has been unmaintained for years; `irc-upd` / `@ctrl/irc` are forks but trail in features; `matrix-org` libraries target Matrix bridges not IRC. |

### AI Integration

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| @anthropic-ai/sdk | ^0.36+ (latest) | Question generation, answer evaluation | Official Anthropic SDK; 7M+ weekly npm downloads; typed interfaces, automatic retries, streaming. Use `claude-haiku-4-5-20251001` (alias: `claude-haiku-4-5`) as default model — fastest, cheapest ($1/$5 per MTok), sufficient intelligence for trivia generation and freeform answer judging. Sonnet is unnecessary overhead for this workload. |

### Persistence

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| better-sqlite3 | ^12.4.6 | Scores, leaderboard, session state | Synchronous API eliminates async complexity in IRC event handlers. 1.3M weekly downloads, fastest SQLite library for Node, Node 22 fully supported via prebuilds. A single `.db` file satisfies the "survive bot restarts" requirement with zero infrastructure. Avoid JSON/lowdb: fragile on concurrent writes; loses data if process is killed mid-write. Avoid `node:sqlite` built-in (Node 22): still experimental and missing prepared-statement stability guarantees. |

### Config Management

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| node-config | ^3.3.12 | Bot config (network, channels, topics, difficulty) | Supports YAML config files (human-friendly for an IRC bot operator), environment-specific overlays, and runtime `has()`/`get()` access. Bot operators expect to edit a YAML file, not set env vars. |
| dotenv | ^16.x | Secrets only (ANTHROPIC_API_KEY) | Keep secrets out of the config file. dotenv loads `ANTHROPIC_API_KEY` from `.env`; everything else lives in `config/default.yaml`. Do NOT store the API key in the config file. |

### Testing

| Technology | Version | Purpose | Why |
|------------|---------|---------|-----|
| vitest | ^2.x | Unit and integration tests | Native ESM, TypeScript without config, instant startup. The 2025-2026 community default for new Node.js projects. Jest requires additional transform config for ESM; no reason to accept that overhead on a greenfield project. |
| sinon (via vitest) | built-in stubs | Mocking IRC client, Claude responses | vitest ships `vi.fn()` / `vi.spyOn()` — no extra mocking library needed for this complexity level. |

---

## Undernet-Specific Considerations

### No SASL — Use LoC (Login on Connect)

Undernet does NOT use NickServ. Authentication is via the **X** channel services bot (`x@channels.undernet.org`). There are two patterns for bots:

**Option A — Send LOGIN after connect (recommended for simplicity):**
```
// In the bot's 'registered' event handler:
client.say('x@channels.undernet.org', `LOGIN ${xUsername} ${xPassword}`);
```

**Option B — LoC server password field:**
irc-framework's `password` option maps to the IRC `PASS` command. Undernet supports Login on Connect via a formatted server password:
```
password: `-!+x ${xUsername} ${xPassword}`
```
This authenticates with X and requests usermode `+x` (IP masking) at connect time, before channel joins. Recommended for production bots.

### Do Not Use SASL

irc-framework supports SASL via the `account` option, but Undernet's ircu2 server does not support the SASL CAP. Passing an `account` object to irc-framework will cause the CAP negotiation to fail silently or prevent registration. Leave `account` unset (or set to `{}`).

### No Nick Registration

Undernet does not run NickServ. Nick ownership is informal. Owner authentication in aitrivia is solely by comparing `message.nick` to a configured owner nick — standard and correct for this network.

### ircu2 Quirks

- Undernet runs ircu2, which is older and does not support many IRCv3 extensions. irc-framework degrades gracefully when caps are not offered.
- Channel modes and the NAMES reply format differ slightly from modern networks. Use `client.channel(name).users` from irc-framework rather than parsing raw NAMES manually.
- Default port: `6667` (plaintext). TLS is available on `6697` on some servers but inconsistently supported across Undernet's server pool. Use `6667` for maximum compatibility unless you control server selection.

---

## Alternatives Considered

| Category | Recommended | Alternative | Why Not |
|----------|-------------|-------------|---------|
| IRC client | irc-framework ^4.14.0 | node-irc / irc (martynsmith) | Last meaningful commit 2019; multiple open security issues; no IRCv3 |
| IRC client | irc-framework ^4.14.0 | irc-upd / @ctrl/irc | TypeScript types are good but fewer features; smaller maintenance team |
| Persistence | better-sqlite3 | lowdb / JSON file | No transaction safety; data loss on crash |
| Persistence | better-sqlite3 | node:sqlite (built-in) | Experimental in Node 22; API not stable yet |
| Persistence | better-sqlite3 | PostgreSQL / MySQL | Gross overkill; requires running a server process |
| AI model | claude-haiku-4-5 | claude-sonnet-4-6 | 3x cost, 2x latency; trivia Q&A does not need Sonnet-level reasoning |
| AI model | claude-haiku-4-5 | OpenAI GPT-4o-mini | Worse instruction following for structured JSON output in testing; Anthropic SDK is already a dependency |
| Testing | vitest | Jest | ESM transform boilerplate; no benefit for a new project |
| Config | node-config | convict | More schema validation than needed; overkill for a single-config bot |
| Secrets | dotenv | hardcoded / config file | Never put API key in a committed file |

---

## Installation

```bash
# Runtime check
node --version  # Must be 22.x

# Core dependencies
npm install irc-framework @anthropic-ai/sdk better-sqlite3 node-config dotenv

# Dev dependencies
npm install -D vitest
```

### Minimum package.json snippets

```json
{
  "type": "module",
  "engines": { "node": ">=22.0.0" },
  "scripts": {
    "start": "node src/index.js",
    "test": "vitest run",
    "test:watch": "vitest"
  }
}
```

---

## Claude API Usage Pattern for Trivia

Keep prompts lean to minimize token cost. Two call types:

**Question generation** (one call per round):
```js
const response = await anthropic.messages.create({
  model: 'claude-haiku-4-5-20251001',
  max_tokens: 256,
  messages: [{
    role: 'user',
    content: `Generate a trivia question about ${topic}. Difficulty: ${difficulty}.
Reply with JSON only: {"question": "...", "answer": "...", "hint": "..."}`
  }]
});
```

**Answer evaluation** (one call per answer attempt, or batch with a time-based trigger):
Consider evaluating answers locally first (case-insensitive string match against `answer`) and only calling Claude when the local match fails — saves significant cost for obvious correct answers.

---

## Sources

- irc-framework npm: https://www.npmjs.com/package/irc-framework (v4.14.0, Sep 2024)
- irc-framework GitHub: https://github.com/kiwiirc/irc-framework
- irc-framework Client API docs: https://github.com/kiwiirc/irc-framework/blob/master/docs/clientapi.md
- Anthropic models overview: https://platform.claude.com/docs/en/about-claude/models/overview (verified Mar 2026)
- Anthropic SDK npm: https://www.npmjs.com/package/@anthropic-ai/sdk
- better-sqlite3 GitHub: https://github.com/WiseLibs/better-sqlite3
- better-sqlite3 Node 22 discussion: https://github.com/WiseLibs/better-sqlite3/discussions/1245
- Undernet X commands: https://www.undernet.org/docs/x-commands-english
- Undernet LoC docs: https://cservice.undernet.org/docs/xcmds.txt
- Jest vs Vitest 2025: https://medium.com/@ruverd/jest-vs-vitest-which-test-runner-should-you-use-in-2025-5c85e4f2bda9
- node-config docs: https://github.com/node-config/node-config/wiki/Configuration-Files
