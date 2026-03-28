# aitrivia

AI-powered IRC trivia bot. Generates questions on any topic using Anthropic Claude or Groq, runs multi-round games in IRC channels, and tracks all-time scores in a local SQLite database.

## Features

- Questions generated live by AI (Claude or Groq) — any topic, difficulty, language
- Question cache in SQLite — reuses previously generated questions to save API calls
- Per-channel game state — run simultaneous games in multiple channels
- All per-channel settings persist across restarts (topic, difficulty, language, permissions)
- Question bank builds up to a configurable cap (default 10,000) — no AI needed once full
- LRU rotation ensures different questions each round
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
| `!start` | Start a trivia game (requires permission) |
| `!scores` | Show scores for the current game |
| `!leaderboard` / `!lb` | Show all-time leaderboard |
| `!topics` | List available topics |
| `!settings` | Show current game settings |
| `!ping` | Ping the bot |
| `!uptime` | Show bot uptime |
| `!version` | Show bot version |
| `!about` / `!info` | Short description and command list |
| `!help` | Full command list |

### Owner only (in-channel)

| Command | Description |
|---------|-------------|
| `!stop` | Stop the current game |
| `!skip` | Skip the current question |
| `!topic <text>` | Change the topic (persisted) |
| `!difficulty <easy\|medium\|hard>` | Change difficulty (persisted) |
| `!language <lang>` | Change question language (persisted) |
| `!say <text>` | Make the bot say something |
| `!nick <newnick>` | Change the bot's nick |
| `!quit [message]` | Disconnect from IRC |

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
| `!dupes` | Check how many duplicate questions are in the DB |
| `!dedup` | Remove duplicate questions from the DB |
| `!help` | List all PM commands |

---

## Playing the game

1. `!start` — bot fetches questions and begins the round
2. The bot asks a question with a countdown: `Q1: What is the capital of France? (30s)`
3. Type your answer directly in the channel (no prefix needed)
4. First correct answer wins the point; bot announces and moves to the next question
5. After all questions, final scores are shown

Answers are matched case-insensitively. Minor typos (1 character off) are accepted. Each question also has alternate accepted spellings defined by the AI.

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
