# Phase 1: Foundation - Research

**Researched:** 2026-03-28
**Domain:** Node.js IRC bot — irc-framework, better-sqlite3, node-config, rate-limited send queue, owner auth
**Confidence:** HIGH

---

<phase_requirements>
## Phase Requirements

| ID | Description | Research Support |
|----|-------------|------------------|
| IRC-01 | Bot connects to Undernet using irc-framework with configurable server/port | irc-framework constructor options: host, port, nick, username, gecos. See Standard Stack §IRC Client. |
| IRC-02 | Bot authenticates with Undernet X bot via LoC (Login on Connect) from config | Two patterns verified: server PASS field (`+x! user pass`) or post-connect `say()` to x@channels.undernet.org. See Architecture Patterns §Undernet LoC Auth. |
| IRC-03 | Bot automatically reconnects after disconnect or netsplit | irc-framework `auto_reconnect`, `auto_reconnect_max_wait`, `auto_reconnect_max_retries` options. Backoff implemented by increasing wait. See §Reconnect Strategy. |
| IRC-04 | Bot resets all active game state to IDLE on disconnect (no orphaned timers) | `close` / `socket close` events trigger state reset. See Architecture Patterns §Disconnect/Reconnect Lifecycle. |
| IRC-05 | All outbound IRC messages pass through a rate-limited send queue (flood protection) | irc-framework has NO built-in flood protection (verified from source). Bot must implement its own queue. See §Rate-Limited Send Queue. |
| IRC-06 | Bot responds to server PINGs to maintain connection | irc-framework handles PING/PONG automatically. `ping_interval` (30s default) and `ping_timeout` (120s default) are configurable. No manual handling needed. |
| BOT-03 | Bot joins configured default channels on startup | Call `client.join(channel)` in the `registered` event handler for each channel in config. |
| BOT-04 | Bot ignores commands from non-owners | Owner check in command handler compares nick AND hostmask before routing. Silent drop on mismatch. See §Owner Auth Flow. |
| AUTH-01 | Owner identified by IRC nickname AND hostmask (not nickname alone) | IRC hostmask = `nick!user@host`. Extract from event object `event.hostname`. Match config pattern with glob (`*`, `?`). See §Hostmask Matching. |
| AUTH-02 | Owner list is configurable in config file | YAML array in `config/default.yaml`: `owners: [{nick: "x", hostmask: "*!user@host.com"}]`. |
| AUTH-03 | Bot rejects commands from users matching owner nickname but wrong hostmask | Auth check evaluates BOTH fields; if nick matches but hostmask does not, command is silently dropped. |
| SCORE-01 | Player scores stored in SQLite (better-sqlite3) and persist across restarts | better-sqlite3 synchronous API, WAL mode, prepared statements. See §Persistence Layer. |
| SCORE-04 | Score writes use atomic transactions to prevent corruption on crash | `db.transaction()` wraps all multi-step writes. WAL mode provides crash safety. See §better-sqlite3 WAL Setup. |
| CONF-01 | Config file (YAML) controls server, port, nick, LoC credentials, default channels, owner list, topics, difficulty, question count, timeout | node-config reads `config/default.yaml`. See §Config Pattern. |
| CONF-02 | ANTHROPIC_API_KEY is loaded from .env only, never from config file | dotenv loads `.env` before node-config; API key read from `process.env.ANTHROPIC_API_KEY` directly, never from config object. |
</phase_requirements>

---

## Summary

Phase 1 builds the foundation every other phase depends on: a crash-safe IRC bot that connects to Undernet, authenticates with X, manages reconnection, protects against flood disconnects, and stores scores durably. The technical domain is well-understood with HIGH-confidence sources for all components.

The single most important implementation insight from this research: **irc-framework has no built-in flood protection in its transport layer.** The source code confirms `writeLine()` sends immediately with no queue or delay. The bot must implement its own rate-limited send queue before any game logic exists — all `client.say()` calls must be routed through it. A simple FIFO queue drained by `setInterval` at 600ms per message is the correct approach for Undernet.

The second key insight: **better-sqlite3 v12.8.0 bundles SQLite 3.51.3**, which contains the March 2026 WAL corruption bug fix. Install exactly `better-sqlite3@12.8.0` (or pin `>=12.8.0`) — earlier versions bundle SQLite 3.51.2 or older and are affected by the WAL bug. Enable WAL mode immediately after opening the database.

**Primary recommendation:** Build IRC Layer and Persistence Layer as independent modules in Wave 1; wire them together with the config loader. The send queue is part of the IRC Layer. Owner auth is part of the Command Handler. All five components in the architecture diagram map directly to Phase 1 scope (minus AI Layer, which is Phase 2).

---

## Project Constraints (from CLAUDE.md)

