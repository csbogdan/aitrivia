import Anthropic from '@anthropic-ai/sdk';
import Groq from 'groq-sdk';
import { getState, getAllChannels } from './state.js';
import { addPoints, getLeaderboard, saveChannelSetting, recordAnswer, getNickStats,
         fetchQuestions, storeQuestions, countQuestions, countAllQuestions,
         countQuestionDuplicates, pruneQuestionDuplicates, listQuestionCounts, clearQuestions } from './db.js';
import { say } from './sendQueue.js';
import { cfg } from './cfg.js';

const BOT_START = Date.now();

const DEFAULTS = {
  anthropic: 'claude-haiku-4-5-20251001',
  groq:      'llama-3.3-70b-versatile',
};

function aiProvider() { return (cfg().ai?.provider || 'anthropic').toLowerCase(); }
function aiModel()    { const p = aiProvider(); return cfg().ai?.model || DEFAULTS[p] || DEFAULTS.anthropic; }

// Normalized completion — re-reads provider/model from config on every call
async function complete(prompt, maxTokens) {
  const provider = aiProvider();
  const model    = aiModel();
  console.log(`[ai] provider=${provider} model=${model}`);
  if (provider === 'groq') {
    const res = await new Groq().chat.completions.create({
      model, max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }],
    });
    return res.choices[0].message.content;
  } else {
    const res = await new Anthropic().messages.create({
      model, max_tokens: maxTokens,
      messages: [{ role: 'user', content: prompt }],
    });
    return res.content[0].text;
  }
}

// ─── Auth ─────────────────────────────────────────────────────────────────────

function owners()    { return cfg().bot?.owners || []; }
function PREFIX()    { return cfg().bot?.command_prefix || '!'; }
function getStartPerm(channel){ return getState(channel).startPerm ?? cfg().game?.start_permission ?? 'owner'; }
function getStopPerm(channel) { return getState(channel).stopPerm  ?? 'owner'; }
function TIMEOUT_MS(){ return (cfg().game?.question_timeout_seconds || 30) * 1000; }
function QPR()       { return cfg().game?.questions_per_round || 10; }

function uptimeStr() {
  let s = Math.floor((Date.now() - BOT_START) / 1000);
  const h = Math.floor(s / 3600); s -= h * 3600;
  const m = Math.floor(s / 60);   s -= m * 60;
  return `${h}h ${m}m ${s}s`;
}

function matchMask(pattern, value) {
  const re = new RegExp(
    '^' + pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.') + '$',
    'i'
  );
  return re.test(value);
}

function isOwner(nick, host) {
  return owners().some(o =>
    o.nick.toLowerCase() === nick.toLowerCase() && matchMask(o.hostmask, host)
  );
}

// ─── AI ───────────────────────────────────────────────────────────────────────

