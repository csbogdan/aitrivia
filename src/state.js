import config from 'config';

// Game state lives here — survives hot reloads of game.js / commands.js
const channels = new Map();

export function getState(channel) {
  if (!channels.has(channel)) {
    channels.set(channel, {
      status: 'idle',
      question: null,
      variants: [],
      answer: null,
      scores: {},
      questionNum: 0,
      timer: null,
      topic: config.get('game.topics')[0] || 'General Knowledge',
      difficulty: config.get('game.difficulty') || 'medium',
      language: config.get('game.language') || 'English',
      asked: [],   // questions asked this session — passed to AI to prevent repeats
    });
  }
  return channels.get(channel);
}

export function getAllChannels() {
  return channels.keys();
}
