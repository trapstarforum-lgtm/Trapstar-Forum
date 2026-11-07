const fs = require('fs');
const path = require('path');
const { DatabaseSync } = require('node:sqlite');

const OWNER_EMAIL = 'sadikovicnedim92@gmail.com';
const OWNER_NAME = 'Trapstar';

function openDb(root) {
  const dir = process.env.VERCEL
    ? '/tmp/trapstar'
    : (process.env.DATA_DIR || path.join(root, 'data'));
  fs.mkdirSync(dir, { recursive: true });
  const db = new DatabaseSync(path.join(dir, 'trapstar.db'));
  const journal = process.env.VERCEL ? 'DELETE' : 'WAL';
  db.exec(`
    PRAGMA journal_mode = ${journal};
    PRAGMA foreign_keys = ON;
    PRAGMA busy_timeout = 4000;

    CREATE TABLE IF NOT EXISTS users (
      id INTEGER PRIMARY KEY,
      username TEXT NOT NULL COLLATE NOCASE UNIQUE,
      email TEXT NOT NULL UNIQUE,
      password_hash TEXT,
      role TEXT NOT NULL CHECK(role IN ('member', 'staff', 'owner')),
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS pending_signups (
      email TEXT PRIMARY KEY,
      username TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      code_hash TEXT NOT NULL,
      salt TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS password_resets (
      user_id INTEGER PRIMARY KEY,
      code_hash TEXT NOT NULL,
      salt TEXT NOT NULL,
      expires_at INTEGER NOT NULL,
      attempts INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS sessions (
      token TEXT PRIMARY KEY,
      user_id INTEGER NOT NULL,
      expires_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS categories (
      id INTEGER PRIMARY KEY,
      slug TEXT NOT NULL UNIQUE,
      name TEXT NOT NULL,
      description TEXT NOT NULL,
      sort INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS threads (
      id INTEGER PRIMARY KEY,
      category_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      title TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL,
      pinned INTEGER NOT NULL DEFAULT 0,
      locked INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS posts (
      id INTEGER PRIMARY KEY,
      thread_id INTEGER NOT NULL,
      user_id INTEGER NOT NULL,
      body TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS servers (
      id INTEGER PRIMARY KEY,
      host TEXT NOT NULL,
      port INTEGER NOT NULL,
      created_at INTEGER NOT NULL,
      UNIQUE(host, port)
    );

    CREATE TABLE IF NOT EXISTS server_status (
      server_id INTEGER PRIMARY KEY,
      online INTEGER NOT NULL DEFAULT 0,
      name TEXT NOT NULL DEFAULT '',
      map TEXT NOT NULL DEFAULT '',
      players INTEGER NOT NULL DEFAULT 0,
      max_players INTEGER NOT NULL DEFAULT 0,
      player_names TEXT NOT NULL DEFAULT '[]',
      rtt INTEGER,
      error TEXT NOT NULL DEFAULT '',
      fail_count INTEGER NOT NULL DEFAULT 0,
      checked_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS reports (
      id INTEGER PRIMARY KEY,
      type TEXT NOT NULL CHECK(type IN ('player', 'admin')),
      user_id INTEGER NOT NULL,
      target TEXT NOT NULL,
      server_label TEXT NOT NULL DEFAULT '',
      reason TEXT NOT NULL,
      details TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open', 'reviewing', 'closed')),
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS applications (
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL,
      nick TEXT NOT NULL,
      experience TEXT NOT NULL,
      why TEXT NOT NULL,
      availability TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending', 'accepted', 'declined')),
      created_at INTEGER NOT NULL,
      reviewed_at INTEGER
    );

    CREATE TABLE IF NOT EXISTS messages (
      id INTEGER PRIMARY KEY,
      user_id INTEGER NOT NULL,
      body TEXT NOT NULL,
      created_at INTEGER NOT NULL
    );

    CREATE TABLE IF NOT EXISTS repositories (
      id INTEGER PRIMARY KEY,
      owner TEXT NOT NULL,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      html_url TEXT NOT NULL,
      language TEXT NOT NULL DEFAULT '',
      stars INTEGER NOT NULL DEFAULT 0,
      forks INTEGER NOT NULL DEFAULT 0,
      pushed_at INTEGER,
      checked_at INTEGER,
      added_by INTEGER,
      created_at INTEGER NOT NULL,
      UNIQUE(owner, name)
    );

    CREATE INDEX IF NOT EXISTS idx_posts_thread ON posts(thread_id, id);
    CREATE INDEX IF NOT EXISTS idx_threads_cat ON threads(category_id, pinned DESC, updated_at DESC);
    CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);
  `);
  seed(db);
  return db;
}

function seed(db) {
  const categories = [
    ['announcements', 'Announcements', 'News from the owner and staff.', 1],
    ['general', 'General', 'Anything Trapstar that is not a match or a server.', 2],
    ['server-talk', 'Server talk', 'Maps, settings, lag, and what should change.', 3],
    ['mixes', 'Mixes', 'Gathers, scores, and looking for a fifth.', 4],
    ['introductions', 'Introductions', 'Say who you play and what you main.', 5],
  ];
  const insertCat = db.prepare(
    'INSERT OR IGNORE INTO categories (slug, name, description, sort) VALUES (?, ?, ?, ?)'
  );
  for (const row of categories) insertCat.run(...row);

  const owner = db.prepare('SELECT id, role FROM users WHERE email = ?').get(OWNER_EMAIL);
  let ownerId;
  if (!owner) {
    const info = db.prepare(
      `INSERT INTO users (username, email, password_hash, role, created_at)
       VALUES (?, ?, NULL, 'owner', ?)`
    ).run(OWNER_NAME, OWNER_EMAIL, Date.now());
    ownerId = Number(info.lastInsertRowid);
  } else {
    ownerId = owner.id;
    if (owner.role !== 'owner') {
      db.prepare(`UPDATE users SET role = 'owner' WHERE id = ?`).run(ownerId);
    }
  }

  const threadCount = db.prepare('SELECT COUNT(*) AS n FROM threads').get().n;
  if (threadCount === 0) {
    const cat = db.prepare(`SELECT id FROM categories WHERE slug = 'announcements'`).get();
    const now = Date.now();
    const thread = db.prepare(
      `INSERT INTO threads (category_id, user_id, title, created_at, updated_at, pinned, locked)
       VALUES (?, ?, ?, ?, ?, 1, 1)`
    ).run(cat.id, ownerId, 'Welcome to Trapstar', now, now);
    const body = [
      'This is the Trapstar board for Counter-Strike 1.6.',
      '',
      'Discord: https://discord.gg/trapstarcommunity',
      '',
      'New accounts start as Members. Server cards show the name, the map, and who is playing. If you want to admin, send an application. If an admin or a player crosses the line, file a report. Staff read the queue.',
      '',
      'Read the rules before you join a mix. See you on the server.',
    ].join('\n');
    db.prepare(
      `INSERT INTO posts (thread_id, user_id, body, created_at) VALUES (?, ?, ?, ?)`
    ).run(Number(thread.lastInsertRowid), ownerId, body, now);
  }
}

module.exports = { openDb, OWNER_EMAIL, OWNER_NAME };
