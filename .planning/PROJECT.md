# aitrivia

## What This Is

An AI-powered IRC trivia bot targeting Undernet. The bot connects to IRC channels, hosts race-style trivia games where the first player to type the correct answer scores a point, and uses Claude to dynamically generate questions on configurable topics. An owner (identified by IRC nickname) controls the bot via IRC commands and a config file.

## Core Value

The bot generates fresh, engaging trivia questions on any topic via AI — no stale question banks.

## Requirements

### Validated

(None yet — ship to validate)

### Active

- [ ] Bot connects to Undernet and joins configured channels
- [ ] Owner identified by nickname can control the bot via IRC commands
- [ ] AI (Claude) generates trivia questions dynamically based on configured topics
- [ ] Race-style gameplay: first player to type the correct answer wins the point
- [ ] Game can be started and stopped via IRC commands
- [ ] Configurable topics, difficulty, and question count via config file + IRC commands
- [ ] Scores persist across sessions (survive bot restarts)
- [ ] Score/leaderboard display command available in-channel
- [ ] Bot can join and part channels via owner command

### Out of Scope

- Web UI or dashboard — IRC is the interface
- Multi-network support (v1 is Undernet only)
- Per-user authentication (owner identified by nickname only)
- Team/group scoring — individual scoring only for v1

## Context

- **IRC network**: Undernet (uses X for channel services, no NickServ by default)
- **Owner auth**: By IRC nickname — simple, standard for IRC bots on Undernet
- **Answer style**: Race-style freeform text — first correct answer wins; AI judges correctness
- **Language**: Node.js
- **AI**: Claude API for question generation and answer evaluation
- **Persistence**: File-based or lightweight DB for scores across sessions

## Constraints

- **Tech Stack**: Node.js — chosen for IRC library ecosystem and Claude API integration
- **IRC**: Undernet-compatible — must handle Undernet's specific quirks (X bot, no SASL by default)
- **Owner auth**: Nickname-based only — no password system for v1
- **Cost**: Claude API calls per question — keep context lean, don't over-prompt

## Key Decisions

| Decision | Rationale | Outcome |
|----------|-----------|---------|
| AI generates questions | Infinite variety vs static bank; core differentiator | — Pending |
| Race-style answers | Simpler scoring, higher engagement tension | — Pending |
| Node.js | Best IRC + Claude API ecosystem fit | — Pending |
| Undernet target | User's specified network | — Pending |
| Nickname-based owner auth | Standard Undernet bot pattern, simple to implement | — Pending |

## Evolution

This document evolves at phase transitions and milestone boundaries.

**After each phase transition** (via `/gsd:transition`):
1. Requirements invalidated? → Move to Out of Scope with reason
2. Requirements validated? → Move to Validated with phase reference
3. New requirements emerged? → Add to Active
4. Decisions to log? → Add to Key Decisions
5. "What This Is" still accurate? → Update if drifted

**After each milestone** (via `/gsd:complete-milestone`):
1. Full review of all sections
2. Core Value check — still the right priority?
3. Audit Out of Scope — reasons still valid?
4. Update Context with current state

---
*Last updated: 2026-03-28 after initialization*