The global `CLAUDE.md` applies to this project. Relevant directives:

| Directive | Impact on Phase 1 |
|-----------|-------------------|
| Source code in `/src` | All bot source files under `src/` |
| Tests in `/tests` | Vitest test files under `tests/` |
| Config in `/config` | `config/default.yaml` for node-config |
| Files under 500 lines | Each module (ircClient, sendQueue, db, config, commandHandler) gets its own file |
| DDD with bounded contexts | IRC Layer, Persistence Layer, Command Handler are bounded contexts with clean interfaces |
| Typed interfaces for all public APIs | Export typed JSDoc or TypeScript interfaces for each module's public surface |
| Input validation at system boundaries | Validate config values at load time; validate incoming IRC event fields before processing |
| NEVER commit .env files | `.env` in `.gitignore`; `config/default.yaml` contains no secrets |
| NEVER hardcode API keys | `ANTHROPIC_API_KEY` from `process.env` only |
| Run tests after code changes | `npm test` (vitest) after each module |

---

## Standard Stack

### Core

| Library | Version | Purpose | Why Standard |
|---------|---------|---------|--------------|
| Node.js | 22 LTS (22.20.0 installed) | Runtime | LTS until April 2027; required for better-sqlite3 prebuilds. Do NOT use Node 24. |
| irc-framework | 4.14.0 (latest) | IRC client, events, reconnect | Only actively maintained Node.js IRC library; built for bots; IRCv3 |
| better-sqlite3 | 12.8.0 (latest) | Score persistence | Synchronous API, bundles SQLite 3.51.3 (WAL bug fixed), zero infrastructure |
| node-config | 3.3.12 (latest) | YAML config loading | Supports YAML; environment overlays; `config/default.yaml` is human-editable |
| dotenv | 17.3.1 (latest) | Secret isolation | Loads `ANTHROPIC_API_KEY` from `.env` before node-config initializes |

### Supporting

| Library | Version | Purpose | When to Use |
|---------|---------|---------|-------------|
| vitest | 4.1.2 (latest) | Unit testing | Test each module in isolation; mock IRC client with `vi.fn()` |

### Alternatives Considered

| Instead of | Could Use | Tradeoff |
|------------|-----------|----------|
| irc-framework | node-irc / irc | Last commit 2016; open security issues; no IRCv3 — do not use |
| better-sqlite3 | node:sqlite built-in | Experimental in Node 22; API not stable — do not use |
| node-config | convict | More schema boilerplate than needed for a single-config bot |
| dotenv | node-config secrets | Never put API key in a committed config file |

**Installation:**

```bash
# Verify Node version first
node --version  # Must be 22.x

npm install irc-framework better-sqlite3@12.8.0 node-config dotenv
npm install -D vitest
```

**package.json minimum:**

```json
{
  "type": "module",
  "engines": { "node": ">=22.0.0" },
  "scripts": {
    "start": "node src/index.js",
    "test": "vitest run",
    "test:watch": "vitest",
    "lint": "echo 'no linter configured yet'"
  }
}
```

**Version verification (confirmed 2026-03-28):**
- `irc-framework`: 4.14.0 (released Sep 2024)
- `better-sqlite3`: 12.8.0 (released Mar 13, 2026, bundles SQLite 3.51.3)
- `node-config`: 0.0.2 on npm top-level but `3.3.12` is the correct `node-config` package — verify with `npm view node-config version`
- `dotenv`: 17.3.1
- `vitest`: 4.1.2

---

## Architecture Patterns

### Recommended Project Structure

```
aitrivia/
├── config/
│   └── default.yaml          # node-config main config (no secrets)
├── data/
│   └── scores.db             # better-sqlite3 database (gitignored)
├── src/
│   ├── index.js              # Entry point: load config, create client, wire up
│   ├── irc/
│   │   ├── client.js         # irc-framework wrapper, connect, reconnect
│   │   └── sendQueue.js      # Rate-limited send queue (FIFO + setInterval)
│   ├── db/
│   │   └── database.js       # better-sqlite3 setup, WAL, schema, queries
│   ├── commands/
│   │   └── commandHandler.js # !command parsing, owner auth, routing
│   └── config/
│       └── loader.js         # Validates and exposes typed config object
├── tests/
│   ├── irc/
│   │   ├── client.test.js
│   │   └── sendQueue.test.js
│   ├── db/
│   │   └── database.test.js
│   └── commands/
│       └── commandHandler.test.js
├── .env                      # ANTHROPIC_API_KEY (gitignored)
├── .env.example              # Template with placeholder values (committed)
├── .gitignore
└── package.json
```

### Pattern 1: irc-framework Connection and Registration

**What:** Create the irc-framework Client, connect with Undernet options, listen for the `registered` event to join channels and authenticate with X.

**When to use:** Application startup.

