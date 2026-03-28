# aitrivia

AI-powered IRC trivia bot. Generates questions on any topic using Anthropic Claude or Groq, runs multi-round games in IRC channels, and tracks all-time scores in a local SQLite database.

## Features

- Questions generated live by AI (Claude or Groq) — any topic, difficulty, language
- Question cache in SQLite — reuses previously generated questions to save API calls
- Per-channel game state — run simultaneous games in multiple channels
- All per-channel settings persist across restarts (topic, difficulty, language, permissions)
- Question bank builds up to a configurable cap (default 10,000) — no AI needed once full
- LRU rotation ensures different questions each round
- Streak bonuses — consecutive correct answers earn +1 (×3) or +2 (×5) bonus points
- Hint system — optional per-game; auto-hint at 50 % of timeout; answering after hint = 0 pts
- Team mode — split players into named teams; winning team announced at end
- Topic voting — 30-second poll before the game starts
- Personal stats — `!mystats` shows rank, all-time points, correct answers, favourite topic
- `!help [command]` — detailed per-command help, always delivered via PM
- Fuzzy answer matching — accepts minor typos (Levenshtein distance ≤ 1)
- Rate-limited send queue — flood-safe on Undernet ircu
- Hot-reload — edit source files without restarting the bot
- Owner authentication via nick + hostmask

---

## Requirements