async function generateBatch(topic, difficulty, language, count, asked = []) {
  const guide = {
    easy:   'suitable for general audiences, well-known facts',
    medium: 'moderately challenging, requires some knowledge',
    hard:   'challenging, requires specific knowledge',
  };

  const avoidBlock = asked.length
    ? `\nDo NOT use any of these questions:\n${asked.map(q => `- ${q}`).join('\n')}\n`
    : '';

  const prompt =
    `Generate ${count} DIFFERENT trivia questions.\n` +
    `Topic: ${topic}\n` +
    `Difficulty: ${difficulty} (${guide[difficulty] || guide.medium})\n` +
    `Language: ${language}\n` +
    avoidBlock +
    `\nReply with ONLY a raw JSON array, no markdown, no extra text:\n` +
    `[{"question":"...","answer":"...","variants":["...","..."]}, ...]\n\n` +
    `Rules:\n` +
    `- All ${count} questions must be about different subtopics\n` +
    `- "answer" is the correct answer (1-5 words)\n` +
    `- "variants" are ALTERNATE WAYS TO TYPE THE SAME CORRECT ANSWER — different spellings, abbreviations, or short forms. They are NOT wrong answers. Example: answer "Vincent van Gogh", variants ["vincent van gogh", "van gogh", "gogh"]\n` +
    `- Include 2-4 variants per question\n` +
    `- each question has exactly one correct answer`;

  const raw = await complete(prompt, 1500);
  console.log(`[ai] batch raw: ${raw.slice(0, 400)}`);

  const match = raw.match(/\[[\s\S]*\]/);
  if (!match) throw new Error(`No JSON array in response: ${raw.slice(0, 100)}`);

  const parsed = JSON.parse(match[0]);
  return parsed.map(q => ({
    question: String(q.question),
    answer:   String(q.answer),
    variants: q.variants.map(v => String(v).toLowerCase().trim()),
  }));
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

// ─── Game ─────────────────────────────────────────────────────────────────────

export function resetState(channel) {
  const s = getState(channel);
  if (s.timer)      clearTimeout(s.timer);
  if (s.hintTimer)  clearTimeout(s.hintTimer);
  if (s.voteTimer)  clearTimeout(s.voteTimer);
  Object.assign(s, {
    status: 'idle', question: null, variants: [], answer: null,
    questionNum: 0, timer: null, scores: {}, asked: [], queue: [],
    streaks: {}, hintsEnabled: false, hintUsed: false, hintTimer: null, hintRevealed: [],
    voteTimer: null, votes: {},
    teamsEnabled: false, teamNames: [], teams: {}, teamScores: {},
  });
}

export function resetAll() {
  for (const ch of getAllChannels()) resetState(ch);
}

export async function startGame(channel, opts = {}) {
  const s = getState(channel);
  if (s.status !== 'idle') { say(channel, 'A game is already running. Use !stop to end it.'); return; }

  // Apply per-game options
  s.scores = {}; s.questionNum = 0; s.queue = []; s.asked = []; s.streaks = {};
  s.hintsEnabled = opts.hints || false;
  s.hintUsed = false; s.hintTimer = null; s.hintRevealed = [];
  if (opts.teams) {
    s.teamsEnabled = true;
    s.teamNames = opts.teamNames;
    s.teamScores = Object.fromEntries(opts.teamNames.map(t => [t, 0]));
    // preserve s.teams (player assignments from prior round)
  } else {
    s.teamsEnabled = false; s.teamNames = []; s.teams = {}; s.teamScores = {};
  }

  const modeFlags = [
    s.hintsEnabled ? 'hints on' : null,
    s.teamsEnabled ? `teams: ${s.teamNames.join(' vs ')}` : null,
  ].filter(Boolean).join(', ');

  say(channel, `Starting trivia! Topic: ${s.topic} | Difficulty: ${s.difficulty} | Language: ${s.language} | ${QPR()} questions${modeFlags ? ` | ${modeFlags}` : ''} — fetching...`);
  if (s.teamsEnabled) say(channel, `Join a team: ${s.teamNames.map(t => `${PREFIX()}join ${t}`).join('  or  ')}`);

  try {
    const cap = cfg().game?.question_cache_limit || 10000;
    const stored = countQuestions(s.topic, s.difficulty, s.language);
    const needed = QPR() - Math.min(stored, QPR());
    if (needed > 0 && countAllQuestions() < cap) {
      const existing = fetchQuestions(s.topic, s.difficulty, s.language, stored).map(q => q.question);
      const fresh = await generateBatch(s.topic, s.difficulty, s.language, needed, existing);
      storeQuestions(s.topic, s.difficulty, s.language, fresh, cap);
    }
    s.queue = shuffle(fetchQuestions(s.topic, s.difficulty, s.language, QPR()));
    if (!s.queue.length) throw new Error('No questions available — try a different topic or wait for the cache to build.');
  } catch (err) {
    say(channel, `Failed to load questions: ${err.message}`);
    return;
  }
  await nextQuestion(channel);
}

async function startVoting(channel, opts) {
  const s = getState(channel);
  if (s.status !== 'idle') { say(channel, 'A game is already running.'); return; }
  const topics = cfg().game?.topics || [];
  if (topics.length < 2) { await startGame(channel, opts); return; }
  s.status = 'voting';
  s.votes = {};
  s.voteTimer = setTimeout(() => tallyVotes(channel, opts), 30000);
  say(channel, `Vote for a topic! Type ${PREFIX()}vote <topic>  |  Options: ${topics.join('  |  ')}  (30s)`);
}

async function tallyVotes(channel, opts) {
  const s = getState(channel);
  if (s.status !== 'voting') return;
  s.voteTimer = null;
  const topics = cfg().game?.topics || [];
  let winner;
  if (!Object.keys(s.votes).length) {
    winner = topics[Math.floor(Math.random() * topics.length)];
    say(channel, `No votes — randomly picked: ${winner}`);
  } else {
    const counts = {};
    for (const t of Object.values(s.votes)) counts[t] = (counts[t] || 0) + 1;
    const max = Math.max(...Object.values(counts));
    const tied = Object.keys(counts).filter(t => counts[t] === max);
    winner = tied[Math.floor(Math.random() * tied.length)];
    say(channel, `Voting done! Winner: ${winner} (${counts[winner]} vote(s))`);
  }
  s.status = 'idle';
  s.topic = winner;
  await startGame(channel, opts);
}

export function stopGame(channel) {
  const s = getState(channel);
  if (s.status === 'idle') { say(channel, 'No game is running.'); return; }
  if (s.timer)     clearTimeout(s.timer);
  if (s.hintTimer) clearTimeout(s.hintTimer);
  if (s.voteTimer) clearTimeout(s.voteTimer);
  s.status = 'idle';
  say(channel, `Game stopped. ${formatScores(s.scores)}`);
}

export async function skipQuestion(channel) {
  const s = getState(channel);
  if (s.status === 'idle') return;
  if (s.timer)     clearTimeout(s.timer);
  if (s.hintTimer) { clearTimeout(s.hintTimer); s.hintTimer = null; }
  say(channel, `Skipping! The answer was: ${s.answer}`);
  s.questionNum++;
  s.questionNum >= QPR() ? await endGame(channel) : await nextQuestion(channel);
}

export async function handleAnswer(channel, nick, text) {
  const s = getState(channel);
  if (s.status !== 'asking') return;
  const guess = text.toLowerCase().trim();
  const canonical = s.answer.toLowerCase().trim();
  const accepted = [canonical, ...s.variants];
  if (!accepted.includes(guess) && !fuzzyMatch(guess, accepted)) return;

  s.status = 'judging';
  if (s.timer)     clearTimeout(s.timer);
  if (s.hintTimer) { clearTimeout(s.hintTimer); s.hintTimer = null; }

  // Streaks — reset all others, increment winner
  for (const n of Object.keys(s.streaks)) if (n !== nick) s.streaks[n] = 0;
  s.streaks[nick] = (s.streaks[nick] || 0) + 1;
  const streak = s.streaks[nick];
  const streakBonus = streak >= 5 ? 2 : streak >= 3 ? 1 : 0;
  const pts = s.hintUsed ? 0 : 1 + streakBonus;

  s.scores[nick] = (s.scores[nick] || 0) + pts;
  if (pts > 0) addPoints(channel, nick, pts);
  recordAnswer(channel, nick, s.topic);

  if (s.teamsEnabled && s.teams[nick])
    s.teamScores[s.teams[nick]] = (s.teamScores[s.teams[nick]] || 0) + pts;

  let msg = `Correct! ${nick} got it! The answer was: ${s.answer}`;
  if (s.hintUsed)        msg += ' (no point — hint was used)';
  else if (streakBonus)  msg += ` (+${pts} pts — ${streak}x streak!)`;
  else                   msg += ' (+1 point)';
  if (s.teamsEnabled && s.teams[nick]) msg += `  [Team ${s.teams[nick]}: ${s.teamScores[s.teams[nick]]}]`;
  console.log(`[game] ${channel} correct: ${nick} streak=${streak} pts=${pts} answer="${s.answer}"`);
  say(channel, msg);

  s.questionNum++;
  s.questionNum >= QPR() ? await endGame(channel) : await nextQuestion(channel);
}

export function showScores(channel) {
  const s = getState(channel);
  if (!Object.keys(s.scores).length) { say(channel, 'No scores yet this session.'); return; }
  say(channel, `Scores: ${formatScores(s.scores)}`);
}

export function showLeaderboard(channel) {
  const rows = getLeaderboard(channel);
  if (!rows.length) { say(channel, 'No scores recorded yet.'); return; }
  say(channel, `All-time: ${rows.map((r, i) => `${i + 1}. ${r.nick} (${r.score})`).join('  ')}`);
}

export function setTopic(channel, topic) {
  getState(channel).topic = topic;
  saveChannelSetting(channel, 'topic', topic);
  say(channel, `Topic set to: ${topic}`);
}
export function setLanguage(channel, language) {
  getState(channel).language = language;
  saveChannelSetting(channel, 'language', language);
  say(channel, `Language set to: ${language}`);
}
export function setDifficulty(channel, diff) {
  if (!['easy','medium','hard'].includes(diff)) { say(channel, 'Choose: easy, medium, hard'); return; }
  getState(channel).difficulty = diff;
  saveChannelSetting(channel, 'difficulty', diff);
  say(channel, `Difficulty set to: ${diff}`);
}

// ─── Commands ─────────────────────────────────────────────────────────────────

export async function handleMessage(client, channel, nick, host, text) {
  const owner = isOwner(nick, host);
  if (!text.startsWith(PREFIX())) { await handleAnswer(channel, nick, text); return; }
  const [cmd, ...args] = text.slice(PREFIX().length).trim().split(/\s+/);

  switch (cmd.toLowerCase()) {
    // ── Game ──────────────────────────────────────────────────────────────────
    case 'start': {
      if (getStartPerm(channel) === 'owner' && !owner) return;
      const flags = args.map(a => a.toLowerCase());
      const teamsIdx = flags.indexOf('teams');
      const teamNames = teamsIdx >= 0 ? args.slice(teamsIdx + 1, teamsIdx + 3) : [];
      const opts = { hints: flags.includes('hints'), teams: teamNames.length === 2, teamNames };
      flags.includes('vote') ? await startVoting(channel, opts) : await startGame(channel, opts);
      break;
    }
    case 'stop':
      if (getStopPerm(channel) === 'owner' && !owner) return;
      stopGame(channel);
      break;
    case 'skip':       if (!owner) return; await skipQuestion(channel); break;
    case 'scores':     showScores(channel); break;
    case 'leaderboard':
    case 'lb':         showLeaderboard(channel); break;
    case 'topic':
      if (getStartPerm(channel) === 'owner' && !owner) return;
      if (!args.length) { say(channel, `Usage: ${PREFIX()}topic <topic>`); return; }
      setTopic(channel, args.join(' '));
      break;
    case 'difficulty':
    case 'diff':
      if (getStartPerm(channel) === 'owner' && !owner) return;
      if (!args.length) { say(channel, `Usage: ${PREFIX()}difficulty <easy|medium|hard>`); return; }
      setDifficulty(channel, args[0].toLowerCase());
      break;
    case 'language':
    case 'lang':
      if (getStartPerm(channel) === 'owner' && !owner) return;
      if (!args.length) { say(channel, `Usage: ${PREFIX()}language <English|French|...>`); return; }
      setLanguage(channel, args.join(' '));
      break;
    case 'hint': {
      const s = getState(channel);
      if (s.status !== 'asking' || !s.hintsEnabled) return;
      if (s.hintTimer) { clearTimeout(s.hintTimer); s.hintTimer = null; }
      showHint(channel);
      break;
    }
    case 'vote': {
      const s = getState(channel);
      if (s.status !== 'voting') return;
      if (!args.length) return;
      const choice = args.join(' ');
      const match = (cfg().game?.topics || []).find(t => t.toLowerCase() === choice.toLowerCase());
      if (!match) { say(channel, `Options: ${(cfg().game?.topics || []).join('  |  ')}`); return; }
      s.votes[nick] = match;
      break;
    }
    case 'join': {
      const s = getState(channel);
      if (!s.teamsEnabled) return;
      const match = s.teamNames.find(t => t.toLowerCase() === (args[0] || '').toLowerCase());
      if (!match) { say(channel, `Teams: ${s.teamNames.join(', ')}`); return; }
      s.teams[nick] = match;
      say(channel, `${nick} joined team ${match}!`);
      break;
    }
    case 'mystats': {
      const stats = getNickStats(channel, nick);
      if (!stats) { say(channel, `${nick}: no stats yet.`); return; }
      say(channel, `${nick} — rank: #${stats.rank}  all-time: ${stats.points} pts  correct answers: ${stats.totalCorrect}  fav topic: ${stats.favTopic || 'N/A'}`);
      break;
    }
    case 'teamscores': {
      const s = getState(channel);
      if (!s.teamsEnabled) { say(channel, 'No team game running.'); return; }
      say(channel, `Teams: ${s.teamNames.map(t => `${t}: ${s.teamScores[t] || 0}`).join('  |  ')}`);
      break;
    }
    case 'topics': {
      const list = (cfg().game?.topics || []).join('  |  ');
      say(channel, `Available topics: ${list || '(none configured)'}`);
      break;
    }
    case 'settings': {
      const s = getState(channel);
      say(channel, `Settings — topic: ${s.topic}  difficulty: ${s.difficulty}  language: ${s.language}  questions: ${QPR()}  timeout: ${TIMEOUT_MS() / 1000}s`);
      break;
    }

    // ── Bot info ──────────────────────────────────────────────────────────────
    case 'ping':
      say(channel, `Pong! ${nick}`);
      break;
    case 'uptime':
      say(channel, `Uptime: ${uptimeStr()}`);
      break;
    case 'version':
      say(channel, `aitrivia v1.0.0 — AI-powered trivia bot`);
      break;
    case 'info':
    case 'about':
      say(channel, `aitrivia v1.0.0 — AI-powered trivia. Commands: ${PREFIX()}help  |  ${PREFIX()}start  ${PREFIX()}stop  ${PREFIX()}skip  ${PREFIX()}scores  ${PREFIX()}lb  ${PREFIX()}topics  ${PREFIX()}settings`);
      break;

    // ── Owner bot control (in-channel) ────────────────────────────────────────
    case 'say':
      if (!owner) return;
      if (!args.length) { say(channel, `Usage: ${PREFIX()}say <text>`); return; }
      say(channel, args.join(' '));
      break;
    case 'nick':
      if (!owner) return;
      if (!args[0]) { say(channel, `Usage: ${PREFIX()}nick <newnick>`); return; }
      client.changeNick(args[0]);
      break;
    case 'quit':
      if (!owner) return;
      client.quit(args.join(' ') || 'Bye!');
      break;

    // ── Help ──────────────────────────────────────────────────────────────────
    case 'help':
      say(channel, `${PREFIX()}start [vote] [hints] [teams t1 t2]  ${PREFIX()}stop  ${PREFIX()}skip  ${PREFIX()}scores  ${PREFIX()}lb  ${PREFIX()}mystats  ${PREFIX()}vote <topic>  ${PREFIX()}join <team>  ${PREFIX()}hint  ${PREFIX()}teamscores  ${PREFIX()}topics  ${PREFIX()}settings  ${PREFIX()}ping  ${PREFIX()}uptime  ${PREFIX()}about` +
        (owner ? `  [owner: ${PREFIX()}topic  ${PREFIX()}diff  ${PREFIX()}lang  ${PREFIX()}say  ${PREFIX()}nick  ${PREFIX()}quit]` : ''));
      break;
  }
}

export function handleOwnerPrivmsg(client, nick, host, text) {
  if (!isOwner(nick, host) || !text.startsWith(PREFIX())) return;
  const [cmd, ...args] = text.slice(PREFIX().length).trim().split(/\s+/);

  switch (cmd.toLowerCase()) {
    case 'join':
      if (!args[0]) { client.say(nick, `Usage: ${PREFIX()}join <#channel>`); return; }
      client.join(args[0]);
      client.say(nick, `Joined ${args[0]}`);
      break;
    case 'part':
      if (!args[0]) { client.say(nick, `Usage: ${PREFIX()}part <#channel>`); return; }
      client.part(args[0]);
      client.say(nick, `Left ${args[0]}`);
      break;
    case 'quit':
      client.quit(args.join(' ') || 'Bye!');
      break;
    case 'nick':
      if (!args[0]) { client.say(nick, `Usage: ${PREFIX()}nick <newnick>`); return; }
      client.changeNick(args[0]);
      client.say(nick, `Nick changed to ${args[0]}`);
      break;
    case 'say':
      // !say #channel text...
      if (!args[0] || !args[1]) { client.say(nick, `Usage: ${PREFIX()}say <#channel> <text>`); return; }
      say(args[0], args.slice(1).join(' '));
      break;
    case 'channels': {
      const chs = [...getAllChannels()].join('  ');
      client.say(nick, `Active channels: ${chs || '(none)'}`);
      break;
    }
    case 'startperm': {
      // !startperm <#channel> <owner|anyone>
      const [ch, perm] = args;
      if (!ch || !perm) { client.say(nick, `Usage: ${PREFIX()}startperm <#channel> <owner|anyone>`); return; }
      if (!['owner', 'anyone'].includes(perm)) { client.say(nick, 'Permission must be "owner" or "anyone"'); return; }
      getState(ch).startPerm = perm;
      saveChannelSetting(ch, 'startPerm', perm);
      client.say(nick, `${ch}: start permission set to "${perm}"`);
      break;
    }
    case 'stopperm': {
      // !stopperm <#channel> <owner|anyone>
      const [ch, perm] = args;
      if (!ch || !perm) { client.say(nick, `Usage: ${PREFIX()}stopperm <#channel> <owner|anyone>`); return; }
      if (!['owner', 'anyone'].includes(perm)) { client.say(nick, 'Permission must be "owner" or "anyone"'); return; }
      getState(ch).stopPerm = perm;
      saveChannelSetting(ch, 'stopPerm', perm);
      client.say(nick, `${ch}: stop permission set to "${perm}"`);
      break;
    }
    case 'status': {
      const chs = [...getAllChannels()];
      const games = chs.map(ch => {
        const s = getState(ch);
        return `${ch}: ${s.status}${s.status !== 'idle' ? ` Q${s.questionNum + 1}/${QPR()}` : ''}`;
      });
      client.say(nick, `Uptime: ${uptimeStr()}  |  ${games.join('  |  ') || 'No channels'}`);
      break;
    }
    case 'qlist': {
      const rows = listQuestionCounts();
      if (!rows.length) { client.say(nick, 'Question bank is empty.'); return; }
      const total = countAllQuestions();
      const cap   = cfg().game?.question_cache_limit || 10000;
      // Send one line per row; IRC-safe since each is short
      for (const r of rows) {
        client.say(nick, `  ${r.topic} | ${r.difficulty} | ${r.language} — ${r.count} questions`);
      }
      client.say(nick, `Total: ${total}/${cap}`);
      break;
    }
    case 'qclear': {
      // !qclear <topic> | <difficulty> | <language>   (pipe-separated to allow spaces in topic)
      const raw = args.join(' ');
      const parts = raw.split('|').map(s => s.trim());
      if (parts.length !== 3 || parts.some(p => !p)) {
        client.say(nick, `Usage: ${PREFIX()}qclear <topic> | <difficulty> | <language>`);
        return;
      }
      const [topic, difficulty, language] = parts;
      const removed = clearQuestions(topic, difficulty, language);
      client.say(nick, removed
        ? `Removed ${removed} question(s) for "${topic} | ${difficulty} | ${language}".`
        : `No questions found for "${topic} | ${difficulty} | ${language}".`);
      break;
    }
    case 'dupes': {
      const count = countQuestionDuplicates();
      const total = countAllQuestions();
      client.say(nick, count
        ? `Found ${count} duplicate question(s) out of ${total} total. Use ${PREFIX()}dedup to remove them.`
        : `No duplicates found (${total} questions total).`);
      break;
    }
    case 'dedup': {
      const removed = pruneQuestionDuplicates();
      const total = countAllQuestions();
      client.say(nick, removed
        ? `Removed ${removed} duplicate question(s). ${total} questions remaining.`
        : `No duplicates found. ${total} questions total.`);
      break;
    }
    case 'help':
      client.say(nick, `Owner DM commands: ${PREFIX()}join <#ch>  ${PREFIX()}part <#ch>  ${PREFIX()}say <#ch> <text>  ${PREFIX()}nick <newnick>  ${PREFIX()}quit [msg]  ${PREFIX()}channels  ${PREFIX()}status  ${PREFIX()}startperm <#ch> <owner|anyone>  ${PREFIX()}stopperm <#ch> <owner|anyone>  ${PREFIX()}qlist  ${PREFIX()}qclear <topic>|<diff>|<lang>  ${PREFIX()}dupes  ${PREFIX()}dedup`);
      break;
  }
}

// ─── Internals ────────────────────────────────────────────────────────────────

async function nextQuestion(channel) {
  const s = getState(channel);
  s.status = 'asking';
  s.hintUsed = false;
  s.hintRevealed = [];

  const q = s.queue.shift();
  if (!q) { await endGame(channel); return; }

  s.question = q.question;
  s.answer   = q.answer;
  s.variants = q.variants;
  s.asked.push(q.question);
  console.log(`[game] ${channel} Q${s.questionNum + 1}: "${q.question}" A: "${q.answer}"`);
  say(channel, `Q${s.questionNum + 1}: ${q.question} (${TIMEOUT_MS() / 1000}s)`);

  if (s.hintsEnabled)
    s.hintTimer = setTimeout(() => showHint(channel), TIMEOUT_MS() / 2);

  s.timer = setTimeout(async () => {
    if (s.status !== 'asking') return;
    if (s.hintTimer) { clearTimeout(s.hintTimer); s.hintTimer = null; }
    say(channel, `Time's up! The answer was: ${s.answer}`);
    s.questionNum++;
    s.questionNum >= QPR() ? await endGame(channel) : await nextQuestion(channel);
  }, TIMEOUT_MS());
}

function showHint(channel) {
  const s = getState(channel);
  if (s.status !== 'asking') return;
  s.hintUsed = true;
  // Reveal one random unrevealed non-space character
  const unrevealed = s.answer.split('').reduce((a, ch, i) => {
    if (ch !== ' ' && !s.hintRevealed.includes(i)) a.push(i);
    return a;
  }, []);
  if (unrevealed.length) s.hintRevealed.push(unrevealed[Math.floor(Math.random() * unrevealed.length)]);
  const hint = s.answer.split('').map((ch, i) => ch === ' ' ? '  ' : (s.hintRevealed.includes(i) ? ch : '_')).join(' ');
  say(channel, `Hint: ${hint}  (answering now scores 0 pts)`);
}

async function endGame(channel) {
  const s = getState(channel);
  s.status = 'idle';
  let msg = `Game over! Final scores: ${formatScores(s.scores) || 'No points scored'}`;
  if (s.teamsEnabled && s.teamNames.length) {
    const teamTally = s.teamNames.map(t => `${t}: ${s.teamScores[t] || 0}`).join('  |  ');
    const max = Math.max(...s.teamNames.map(t => s.teamScores[t] || 0));
    const winners = s.teamNames.filter(t => (s.teamScores[t] || 0) === max);
    const teamResult = winners.length === 1 ? `Winner: Team ${winners[0]}!` : `Tie: ${winners.join(' & ')}!`;
    msg += `  ||  Teams — ${teamTally}  |  ${teamResult}`;
  }
  say(channel, msg);
}

function formatScores(scores) {
  return Object.entries(scores).sort((a, b) => b[1] - a[1]).map(([n, p]) => `${n}: ${p}`).join('  |  ');
}

function fuzzyMatch(guess, variants) {
  return variants.some(v => v.length > 4 && levenshtein(guess, v) <= 1);
}

function levenshtein(a, b) {
  const m = a.length, n = b.length;
  const dp = Array.from({ length: m + 1 }, (_, i) => [i, ...Array(n).fill(0)]);
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i-1] === b[j-1] ? dp[i-1][j-1] : 1 + Math.min(dp[i-1][j], dp[i][j-1], dp[i-1][j-1]);
  return dp[m][n];
}