```javascript
// Source: https://github.com/kiwiirc/irc-framework/blob/master/docs/clientapi.md
import IRC from 'irc-framework';

const client = new IRC.Client();

client.connect({
  host: config.get('irc.host'),       // e.g. 'us.undernet.org'
  port: config.get('irc.port'),       // 6667
  nick: config.get('irc.nick'),
  username: config.get('irc.username'),
  gecos: config.get('irc.gecos'),     // 'aitrivia bot'
  // LoC Option A — server password field (preferred for production):
  // password: `+x! ${xUsername} ${xPassword}`
  // LoC Option B — post-connect LOGIN (simpler for dev):
  // (no password field; send LOGIN in 'registered' handler)
  auto_reconnect: true,
  auto_reconnect_max_wait: 30000,     // max 30s between attempts
  auto_reconnect_max_retries: 10,
  ping_interval: 30,
  ping_timeout: 120,
});

client.on('registered', () => {
  // Option B LoC: send LOGIN after connect
  // client.say('x@channels.undernet.org', `LOGIN ${xUsername} ${xPassword}`);

  // Join default channels
  for (const channel of config.get('irc.channels')) {
    client.join(channel);
  }
});
```

### Pattern 2: Rate-Limited Send Queue

**What:** A FIFO queue that wraps `client.say()` and drains at a fixed interval. ALL outbound messages go through this — never call `client.say()` directly outside the queue.

**When to use:** Replace every `client.say()` call in the codebase.

**Why FIFO + setInterval rather than token bucket:** IRC flood protection is about sustained throughput (messages/second), not burst tolerance. A simple fixed-rate drain is predictable and sufficient. Token bucket adds complexity with no benefit for this use case.

```javascript
// src/irc/sendQueue.js
// Source pattern: IRC flood control is a fixed-rate drain problem

export class SendQueue {
  #queue = [];
  #timer = null;
  #intervalMs;
  #sendFn;

  constructor(sendFn, intervalMs = 600) {
    this.#sendFn = sendFn;
    this.#intervalMs = intervalMs;
  }

  start() {
    this.#timer = setInterval(() => this.#drain(), this.#intervalMs);
  }

  stop() {
    if (this.#timer) {
      clearInterval(this.#timer);
      this.#timer = null;
    }
  }

  clear() {
    this.#queue = [];
  }

  enqueue(target, message) {
    this.#queue.push({ target, message });
  }

  #drain() {
    const item = this.#queue.shift();
    if (item) {
      this.#sendFn(item.target, item.message);
    }
  }
}

// Usage in client wrapper:
// const queue = new SendQueue((target, msg) => client.say(target, msg));
// queue.start();
// // Replace all client.say() with:
// queue.enqueue('#channel', 'Hello world');
```

**Queue interval:** 600ms between messages. Undernet's ircu allows approximately 1-2 messages/second for registered users. 600ms provides comfortable headroom. Reduce to 500ms only if tested and confirmed safe on the target server.

**On disconnect:** Call `queue.stop()` and `queue.clear()` in the `close`/`socket close` event handler to prevent queued messages from being sent into a dead socket.

### Pattern 3: Undernet LoC Authentication

**What:** Two verified approaches for X bot authentication on Undernet.

**Option A — Server password field (recommended for production):**

```javascript
// Source: https://www.undernet.org/docs/x-commands-english
// The password field maps to the IRC PASS command sent before registration
client.connect({
  // ...other options...
  password: `+x! ${xUsername} ${xPassword}`,
  // +x = request IP masking (usermode +x)
  // ! = connect even if X is offline (use - to require X online)
  // Variants: '+x!' connect anytime + mask, '-x!' connect anytime + no mask,
  //           '-!+x' connect anytime + mask only if X online
});
```

**Option B — Post-connect LOGIN (simpler for dev/testing):**

```javascript
client.on('registered', () => {
  // Source: https://www.undernet.org/docs/x-commands-english
  client.say('x@channels.undernet.org', `LOGIN ${xUsername} ${xPassword}`);
  // If using TOTP: `LOGIN ${xUsername} ${xPassword} ${totpCode}`
});
```

**Recommendation:** Use Option B during development (easier to debug, no PASS format to get wrong). Switch to Option A for production deployment (authenticates before channel joins, ensures +x usermode is set at connect time).

**SASL:** Do NOT set the `account` option on irc-framework. Undernet's ircu2 does not support the SASL CAP. Setting it causes silent CAP negotiation failure.

### Pattern 4: better-sqlite3 WAL Setup and Schema

**What:** Open database, enable WAL mode immediately, create schema if not exists, expose prepared statements.

**When to use:** Application startup, before any game logic runs.