- Node.js 18+
- An IRC server account (tested on Undernet)
- An AI API key: [Groq](https://console.groq.com) (free tier available) or [Anthropic](https://console.anthropic.com)

---

## Setup

### 1. Clone and install

```bash
git clone https://github.com/csbogdan/aitrivia.git
cd aitrivia
npm install
```

### 2. Configure

```bash
cp config/default.yaml.example config/default.yaml
```

Edit `config/default.yaml`:

- Set `irc.host`, `irc.nick`, and `bot.default_channels`
- Add yourself to `bot.owners` with your nick and hostmask
- Set `ai.provider` to `groq` or `anthropic`
- Optionally change `game` defaults

### 3. Set your API key

Create a `.env` file in the project root:

```bash
# For Groq
GROQ_API_KEY=your_key_here

# For Anthropic
ANTHROPIC_API_KEY=your_key_here

# Undernet X bot login (optional)
# IRC_LOC_PASSWORD=your_x_password
```

### 4. Run

```bash
# Production
npm start

# Development (auto-restarts on file changes)
npm run dev
```

---

## Configuration reference

| Key | Default | Description |
|-----|---------|-------------|
| `irc.host` | `irc.undernet.org` | IRC server hostname |
| `irc.port` | `6667` | IRC server port |
| `irc.nick` | `aitriviabot` | Bot's nick |
| `bot.command_prefix` | `!` | Command prefix character |
| `bot.default_channels` | `["#rrrrtrivia"]` | Channels to join on connect |
| `bot.owners` | — | List of `{nick, hostmask}` pairs |
| `game.questions_per_round` | `10` | Questions per game |
| `game.question_timeout_seconds` | `30` | Seconds before a question times out |
| `game.difficulty` | `medium` | Default difficulty: `easy`, `medium`, `hard` |
| `game.topics` | `["General Knowledge"]` | Available topics (first is default) |
| `game.language` | `English` | Language for questions and answers |
| `game.start_permission` | `owner` | Who can `!start`: `owner` or `anyone` |
| `game.question_cache_limit` | `10000` | Max questions stored in DB before AI is no longer called |
| `ai.provider` | `anthropic` | `groq` or `anthropic` |
| `ai.model` | *(provider default)* | Override model name |
| `database.path` | `./data/scores.db` | SQLite database path |

---

## Channel commands

### Everyone

| Command | Description |
|---------|-------------|
| `!start` | Start a normal game |
| `!start vote` | 30-second topic poll, then start |
| `!start hints` | Enable hints for this game |
| `!start teams <t1> <t2>` | Team game — players join with `!join <team>` |
| `!start vote hints teams red blue` | Flags are fully composable |
| `!stop` | Stop the current game |
| `!skip` | Skip the current question (owner only) |
| `!scores` | Show scores for the current game |
| `!leaderboard` / `!lb` | Show all-time leaderboard |
| `!mystats` | Your rank, all-time pts, correct answers, favourite topic |
| `!vote <topic>` | Cast a vote during a `!start vote` poll |
| `!join <team>` | Join a team during a team game |
| `!hint` | Reveal one letter of the answer (hints mode only; answering after = 0 pts) |
| `!teamscores` | Show live team scores |
| `!topics` | List available topics |
| `!settings` | Show current channel game settings |
| `!ping` | Check if bot is alive |
| `!uptime` | Show bot uptime |
| `!version` | Show bot version |
| `!about` / `!info` | Brief bot description |
| `!help` | Full command list — **always sent via PM** |
| `!help <command>` | Detailed help for a specific command — **sent via PM** |

### Owner only (in-channel)

| Command | Description |
|---------|-------------|
| `!topic <text>` | Change the topic (persisted) |
| `!difficulty <easy\|medium\|hard>` | Change difficulty (persisted) |
| `!language <lang>` | Change question language (persisted) |
| `!say <text>` | Make the bot say something in the channel |
| `!nick <newnick>` | Change the bot's nick |
| `!quit [message]` | Disconnect from IRC |

> `!topic`, `!difficulty`, and `!language` follow the same permission as `!start` — if `startperm` is `anyone`, these open up to all users too.

---

## Private message commands (owner only)

Send these directly to the bot's nick:

| Command | Description |
|---------|-------------|
| `!join <#channel>` | Join a channel |
| `!part <#channel>` | Leave a channel |
| `!say <#channel> <text>` | Make the bot say text in a channel |
| `!nick <newnick>` | Change the bot's nick |
| `!quit [message]` | Disconnect from IRC |
| `!channels` | List channels the bot is active in |
| `!status` | Uptime + per-channel game state |
| `!startperm <#channel> <owner\|anyone>` | Set who can `!start` in a channel (persisted) |
| `!stopperm <#channel> <owner\|anyone>` | Set who can `!stop` in a channel (persisted) |
| `!qlist` | List question counts grouped by topic / difficulty / language |
| `!qclear <topic> \| <difficulty> \| <language>` | Delete all questions for a specific combination |
| `!dupes` | Check how many duplicate questions are in the DB |
| `!dedup` | Remove duplicate questions from the DB |
| `!help` | List all PM commands |

---

## Playing the game

1. `!start` (or with flags) — bot fetches questions and begins the round
2. The bot asks a question: `Q1: What is the capital of France? (30s)`
3. Type your answer directly in the channel — no prefix needed
4. First correct answer wins the point; bot announces and moves on
5. After all questions, final scores (and team winner if applicable) are shown

Answers are matched case-insensitively. Minor typos (1 character off) are accepted. The AI also generates alternate spellings and abbreviations as accepted variants.

### Streak bonuses

Consecutive correct answers by the same nick earn bonus points:

| Streak | Points awarded |
|--------|---------------|
| 1–2 | +1 (normal) |
| 3–4 | +2 (+1 bonus) |
| 5+  | +3 (+2 bonus) |

Streak resets when another player answers correctly.

### Hints

Enable with `!start hints`. At 50 % of the timeout the bot automatically reveals one letter of the answer (`_ _ a _ _ _`). Type `!hint` to trigger it manually. If a hint was shown before the correct answer, the winner scores **0 points**.

### Team mode

`!start teams red blue` — players type `!join red` or `!join blue` to join. Team assignments persist between rounds. Individual scores and team totals are both tracked. `!teamscores` shows live totals mid-game.

---

## Question bank

Questions are generated by AI and stored permanently in SQLite. The bank grows over time until it reaches the configured cap (`game.question_cache_limit`, default 10,000).

- **Below the cap** — each `!start` checks whether the DB has enough questions for the current topic/difficulty/language. Any shortfall is generated by AI and stored.
- **At the cap** — the bot runs entirely from the DB with no AI calls.
- **Rotation** — questions are served least-recently-used first, so each round gets a fresh set before cycling back.
- **Startup dedup** — on every launch duplicate questions are automatically removed and a unique index is enforced to prevent future duplication.
- **Manual dedup** — use `!dupes` to check and `!dedup` to clean up from a DM to the bot.

The bank is keyed per topic/difficulty/language, so switching settings grows separate pools.

---

## Hostmask authentication

Owners are identified by both nick and hostmask. Find your hostmask by typing `/whois YourNick` on the IRC server. Wildcards are supported:

```yaml
owners:
  - nick: "YourNick"
    hostmask: "*.yourisp.net"    # match any host at yourisp.net
  - nick: "YourNick"
    hostmask: "yourhost.isp.net" # exact match
```

---

## License

ISC
