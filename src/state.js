import config from 'config';
import { loadChannelSettings } from './db.js';

// Game state lives here — survives hot reloads of game.js / commands.js
const channels = new Map();

export function getState(channel) {
  if (!channels.has(channel)) {
    const saved = loadChannelSettings(channel);
    channels.set(channel, {
      status: 'idle',
      question: null,
      variants: [],
      answer: null,
      scores: {},
      questionNum: 0,
      timer: null,
      asked: [],
      topic:      saved.topic      ?? config.get('game.topics')[0] ?? 'General Knowledge',
      difficulty: saved.difficulty ?? config.get('game.difficulty') ?? 'medium',
      language:   saved.language   ?? config.get('game.language')   ?? 'English',
      startPerm:  saved.startPerm  ?? null,
      stopPerm:   saved.stopPerm   ?? null,
    });
  }
  return channels.get(channel);
}

export function getAllChannels() {
  return channels.keys();
}