```javascript
// src/db/database.js
// Source: https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md
import Database from 'better-sqlite3';
import { mkdirSync } from 'node:fs';

export function openDatabase(dbPath) {
  // Ensure data/ directory exists
  mkdirSync(new URL('../..', import.meta.url).pathname + '/data', { recursive: true });

  const db = new Database(dbPath);

  // CRITICAL: Enable WAL mode immediately after opening
  // better-sqlite3 v12.8.0 bundles SQLite 3.51.3 which has the WAL bug fix
  db.pragma('journal_mode = WAL');
  db.pragma('synchronous = NORMAL');  // Safe with WAL; faster than FULL

  // Create schema
  db.exec(`
    CREATE TABLE IF NOT EXISTS scores (
      nick       TEXT NOT NULL,
      channel    TEXT NOT NULL,
      points     INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL,
      PRIMARY KEY (nick, channel)
    );

    CREATE TABLE IF NOT EXISTS game_sessions (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      channel    TEXT NOT NULL,
      topic      TEXT,
      rounds     INTEGER,
      started_at INTEGER NOT NULL,
      ended_at   INTEGER
    );
  `);

  return db;
}
```

**Atomic score write pattern:**

```javascript
// Source: https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md
const upsertScore = db.prepare(`
  INSERT INTO scores (nick, channel, points, updated_at)
  VALUES (@nick, @channel, @points, @updatedAt)
  ON CONFLICT(nick, channel)
  DO UPDATE SET
    points = points + @points,
    updated_at = @updatedAt
`);

// Wrap in transaction for atomicity
const addScore = db.transaction((nick, channel, pointsDelta) => {
  upsertScore.run({
    nick,
    channel,
    points: pointsDelta,
    updatedAt: Date.now(),
  });
});

// Call site:
addScore('PlayerNick', '#trivia', 1);
```

**The `db.transaction()` wrapper is the crash-safety mechanism.** If the process is killed mid-transaction, SQLite rolls back. WAL mode ensures committed transactions survive crashes.

### Pattern 5: node-config YAML + dotenv Integration

**What:** Load dotenv first, then node-config reads YAML. Secrets stay in `.env` and are accessed directly from `process.env`.

**When to use:** Application entry point, before any other module is imported.

```javascript
// src/index.js — entry point, first lines
import 'dotenv/config';           // Loads .env into process.env
import config from 'config';      // Reads config/default.yaml

// Access structured config via node-config
const ircHost = config.get('irc.host');

// Access secrets directly from process.env — NEVER via config.get()
const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set in .env');
```

**config/default.yaml:**

```yaml
# Source: https://github.com/node-config/node-config/wiki/Configuration-Files
irc:
  host: us.undernet.org
  port: 6667
  nick: aitrivia
  username: aitrivia
  gecos: "AI Trivia Bot"
  channels:
    - "#trivia"
  xUsername: ""        # Undernet X login username
  xPassword: ""        # Undernet X login password (consider moving to .env)

owners:
  - nick: "YourNick"
    hostmask: "*!yourident@your.host.com"

game:
  defaultTopic: "general knowledge"
  difficulty: medium
  questionCount: 10
  timeoutSeconds: 30
```

