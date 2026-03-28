import Database from 'better-sqlite3';
import { mkdirSync } from 'fs';
import { dirname } from 'path';

let db;

export function initDb(path) {
  mkdirSync(dirname(path), { recursive: true });
  db = new Database(path);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.exec(`
    CREATE TABLE IF NOT EXISTS channel_settings (
      channel TEXT NOT NULL,
      key     TEXT NOT NULL,
      value   TEXT NOT NULL,
      PRIMARY KEY (channel, key)
    );
    CREATE TABLE IF NOT EXISTS scores (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      channel TEXT NOT NULL,
      nick TEXT NOT NULL,
      score INTEGER NOT NULL DEFAULT 0,
      updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
      UNIQUE(channel, nick)
    );
    CREATE INDEX IF NOT EXISTS idx_scores_channel ON scores(channel, score DESC);
  `);
  return db;
}

export function getDb() { return db; }

export function loadChannelSettings(channel) {
  const rows = db.prepare('SELECT key, value FROM channel_settings WHERE channel = ?').all(channel);
  return Object.fromEntries(rows.map(r => [r.key, r.value]));
}

export function saveChannelSetting(channel, key, value) {
  db.prepare(`
    INSERT INTO channel_settings (channel, key, value) VALUES (?, ?, ?)
    ON CONFLICT(channel, key) DO UPDATE SET value = excluded.value
  `).run(channel, key, String(value));
}

export function addPoint(channel, nick) {
  db.prepare(`
    INSERT INTO scores (channel, nick, score, updated_at)
    VALUES (?, ?, 1, unixepoch())
    ON CONFLICT(channel, nick) DO UPDATE SET
      score = score + 1,
      updated_at = unixepoch()
  `).run(channel, nick);
}

export function getSessionScores(channel, nicks) {
  if (!nicks.length) return [];
  const placeholders = nicks.map(() => '?').join(',');
  return db.prepare(`
    SELECT nick, score FROM scores
    WHERE channel = ? AND nick IN (${placeholders})
    ORDER BY score DESC
  `).all(channel, ...nicks);
}

export function getLeaderboard(channel, limit = 10) {
  return db.prepare(`
    SELECT nick, score FROM scores
    WHERE channel = ?
    ORDER BY score DESC
    LIMIT ?
  `).all(channel, limit);
}
