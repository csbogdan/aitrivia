import Anthropic from '@anthropic-ai/sdk';
import Groq from 'groq-sdk';
import { getState, getAllChannels } from './state.js';
import { addPoint, getLeaderboard, saveChannelSetting } from './db.js';
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

import { getRecentQuestions, storeQuestions } from './db.js';

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
  if (s.timer) clearTimeout(s.timer);
  Object.assign(s, { status: 'idle', question: null, variants: [], answer: null, questionNum: 0, timer: null, scores: {}, asked: [], queue: [] });
}

export function resetAll() {
  for (const ch of getAllChannels()) resetState(ch);
}

export async function startGame(channel) {
  const s = getState(channel);
  if (s.status !== 'idle') { say(channel, 'A game is already running. Use !stop to end it.'); return; }
  s.scores = {};
  s.questionNum = 0;
  s.queue = [];
  s.asked = [];
  say(channel, `Starting trivia! Topic: ${s.topic} | Difficulty: ${s.difficulty} | Language: ${s.language} | ${QPR()} questions — fetching questions...`);
  try {
    // Always generate fresh questions; pass recent DB entries so AI avoids repeats
    const recent = getRecentQuestions(s.topic, s.difficulty, s.language, 60);
    const fresh = await generateBatch(s.topic, s.difficulty, s.language, QPR(), recent);
    storeQuestions(s.topic, s.difficulty, s.language, fresh);
    s.queue = shuffle(fresh);
  } catch (err) {
    say(channel, `Failed to load questions: ${err.message}`);
    return;
  }
  await nextQuestion(channel);
}

export function stopGame(channel) {
  const s = getState(channel);
  if (s.status === 'idle') { say(channel, 'No game is running.'); return; }
  if (s.timer) clearTimeout(s.timer);
  s.status = 'idle';
  say(channel, `Game stopped. ${formatScores(s.scores)}`);
}

export async function skipQuestion(channel) {
  const s = getState(channel);
  if (s.status === 'idle') return;
  if (s.timer) clearTimeout(s.timer);
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
  if (s.timer) clearTimeout(s.timer);
  s.scores[nick] = (s.scores[nick] || 0) + 1;
  addPoint(channel, nick);
  console.log(`[game] ${channel} correct: ${nick} answered "${guess}" (answer: "${s.answer}")`);
  say(channel, `Correct! ${nick} got it! The answer was: ${s.answer} (+1 point)`);
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
    case 'start':
      if (getStartPerm(channel) === 'owner' && !owner) return;
      await startGame(channel);
      break;
    case 'stop':
      if (getStopPerm(channel) === 'owner' && !owner) return;
      stopGame(channel);
      break;
    case 'skip':       if (!owner) return; await skipQuestion(channel); break;
    case 'scores':     showScores(channel); break;
    case 'leaderboard':
    case 'lb':         showLeaderboard(channel); break;
    case 'topic':
      if (!owner) return;
      if (!args.length) { say(channel, `Usage: ${PREFIX()}topic <topic>`); return; }
      setTopic(channel, args.join(' '));
      break;
    case 'difficulty':
    case 'diff':
      if (!owner) return;
      if (!args.length) { say(channel, `Usage: ${PREFIX()}difficulty <easy|medium|hard>`); return; }
      setDifficulty(channel, args[0].toLowerCase());
      break;
    case 'language':
    case 'lang':
      if (!owner) return;
      if (!args.length) { say(channel, `Usage: ${PREFIX()}language <English|French|...>`); return; }
      setLanguage(channel, args.join(' '));
      break;
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
      say(channel, `${PREFIX()}start  ${PREFIX()}stop  ${PREFIX()}skip  ${PREFIX()}scores  ${PREFIX()}lb  ${PREFIX()}topics  ${PREFIX()}settings  ${PREFIX()}ping  ${PREFIX()}uptime  ${PREFIX()}version  ${PREFIX()}about` +
        (owner ? `  [owner: ${PREFIX()}topic  ${PREFIX()}diff  ${PREFIX()}lang  ${PREFIX()}say  ${PREFIX()}nick  ${PREFIX()}quit  DM: ${PREFIX()}join  ${PREFIX()}part  ${PREFIX()}channels  ${PREFIX()}status]` : ''));
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
    case 'help':
      client.say(nick, `Owner DM commands: ${PREFIX()}join <#ch>  ${PREFIX()}part <#ch>  ${PREFIX()}say <#ch> <text>  ${PREFIX()}nick <newnick>  ${PREFIX()}quit [msg]  ${PREFIX()}channels  ${PREFIX()}status  ${PREFIX()}startperm <#ch> <owner|anyone>  ${PREFIX()}stopperm <#ch> <owner|anyone>`);
      break;
  }
}

// ─── Internals ────────────────────────────────────────────────────────────────

async function nextQuestion(channel) {
  const s = getState(channel);
  s.status = 'asking';

  const q = s.queue.shift();
  if (!q) { await endGame(channel); return; }

  s.question = q.question;
  s.answer   = q.answer;
  s.variants = q.variants;
  s.asked.push(q.question);
  console.log(`[game] ${channel} Q${s.questionNum + 1}: "${q.question}" A: "${q.answer}"`);
  say(channel, `Q${s.questionNum + 1}: ${q.question} (${TIMEOUT_MS() / 1000}s)`);

  s.timer = setTimeout(async () => {
    if (s.status !== 'asking') return;
    say(channel, `Time's up! The answer was: ${s.answer}`);
    s.questionNum++;
    s.questionNum >= QPR() ? await endGame(channel) : await nextQuestion(channel);
  }, TIMEOUT_MS());
}

async function endGame(channel) {
  const s = getState(channel);
  s.status = 'idle';
  say(channel, `Game over! Final scores: ${formatScores(s.scores) || 'No points scored'}`);
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