**Note on X credentials:** `xUsername` and `xPassword` can remain in the YAML for bot operator convenience (it's the IRC credentials, not the Anthropic API key), but document clearly that the YAML file should not be committed with real credentials, or move them to `.env` as well.

### Pattern 6: Hostmask Matching

**What:** IRC hostmasks have the format `nick!ident@hostname`. Owner auth checks both the `nick` field AND the `hostname` field from the message event. Config stores glob patterns.

**Format reference:**
- Exact: `Stefan!stefan@1.2.3.4`
- Wildcard ident: `Stefan!*@1.2.3.4`
- Wildcard host: `Stefan!stefan@*.myisp.com`
- Fully wildcard: `*!*@trusted.host.com` (match by host only — use with caution)

**irc-framework event properties:**
- `event.nick` — the nickname only (e.g. `"Stefan"`)
- `event.hostname` — the host portion only (e.g. `"1.2.3.4"` or `"user.myisp.com"`)
- **Full hostmask** is NOT a single field — construct it: `` `${event.nick}!${event.ident}@${event.hostname}` ``

**Note:** irc-framework's `message` event exposes `event.hostname` as the host part. The ident (username) may be available as `event.ident` or `event.user` depending on the event type. Verify during implementation with a debug listener.

**Glob matching implementation (no external library needed):**

```javascript
// Converts IRC glob pattern to RegExp
// * → .*, ? → .
function globToRegex(pattern) {
  const escaped = pattern
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')  // escape regex special chars
    .replace(/\*/g, '.*')                    // * → .*
    .replace(/\?/g, '.');                    // ? → .
  return new RegExp(`^${escaped}$`, 'i');    // case-insensitive
}

function isOwner(event, ownerList) {
  const fullMask = `${event.nick}!${event.ident ?? '*'}@${event.hostname}`;
  return ownerList.some(owner => {
    const nickMatch = owner.nick.toLowerCase() === event.nick.toLowerCase();
    const maskRegex = globToRegex(owner.hostmask);
    return nickMatch && maskRegex.test(fullMask);
  });
}
```

**Why nick AND hostmask:** Undernet has no NickServ. Any user can change their nick to the owner's nick when the owner is offline. Hostmask verification prevents impersonation. An attacker would need the same ident and connecting host/IP to bypass this check.

### Pattern 7: Disconnect/Reconnect Lifecycle

**What:** Use irc-framework's built-in auto-reconnect with appropriate config. On disconnect, cancel timers and reset game state to IDLE. On reconnect, re-authenticate and re-join channels.

**irc-framework reconnect behavior:**
- `auto_reconnect: true` enables automatic reconnection
- `auto_reconnect_max_wait: 30000` — maximum delay between retries (ms)
- `auto_reconnect_max_retries: 10` — after this many failures, stop retrying
- The framework increases wait time between retries (exponential-like behavior)
- The `reconnecting` event fires before each reconnect attempt
- The `registered` event fires when reconnection succeeds (same as initial connect)

**Event sequence for netsplit/disconnect:**

```
socket close  → fires when TCP socket closes
close         → fires when irc-framework's connection is fully closed
reconnecting  → fires before each reconnect attempt
registered    → fires when reconnect succeeds (re-join channels here)
```

**Disconnect handler pattern:**

```javascript
// Source: https://github.com/kiwiirc/irc-framework — event system
client.on('close', () => {
  // 1. Stop and clear the send queue
  sendQueue.stop();
  sendQueue.clear();

  // 2. Reset all game state to IDLE (Phase 2 concern, but wire up now)
  // gameEngine.resetAll();

  // 3. Log the disconnect
  console.log('[IRC] Disconnected — game state reset, awaiting reconnect');
});

client.on('reconnecting', (event) => {
  console.log(`[IRC] Reconnecting... attempt after ${event.wait}ms`);
});

client.on('registered', () => {
  // Restart the send queue (was stopped on disconnect)
  sendQueue.start();

  // Re-authenticate with X
  client.say('x@channels.undernet.org', `LOGIN ${xUsername} ${xPassword}`);

  // Re-join all configured channels
  for (const channel of config.get('irc.channels')) {
    client.join(channel);
  }
});
```

**Important:** Game state reset on disconnect is defined in Phase 1 (IRC-04) but the game state Map lives in Phase 2's Game Engine. For Phase 1, wire the hook into the IRC Layer as an empty stub or EventEmitter event (`ircLayer.emit('disconnect')`) that the Game Engine will subscribe to in Phase 2.

### Anti-Patterns to Avoid

- **Direct client.say() calls:** All outbound messages must go through `SendQueue.enqueue()`. Scattered direct `client.say()` calls bypass flood protection.
- **Checking nick only for owner auth:** `event.nick === ownerNick` is trivially spoofed on Undernet. Always check hostmask too.
- **Storing ANTHROPIC_API_KEY in default.yaml:** That file gets committed to git. Use `.env` only.
- **Opening SQLite without WAL mode:** Default journal mode is DELETE which is slower and less crash-safe. First line after `new Database()` must be `db.pragma('journal_mode = WAL')`.
- **Installing better-sqlite3 < 12.8.0:** Versions before 12.8.0 bundle SQLite 3.51.2 or earlier, which has the WAL corruption bug fixed in 3.51.3.
- **Calling `client.join()` before `registered` event:** Sending IRC commands before registration completes causes the server to ignore them or disconnect the bot.

---

## Don't Hand-Roll

| Problem | Don't Build | Use Instead | Why |
|---------|-------------|-------------|-----|
| IRC protocol parsing | Custom TCP + RFC 1459 parser | irc-framework | IRCv3, CAP negotiation, PING/PONG, reconnect, encoding, message splitting |
| IRC reconnect with backoff | Custom retry loop with setTimeout | irc-framework `auto_reconnect` options | Handles edge cases: netsplits, ping timeouts, socket errors |
| IRC PING/PONG | Manual PONG handler | irc-framework (automatic) | Built-in with configurable intervals |
| SQLite async wrapper | Promise wrappers around sqlite3 | better-sqlite3 (synchronous) | In IRC event handlers, synchronous is correct — no callback hell |
| Config file parsing | Custom YAML parser | node-config | Handles file loading, environment overlays, `has()` / `get()` type safety |
| Glob-to-regex for hostmask | External minimatch library | 8-line custom `globToRegex()` | IRC hostmasks only use `*` and `?` — minimatch is overkill |

**Key insight:** The IRC protocol has 30 years of edge cases. irc-framework exists precisely because every custom IRC implementation eventually hits them. Use it.

---

## Common Pitfalls

### Pitfall 1: irc-framework Has No Built-In Flood Protection

**What goes wrong:** The transport layer (`net.js`) sends messages immediately via `socket.write()` with no queue or delay. Burst output — question announcement + score display — gets all lines sent at once, exceeds Undernet's per-user send buffer, and triggers "Excess Flood" disconnect.

**Why it happens:** The docs mention "Rate Limiting: The framework manages message delivery timing" in the README but source code analysis shows this is NOT implemented in the transport or connection layer. The `message_max_length` option only controls line breaking, not send rate.

**Confidence:** HIGH — confirmed by reading `src/transports/net.js` and `src/connection.js` source directly.

**How to avoid:** Build `SendQueue` as the first module. Route ALL `client.say()` calls through it. 600ms minimum interval.

**Warning signs:** Bot works in solo testing but disconnects with "Excess Flood" or "Max sendQ exceeded" when a game runs with multiple messages.

---

### Pitfall 2: X LoC Auth Must Re-Run on Every Reconnect

**What goes wrong:** On initial connect, the bot authenticates with X. After a netsplit, irc-framework reconnects automatically and fires the `registered` event again. If the `registered` handler doesn't include the X LOGIN command, the bot reconnects without X authentication — losing its channel service credentials until manually fixed.

**Why it happens:** The `registered` event handler is the only place to put startup logic. Developers add the LOGIN call once and forget it must fire on every registration (initial and reconnect).

**How to avoid:** The `registered` event handler ALWAYS sends the X LOGIN command. It is not a "first boot" handler — it is a "bot is now on the IRC network" handler. This is also where `sendQueue.start()` must be called.

---

### Pitfall 3: better-sqlite3 v12.8.0 vs Earlier WAL Bug

**What goes wrong:** Installing `better-sqlite3` without pinning to `>=12.8.0` pulls in v12.6.x or v12.7.x, which bundle SQLite 3.51.2 or earlier. These versions have a WAL-mode corruption bug in high-write scenarios. Score data can be silently corrupted on crash.

**Why it happens:** `npm install better-sqlite3` without a version specifier installs the latest, which IS 12.8.0 today. But if a lockfile pins an older version, or if someone installs on a date when 12.8.0 was not yet released, they get the buggy version.

**How to avoid:** Pin explicitly: `npm install better-sqlite3@12.8.0`. Verify the bundled SQLite version in the Phase 1 setup task.

**Warning signs:** Scores are missing or have wrong values after an unclean shutdown during heavy activity.

---

### Pitfall 4: irc-framework `event.ident` vs `event.hostname` field names

**What goes wrong:** The ident (username) part of a hostmask may be exposed as `event.ident`, `event.user`, or not at all depending on the event type (message vs join vs whois). Building the full hostmask string using the wrong field name results in incomplete matching (e.g., matching `Stefan!undefined@host` against a pattern).

**Why it happens:** irc-framework's documentation doesn't exhaustively list every property on every event object. The field names are inferred from source code or debugging.

**How to avoid:** In the Phase 1 implementation, add a debug listener early:
```javascript
client.on('message', (event) => {
  console.debug('[AUTH DEBUG]', JSON.stringify({
    nick: event.nick,
    ident: event.ident,
    user: event.user,
    hostname: event.hostname,
    host: event.host,
  }));
});
```
Run against a real connection to confirm field names before writing the isOwner() function.

---

### Pitfall 5: node-config Requires `config/` Directory (Not `src/config/`)

**What goes wrong:** Placing `default.yaml` in `src/config/` instead of `config/` at the project root means node-config cannot find it, and the bot fails to start with a config-not-found error.

**Why it happens:** CLAUDE.md says to use `/config` for configuration files. The confusing part: this means a `config/` directory at the project root, not inside `src/`. node-config looks for `./config/` relative to the process working directory (the project root when running `node src/index.js`).

**How to avoid:** Create `config/default.yaml` at the project root. Set `NODE_CONFIG_DIR` explicitly if needed: `process.env.NODE_CONFIG_DIR = new URL('../config', import.meta.url).pathname;` before importing node-config.

---

## Code Examples

Verified patterns from official sources and source analysis:

### irc-framework: Full Connection with LoC Auth

```javascript
// Source: https://github.com/kiwiirc/irc-framework/blob/master/docs/clientapi.md
import IRC from 'irc-framework';

const client = new IRC.Client();

client.connect({
  host: 'us.undernet.org',
  port: 6667,
  nick: 'aitrivia',
  username: 'aitrivia',
  gecos: 'AI Trivia Bot v1',
  auto_reconnect: true,
  auto_reconnect_max_wait: 30000,
  auto_reconnect_max_retries: 10,
  ping_interval: 30,
  ping_timeout: 120,
});

client.on('registered', () => {
  // Auth with X (Option B — post-connect)
  client.say('x@channels.undernet.org', `LOGIN ${xUser} ${xPass}`);
  client.join('#trivia');
});

client.on('message', (event) => {
  if (event.target.startsWith('#')) {
    // channel message
    console.log(`[${event.target}] <${event.nick}> ${event.message}`);
  }
});
```

### better-sqlite3: WAL + Schema + Atomic Write

```javascript
// Source: https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md
import Database from 'better-sqlite3';

const db = new Database('./data/scores.db');
db.pragma('journal_mode = WAL');
db.pragma('synchronous = NORMAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS scores (
    nick TEXT NOT NULL,
    channel TEXT NOT NULL,
    points INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (nick, channel)
  )
`);

