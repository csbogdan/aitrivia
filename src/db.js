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
    CREATE TABLE IF NOT EXISTS question_cache (
      id         INTEGER PRIMARY KEY AUTOINCREMENT,
      topic      TEXT NOT NULL,
      difficulty TEXT NOT NULL,
      language   TEXT NOT NULL,
      question   TEXT NOT NULL,
      answer     TEXT NOT NULL,
      variants   TEXT NOT NULL,
      used_at    INTEGER NOT NULL DEFAULT 0
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

// ─── Question cache ───────────────────────────────────────────────────────────

export function pruneQuestionDuplicates() {
  // Remove dupes keeping the earliest id, then enforce unique index going forward
  const { changes } = db.prepare(`
    DELETE FROM question_cache
    WHERE id NOT IN (
      SELECT MIN(id) FROM question_cache
      GROUP BY topic, difficulty, language, lower(question)
    )
  `).run();
  if (changes) console.log(`[cache] pruned ${changes} duplicate question(s)`);
  db.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_qcache_unique ON question_cache(topic, difficulty, language, lower(question))`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_qcache_lru ON question_cache(topic, difficulty, language, used_at)`);
}

// Returns how many questions are stored for this topic/difficulty/language
export function countQuestions(topic, difficulty, language) {
  return db.prepare(`SELECT COUNT(*) as n FROM question_cache WHERE topic=? AND difficulty=? AND language=?`)
    .get(topic, difficulty, language).n;
}

// Returns how many questions are stored in total across all topics
export function countAllQuestions() {
  return db.prepare(`SELECT COUNT(*) as n FROM question_cache`).get().n;
}

// Fetch `limit` least-recently-used questions and mark them as used now
export function fetchQuestions(topic, difficulty, language, limit) {
  const rows = db.prepare(`
    SELECT id, question, answer, variants FROM question_cache
    WHERE topic=? AND difficulty=? AND language=?
    ORDER BY used_at ASC
    LIMIT ?
  `).all(topic, difficulty, language, limit);

  if (rows.length) {
    const ids = rows.map(r => r.id).join(',');
    db.exec(`UPDATE question_cache SET used_at=${Date.now()} WHERE id IN (${ids})`);
  }
  return rows.map(r => ({ question: r.question, answer: r.answer, variants: JSON.parse(r.variants) }));
}

// Store new questions; never prune — accumulate up to the configured cap
export function storeQuestions(topic, difficulty, language, questions, cap) {
  const total = countAllQuestions();
  const room = Math.max(0, cap - total);
  const toStore = questions.slice(0, room);
  if (!toStore.length) return;

  const insert = db.prepare(`
    INSERT OR IGNORE INTO question_cache (topic, difficulty, language, question, answer, variants)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  db.transaction(qs => {
    for (const q of qs) insert.run(topic, difficulty, language, q.question, q.answer, JSON.stringify(q.variants));
  })(toStore);
  console.log(`[cache] +${toStore.length} questions (${topic}/${difficulty}/${language}), total=${total + toStore.length}/${cap}`);
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
