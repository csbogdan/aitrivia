import config from 'config';
import { generateQuestion } from './ai.js';
import { addPoint, getLeaderboard } from './db.js';
import { say } from './sendQueue.js';
import { getState, getAllChannels } from './state.js';

const TIMEOUT_MS = (config.get('game.question_timeout_seconds') || 30) * 1000;
const QUESTIONS_PER_ROUND = config.get('game.questions_per_round') || 10;

export function resetState(channel) {
  const state = getState(channel);
  if (state.timer) clearTimeout(state.timer);
  state.status = 'idle';
  state.question = null;
  state.variants = [];
  state.answer = null;
  state.questionNum = 0;
  state.timer = null;
  state.scores = {};
}

export function resetAll() {
  for (const channel of getAllChannels()) resetState(channel);
}

export async function startGame(channel) {
  const state = getState(channel);
  if (state.status !== 'idle') {
    say(channel, 'A game is already running. Use !stop to end it.');
    return;
  }
  state.scores = {};
  state.questionNum = 0;
  say(channel, `Starting trivia! Topic: ${state.topic} | Difficulty: ${state.difficulty} | Language: ${state.language} | ${QUESTIONS_PER_ROUND} questions`);
  await nextQuestion(channel);
}

export function stopGame(channel) {
  const state = getState(channel);
  if (state.status === 'idle') {
    say(channel, 'No game is running.');
    return;
  }
  if (state.timer) clearTimeout(state.timer);
  state.status = 'idle';
  say(channel, `Game stopped. ${formatScores(state.scores)}`);
}

export async function skipQuestion(channel) {
  const state = getState(channel);
  if (state.status === 'idle') return;
  if (state.timer) clearTimeout(state.timer);
  say(channel, `Skipping! The answer was: ${state.answer}`);
  state.questionNum++;
  if (state.questionNum >= QUESTIONS_PER_ROUND) {
    await endGame(channel);
  } else {
    await nextQuestion(channel);
  }
}

export async function handleAnswer(channel, nick, text) {
  const state = getState(channel);
  if (state.status !== 'asking') return;

  const guess = text.toLowerCase().trim();
  if (!state.variants.includes(guess) && !fuzzyMatch(guess, state.variants)) return;

  state.status = 'judging';
  if (state.timer) clearTimeout(state.timer);

  state.scores[nick] = (state.scores[nick] || 0) + 1;
  addPoint(channel, nick);
  console.log(`[game] ${channel} correct answer by ${nick}: "${guess}" matched "${state.answer}"`);
  say(channel, `Correct! ${nick} got it! The answer was: ${state.answer} (+1 point)`);

  state.questionNum++;
  if (state.questionNum >= QUESTIONS_PER_ROUND) {
    await endGame(channel);
  } else {
    await nextQuestion(channel);
  }
}

export function showScores(channel) {
  const state = getState(channel);
  if (!Object.keys(state.scores).length) {
    say(channel, 'No scores yet this session.');
    return;
  }
  say(channel, `Scores: ${formatScores(state.scores)}`);
}

export function showLeaderboard(channel) {
  const rows = getLeaderboard(channel);
  if (!rows.length) {
    say(channel, 'No scores recorded yet.');
    return;
  }
  const text = rows.map((r, i) => `${i + 1}. ${r.nick} (${r.score})`).join('  ');
  say(channel, `All-time leaderboard: ${text}`);
}

export function setTopic(channel, topic) {
  getState(channel).topic = topic;
  say(channel, `Topic set to: ${topic}`);
}

export function setDifficulty(channel, difficulty) {
  const valid = ['easy', 'medium', 'hard'];
  if (!valid.includes(difficulty)) {
    say(channel, `Invalid difficulty. Choose: ${valid.join(', ')}`);
    return;
  }
  getState(channel).difficulty = difficulty;
  say(channel, `Difficulty set to: ${difficulty}`);
}

export function setLanguage(channel, language) {
  getState(channel).language = language;
  say(channel, `Language set to: ${language}`);
}

// --- internal ---

async function nextQuestion(channel) {
  const state = getState(channel);
  state.status = 'asking';
  console.log(`[game] ${channel} Q${state.questionNum + 1} — topic: ${state.topic}, difficulty: ${state.difficulty}, lang: ${state.language}`);
  say(channel, `Question ${state.questionNum + 1}/${QUESTIONS_PER_ROUND} — generating...`);

  let q;
  try {
    q = await generateQuestion(state.topic, state.difficulty, state.language);
  } catch (err) {
    if (state.status === 'idle') return;
    say(channel, `Failed to generate question: ${err.message}. Skipping.`);
    state.questionNum++;
    if (state.questionNum >= QUESTIONS_PER_ROUND) {
      await endGame(channel);
    } else {
      await nextQuestion(channel);
    }
    return;
  }

  if (state.status === 'idle') return;

  state.question = q.question;
  state.answer = q.answer;
  state.variants = q.variants;

  say(channel, `Q${state.questionNum + 1}: ${q.question} (${TIMEOUT_MS / 1000}s)`);

  state.timer = setTimeout(async () => {
    if (state.status !== 'asking') return;
    say(channel, `Time's up! The answer was: ${state.answer}`);
    state.questionNum++;
    if (state.questionNum >= QUESTIONS_PER_ROUND) {
      await endGame(channel);
    } else {
      await nextQuestion(channel);
    }
  }, TIMEOUT_MS);
}

async function endGame(channel) {
  const state = getState(channel);
  state.status = 'idle';
  say(channel, `Game over! Final scores: ${formatScores(state.scores) || 'No points scored'}`);
}

function formatScores(scores) {
  return Object.entries(scores)
    .sort((a, b) => b[1] - a[1])
    .map(([nick, pts]) => `${nick}: ${pts}`)
    .join('  |  ');
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