const upsertScore = db.prepare(`
  INSERT INTO scores (nick, channel, points, updated_at) VALUES (@nick, @channel, @pts, @ts)
  ON CONFLICT(nick, channel) DO UPDATE SET points = points + @pts, updated_at = @ts
`);

const addScore = db.transaction((nick, channel, pts) => {
  upsertScore.run({ nick, channel, pts, ts: Date.now() });
});
```

### Owner Auth Check

```javascript
// No external library needed for IRC glob matching
function globToRegex(pattern) {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  return new RegExp(`^${escaped}$`, 'i');
}

function isOwner(event, ownerList) {
  const ident = event.ident ?? event.user ?? '*';
  const fullMask = `${event.nick}!${ident}@${event.hostname}`;
  return ownerList.some(o =>
    o.nick.toLowerCase() === event.nick.toLowerCase() &&
    globToRegex(o.hostmask).test(fullMask)
  );
}

// Usage in command handler:
client.on('message', (event) => {
  if (!event.message.startsWith('!')) return;
  if (!isOwner(event, config.get('owners'))) return; // silent drop
  // route command...
});
```

### node-config YAML + dotenv Pattern

```javascript
// src/index.js
import 'dotenv/config';   // Must be first — loads .env into process.env
import config from 'config';

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) throw new Error('ANTHROPIC_API_KEY is required in .env');

const ircConfig = {
  host: config.get('irc.host'),
  port: config.get('irc.port'),
  nick: config.get('irc.nick'),
  channels: config.get('irc.channels'),
};
```

---

## State of the Art

| Old Approach | Current Approach | When Changed | Impact |
|--------------|------------------|--------------|--------|
| `node-irc` / `irc` npm package | `irc-framework` (kiwiirc) | 2020+ (node-irc abandoned ~2016) | Actively maintained, IRCv3, bot-native API |
| SQLite via `sqlite3` (async/callback) | `better-sqlite3` (synchronous) | 2018+ | Eliminates async complexity in event handlers |
| Jest for Node.js testing | Vitest | 2023-2024 community shift | Native ESM, no transform config, instant startup |
| Undernet SASL auth (not applicable) | X bot LoC via PASS or post-connect LOGIN | Undernet always | Undernet ircu2 never supported SASL |
| JSON file for bot persistence | SQLite via better-sqlite3 | Ongoing | Crash-safe, transactional, no custom atomic-write logic |

**Deprecated/outdated:**
- `node-irc` / `irc` npm: Last meaningful commit 2016, 78+ open issues, do not use
- `node:sqlite` (Node 22 built-in): Still experimental, API unstable — do not use for production
- better-sqlite3 < 12.8.0: Bundles SQLite with unfixed WAL bug (pre-3.51.3) — do not use

---

## Open Questions

1. **irc-framework `event.ident` field name**
   - What we know: The full hostmask requires ident (the `user` in `nick!user@host`). `event.hostname` is documented. `event.ident` or `event.user` may be the field for the ident portion.
   - What's unclear: The exact property name on the `message` event object — not listed in docs.
   - Recommendation: Add a debug logging step in the first implementation task. Print `JSON.stringify(event)` on first real IRC connection to confirm field names before writing `isOwner()`.

2. **Undernet X auth: PASS field format precision**
   - What we know: The format is `+x! username password` or variants. Source: Undernet docs show `/server host port +x! user pass`.
   - What's unclear: Whether irc-framework's `password` option maps to a raw `PASS` command or applies any transformation. The `PASS` command in IRC RFC is sent before NICK/USER — verify order is correct.
   - Recommendation: Test Option B (post-connect LOGIN) first in development (simpler, same end result). Switch to Option A for production only after verifying the format works on the target server.

3. **`config/` directory path with ESM modules**
   - What we know: node-config looks for `./config/` relative to `process.cwd()`. When running `node src/index.js` from the project root, `process.cwd()` is the project root — correct.
   - What's unclear: If running the bot from a non-root directory (e.g., `node /absolute/path/src/index.js`), node-config may not find the config directory.
   - Recommendation: Set `NODE_CONFIG_DIR` explicitly in `src/config/loader.js` using `import.meta.url` to construct an absolute path to `config/`.

---

## Environment Availability

| Dependency | Required By | Available | Version | Fallback |
|------------|------------|-----------|---------|----------|
| Node.js 22 LTS | Runtime | Yes | 22.20.0 | — |
| npm | Package install | Yes | 10.9.3 | — |
| git | Version control | Yes | 2.51.0 | — |
| irc-framework | IRC client | Not yet installed | — | None — install required |
| better-sqlite3 | Persistence | Not yet installed | — | None — install required |
| node-config | Config loading | Not yet installed | — | None — install required |
| dotenv | Secret loading | Not yet installed | — | None — install required |
| vitest | Testing | Not yet installed | — | None — install required |
| Undernet IRC server | Integration test | External service | — | Use local ircd for unit tests |

**Missing dependencies with no fallback:**
- All npm packages are uninstalled — `npm install` is the first Wave 0 task.

**Missing dependencies with fallback:**
- Undernet IRC server (external) — unit tests mock the IRC client; integration tests can use a local ircd (e.g., `inspircd`) if needed, but are not required for Phase 1 success criteria.

**Project state:** Greenfield — no `package.json`, no `src/`, no `config/` directory exists yet. Phase 1 starts from an empty repository.

---

## Sources

### Primary (HIGH confidence)

- [irc-framework GitHub — docs/clientapi.md](https://github.com/kiwiirc/irc-framework/blob/master/docs/clientapi.md) — Constructor options, connection methods, events, say() method
- [irc-framework GitHub — src/transports/net.js](https://github.com/kiwiirc/irc-framework/blob/master/src/transports/net.js) — Confirmed: NO built-in flood protection in transport layer (writeLine sends immediately)
- [irc-framework GitHub — src/connection.js](https://github.com/kiwiirc/irc-framework/blob/master/src/connection.js) — Confirmed: NO message queue in connection class
- [better-sqlite3 GitHub — docs/api.md](https://github.com/WiseLibs/better-sqlite3/blob/master/docs/api.md) — Database constructor, pragma(), transaction(), prepared statements
- [better-sqlite3 GitHub — Releases](https://github.com/WiseLibs/better-sqlite3/releases) — v12.8.0 bundles SQLite 3.51.3 (WAL fix); v12.7.1 bundles 3.51.2 (affected)
- [node-config GitHub Wiki — Configuration Files](https://github.com/node-config/node-config/wiki/Configuration-Files) — File naming, YAML support, directory structure
- [node-config GitHub Wiki — Environment Variables](https://github.com/node-config/node-config/wiki/Environment-Variables) — dotenv integration, NODE_CONFIG_DIR
- [Undernet X Commands](https://www.undernet.org/docs/x-commands-english) — LoC PASS format (`+x! user pass`), post-connect LOGIN syntax
- [npm registry — irc-framework](https://www.npmjs.com/package/irc-framework) — Version 4.14.0 confirmed current
- [npm registry — better-sqlite3](https://www.npmjs.com/package/better-sqlite3) — Version 12.8.0 confirmed current
- [EggWiki — Hostmasks](https://wiki.eggheads.org/index.php/Hostmasks) — IRC hostmask glob matching: `*` = any series, `?` = any single char

### Secondary (MEDIUM confidence)

- Prior ecosystem research (STACK.md, ARCHITECTURE.md, PITFALLS.md) — all findings cross-referenced with primary sources above

---

## Metadata

**Confidence breakdown:**

| Area | Level | Reason |
|------|-------|--------|
| Standard stack | HIGH | npm registry versions confirmed today (2026-03-28); Node 22.20.0 installed on machine |
| irc-framework API | HIGH | Read actual source code (net.js, connection.js, clientapi.md); no flood protection confirmed from code |
| LoC auth format | HIGH | Undernet official docs; two verified patterns |
| better-sqlite3 WAL | HIGH | Release notes confirm v12.8.0 = SQLite 3.51.3 (WAL fix) |
| node-config + dotenv | HIGH | Official wiki docs |
| Hostmask matching | HIGH | Standard IRC behavior (30 years stable); glob syntax from EggWiki |
| Send queue design | HIGH | Token-bucket vs fixed-drain tradeoff is well-understood; IRC use case is fixed-rate |
| event.ident field name | MEDIUM | Not explicitly documented; needs runtime verification |

**Research date:** 2026-03-28
**Valid until:** 2026-06-28 (90 days — irc-framework and better-sqlite3 are stable; dotenv/node-config are very stable)
