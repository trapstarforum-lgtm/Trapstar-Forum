const http = require('http');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { openDb, OWNER_EMAIL } = require('./lib/db');
const { queryServer } = require('./lib/query');
const { sendCodeEmail, mailConfigured, contactEmail } = require('./lib/mail');

const root = __dirname;
const publicDir = path.join(root, 'public');
const DISCORD = 'https://discord.gg/trapstarcommunity';
const WS_MAGIC = '258EAFA5-E914-47DA-95CA-C5AB0DC85B11';
const RESERVED = new Set(['admin', 'administrator', 'moderator', 'system', 'staff', 'owner', 'trapstar']);

loadEnv(path.join(root, '.env'));
const db = openDb(root);
const DUMMY_HASH = hashPassword('not-a-real-password-value');
const sockets = new Set();
const inflight = new Map();
const hits = new Map();

class HttpError extends Error {
  constructor(status, message) {
    super(message);
    this.status = status;
  }
}

function loadEnv(file) {
  if (!fs.existsSync(file)) return;
  for (const line of fs.readFileSync(file, 'utf8').split(/\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const i = trimmed.indexOf('=');
    if (i === -1) continue;
    const key = trimmed.slice(0, i).trim();
    let value = trimmed.slice(i + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = value;
  }
}

function hashPassword(password) {
  const salt = crypto.randomBytes(16).toString('hex');
  const hash = crypto.scryptSync(password, salt, 32).toString('hex');
  return `scrypt$${salt}$${hash}`;
}

function verifyPassword(password, stored) {
  const parts = String(stored || '').split('$');
  if (parts.length !== 3 || parts[0] !== 'scrypt') return false;
  const hash = crypto.scryptSync(password, parts[1], 32);
  const saved = Buffer.from(parts[2], 'hex');
  if (hash.length !== saved.length) return false;
  return crypto.timingSafeEqual(hash, saved);
}

function passwordMatches(password, stored) {
  const ok = verifyPassword(password, stored || DUMMY_HASH);
  return Boolean(stored) && ok;
}

function makeCode() {
  return String(crypto.randomInt(0, 1000000)).padStart(6, '0');
}

function codeBundle() {
  const code = makeCode();
  const salt = crypto.randomBytes(16).toString('hex');
  const codeHash = crypto.createHash('sha256').update(`${salt}:${code}`).digest('hex');
  return { code, salt, codeHash, expiresAt: Date.now() + 15 * 60 * 1000 };
}

function codeMatches(row, code) {
  const hash = crypto.createHash('sha256').update(`${row.salt}:${code}`).digest();
  const saved = Buffer.from(row.code_hash, 'hex');
  if (hash.length !== saved.length) return false;
  return crypto.timingSafeEqual(hash, saved);
}

function normalizeEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || email.length > 120) return '';
  return email;
}

function requireText(value, min, max, label) {
  const text = String(value ?? '').replace(/\r\n/g, '\n').trim().replace(/\n{3,}/g, '\n\n');
  if (text.length < min) throw new HttpError(400, `${label} is too short.`);
  if (text.length > max) throw new HttpError(400, `${label} is too long.`);
  return text;
}

function parseAddress(input) {
  const match = String(input || '').trim().match(/^([a-zA-Z0-9.-]{1,253}):(\d{1,5})$/);
  if (!match) return null;
  const port = Number(match[2]);
  const host = match[1].replace(/\.$/, '').toLowerCase();
  if (!host || host.startsWith('.') || host.includes('..') || port < 1 || port > 65535) return null;
  return { host, port };
}

function limit(key, max, windowMs) {
  const now = Date.now();
  const fresh = (hits.get(key) || []).filter((stamp) => now - stamp < windowMs);
  if (fresh.length >= max) return false;
  fresh.push(now);
  hits.set(key, fresh);
  return true;
}

function parseCookies(req) {
  const out = {};
  for (const part of String(req.headers.cookie || '').split(';')) {
    const i = part.indexOf('=');
    if (i === -1) continue;
    out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

function currentUser(req) {
  const token = parseCookies(req).sid;
  if (!token) return null;
  return db.prepare(
    `SELECT u.* FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token = ? AND s.expires_at > ?`
  ).get(token, Date.now()) || null;
}

function must(user, roles) {
  if (!user) throw new HttpError(401, 'Sign in first.');
  if (roles && !roles.includes(user.role)) throw new HttpError(403, 'You cannot do that.');
  return user;
}

function isStaff(user) {
  return user && (user.role === 'staff' || user.role === 'owner');
}

function publicUser(user) {
  return { id: user.id, username: user.username, role: user.role, createdAt: user.created_at };
}

function sessionUser(user) {
  return { ...publicUser(user), email: user.email };
}

function setSession(res, userId) {
  const token = crypto.randomBytes(32).toString('hex');
  db.prepare('INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)').run(
    token,
    userId,
    Date.now() + 14 * 24 * 60 * 60 * 1000
  );
  const secure = String(process.env.PUBLIC_URL || '').startsWith('https://') ? '; Secure' : '';
  res.setHeader('Set-Cookie', `sid=${token}; HttpOnly; Path=/; Max-Age=${14 * 24 * 60 * 60}; SameSite=Lax${secure}`);
}

function clearSession(res, req) {
  const token = parseCookies(req).sid;
  if (token) db.prepare('DELETE FROM sessions WHERE token = ?').run(token);
  res.setHeader('Set-Cookie', 'sid=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax');
}

function securityHeaders() {
  return {
    'X-Content-Type-Options': 'nosniff',
    'X-Frame-Options': 'DENY',
    'Referrer-Policy': 'strict-origin-when-cross-origin',
    'Content-Security-Policy': [
      "default-src 'self'",
      "img-src 'self' data:",
      "style-src 'self' https://fonts.googleapis.com",
      "font-src 'self' https://fonts.gstatic.com",
      "script-src 'self'",
      "connect-src 'self'",
      "base-uri 'self'",
      "form-action 'self'",
      "frame-ancestors 'none'",
    ].join('; '),
  };
}

function send(res, status, data) {
  if (res.headersSent || res.writableEnded) return;
  const body = JSON.stringify(data);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
    'Cache-Control': 'no-store',
    ...securityHeaders(),
  });
  res.end(body);
}

function readBody(req) {
  if (req.body && typeof req.body === 'object' && !Buffer.isBuffer(req.body)) {
    return Promise.resolve(req.body);
  }
  if (typeof req.body === 'string' && req.body) {
    try { return Promise.resolve(JSON.parse(req.body)); }
    catch { return Promise.reject(new HttpError(400, 'Invalid JSON.')); }
  }
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (chunk) => {
      size += chunk.length;
      if (size > 100000) {
        reject(new HttpError(413, 'Request is too large.'));
        req.destroy();
        return;
      }
      chunks.push(chunk);
    });
    req.on('end', () => {
      if (!size) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8')));
      } catch {
        reject(new HttpError(400, 'Invalid JSON.'));
      }
    });
    req.on('error', reject);
  });
}

function clientIp(req) {
  return req.socket.remoteAddress || 'local';
}

async function deliverCode({ to, purpose, code, username }) {
  try {
    await sendCodeEmail({ root, to, purpose, code, username });
  } catch (err) {
    throw new HttpError(502, err.publicMessage || 'Could not send the email.');
  }
}

function presentServer(row, manage) {
  let playerNames = [];
  try {
    const parsed = JSON.parse(row.player_names || '[]');
    if (Array.isArray(parsed)) playerNames = parsed.slice(0, 32);
  } catch { /* keep empty */ }
  const item = {
    id: row.id,
    address: `${row.host}:${row.port}`,
    online: !!row.online,
    name: row.name || '',
    map: row.map || '',
    players: row.players || 0,
    maxPlayers: row.max_players || 0,
    playerNames,
    rtt: row.rtt ?? null,
    checkedAt: row.checked_at || null,
  };
  if (manage) item.error = row.error || '';
  return item;
}

function serverRows() {
  return db.prepare(`
    SELECT s.id, s.host, s.port, s.created_at,
      st.online, st.name, st.map, st.players, st.max_players, st.player_names,
      st.rtt, st.error, st.checked_at
    FROM servers s
    LEFT JOIN server_status st ON st.server_id = s.id
    ORDER BY s.id
  `).all();
}

async function refreshOne(id) {
  if (inflight.has(id)) return inflight.get(id);
  const job = updateServer(id).finally(() => inflight.delete(id));
  inflight.set(id, job);
  return job;
}

async function updateServer(id) {
  const server = db.prepare('SELECT * FROM servers WHERE id = ?').get(id);
  if (!server) return;
  const result = await queryServer(server.host, server.port);
  const prev = db.prepare('SELECT * FROM server_status WHERE server_id = ?').get(id);
  let next;
  if (result.online) {
    next = {
      online: 1,
      name: result.name,
      map: result.map,
      players: result.players,
      max_players: result.maxPlayers,
      player_names: JSON.stringify(result.playerNames || []),
      rtt: result.rtt,
      error: '',
      fail_count: 0,
    };
  } else if (prev && prev.online && prev.fail_count < 1) {
    next = {
      online: 1,
      name: prev.name,
      map: prev.map,
      players: prev.players,
      max_players: prev.max_players,
      player_names: prev.player_names,
      rtt: prev.rtt,
      error: '',
      fail_count: 1,
    };
  } else {
    next = {
      online: 0,
      name: prev ? prev.name : '',
      map: prev ? prev.map : '',
      players: 0,
      max_players: prev ? prev.max_players : 0,
      player_names: '[]',
      rtt: null,
      error: result.error || 'No response',
      fail_count: (prev ? prev.fail_count : 0) + 1,
    };
  }
  db.prepare(`
    INSERT INTO server_status (
      server_id, online, name, map, players, max_players, player_names, rtt, error, fail_count, checked_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(server_id) DO UPDATE SET
      online = excluded.online,
      name = excluded.name,
      map = excluded.map,
      players = excluded.players,
      max_players = excluded.max_players,
      player_names = excluded.player_names,
      rtt = excluded.rtt,
      error = excluded.error,
      fail_count = excluded.fail_count,
      checked_at = excluded.checked_at
  `).run(
    id, next.online, next.name, next.map, next.players, next.max_players,
    next.player_names, next.rtt, next.error, next.fail_count, Date.now()
  );
}

function checkCode(row, code) {
  if (!row || row.expires_at < Date.now() || row.attempts >= 8) return 'expired';
  if (!codeMatches(row, code)) return 'bad';
  return 'ok';
}

async function registerStart(req, res, _params, _user, body) {
  const ip = clientIp(req);
  if (!limit(`reg:${ip}`, 6, 60 * 60 * 1000)) throw new HttpError(429, 'Too many signups from this network. Wait a bit.');
  if (!body.older) throw new HttpError(400, 'You need to be 13 or older.');
  const username = String(body.username || '').trim();
  const email = normalizeEmail(body.email);
  const password = String(body.password || '');
  if (!/^[A-Za-z0-9_]{3,16}$/.test(username)) {
    throw new HttpError(400, 'Name must be 3–16 letters, numbers, or underscores.');
  }
  if (RESERVED.has(username.toLowerCase())) throw new HttpError(400, 'That name is reserved.');
  if (!email) throw new HttpError(400, 'Enter a valid email.');
  if (password.length < 8 || password.length > 72) throw new HttpError(400, 'Password must be 8–72 characters.');
  if (db.prepare('SELECT id FROM users WHERE email = ?').get(email)) {
    throw new HttpError(400, 'An account with this email already exists. Reset the password to sign in.');
  }
  if (db.prepare('SELECT id FROM users WHERE username = ?').get(username)) {
    throw new HttpError(400, 'That name is taken.');
  }
  const bundle = codeBundle();
  db.prepare(`
    INSERT INTO pending_signups (email, username, password_hash, code_hash, salt, expires_at, attempts, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 0, ?)
    ON CONFLICT(email) DO UPDATE SET
      username = excluded.username,
      password_hash = excluded.password_hash,
      code_hash = excluded.code_hash,
      salt = excluded.salt,
      expires_at = excluded.expires_at,
      attempts = 0,
      created_at = excluded.created_at
  `).run(email, username, hashPassword(password), bundle.codeHash, bundle.salt, bundle.expiresAt, Date.now());
  try {
    await deliverCode({ to: email, purpose: 'register', code: bundle.code, username });
  } catch (err) {
    db.prepare('DELETE FROM pending_signups WHERE email = ?').run(email);
    throw err;
  }
  send(res, 200, { ok: true, email });
}

async function registerResend(req, res, _params, _user, body) {
  const email = normalizeEmail(body.email);
  const pending = email && db.prepare('SELECT * FROM pending_signups WHERE email = ?').get(email);
  if (!pending) throw new HttpError(400, 'Start the signup again.');
  if (!limit(`resend:${email}`, 3, 15 * 60 * 1000)) throw new HttpError(429, 'Wait a few minutes before asking for another code.');
  const bundle = codeBundle();
  db.prepare(`
    UPDATE pending_signups SET code_hash = ?, salt = ?, expires_at = ?, attempts = 0 WHERE email = ?
  `).run(bundle.codeHash, bundle.salt, bundle.expiresAt, email);
  try {
    await deliverCode({ to: email, purpose: 'register', code: bundle.code, username: pending.username });
  } catch (err) {
    throw err;
  }
  send(res, 200, { ok: true });
}

function registerVerify(req, res, _params, _user, body) {
  const email = normalizeEmail(body.email);
  const code = String(body.code || '').replace(/\D/g, '');
  const pending = email && db.prepare('SELECT * FROM pending_signups WHERE email = ?').get(email);
  if (!pending) throw new HttpError(400, 'Start the signup again.');
  if (code.length !== 6) throw new HttpError(400, 'Enter the 6-digit code.');
  const result = checkCode(pending, code);
  if (result === 'expired') {
    db.prepare('DELETE FROM pending_signups WHERE email = ?').run(email);
    throw new HttpError(400, 'That code expired. Request a new one.');
  }
  if (result === 'bad') {
    db.prepare('UPDATE pending_signups SET attempts = attempts + 1 WHERE email = ?').run(email);
    throw new HttpError(400, 'That code does not match.');
  }
  const role = email === OWNER_EMAIL ? 'owner' : 'member';
  const info = db.prepare(
    `INSERT INTO users (username, email, password_hash, role, created_at) VALUES (?, ?, ?, ?, ?)`
  ).run(pending.username, email, pending.password_hash, role, Date.now());
  db.prepare('DELETE FROM pending_signups WHERE email = ?').run(email);
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(info.lastInsertRowid));
  setSession(res, user.id);
  send(res, 200, { user: sessionUser(user) });
}

function login(req, res, _params, _user, body) {
  const ip = clientIp(req);
  if (!limit(`login:${ip}`, 12, 10 * 60 * 1000)) throw new HttpError(429, 'Too many sign-in attempts. Wait a few minutes.');
  const key = String(body.identifier || '').trim();
  const password = String(body.password || '');
  if (password.length > 72) throw new HttpError(401, 'Wrong email, name, or password.');
  const user = key
    ? db.prepare('SELECT * FROM users WHERE email = ? OR username = ? COLLATE NOCASE').get(key.toLowerCase(), key)
    : null;
  const ok = passwordMatches(password, user ? user.password_hash : null);
  if (!user || !ok) throw new HttpError(401, 'Wrong email, name, or password.');
  setSession(res, user.id);
  send(res, 200, { user: sessionUser(user) });
}

function logout(req, res) {
  clearSession(res, req);
  send(res, 200, { ok: true });
}

async function resetStart(req, res, _params, _user, body) {
  const email = normalizeEmail(body.email);
  if (!email) throw new HttpError(400, 'Enter a valid email.');
  if (!limit(`reset:${clientIp(req)}`, 6, 60 * 60 * 1000)) throw new HttpError(429, 'Too many requests. Wait a bit.');
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  if (user) {
    const bundle = codeBundle();
    db.prepare(`
      INSERT INTO password_resets (user_id, code_hash, salt, expires_at, attempts)
      VALUES (?, ?, ?, ?, 0)
      ON CONFLICT(user_id) DO UPDATE SET
        code_hash = excluded.code_hash,
        salt = excluded.salt,
        expires_at = excluded.expires_at,
        attempts = 0
    `).run(user.id, bundle.codeHash, bundle.salt, bundle.expiresAt);
    try {
      await deliverCode({ to: email, purpose: 'reset', code: bundle.code, username: user.username });
    } catch (err) {
      db.prepare('DELETE FROM password_resets WHERE user_id = ?').run(user.id);
      throw err;
    }
  }
  send(res, 200, { ok: true });
}

function resetConfirm(req, res, _params, _user, body) {
  const email = normalizeEmail(body.email);
  const code = String(body.code || '').replace(/\D/g, '');
  const password = String(body.password || '');
  if (!email) throw new HttpError(400, 'Enter a valid email.');
  if (password.length < 8 || password.length > 72) throw new HttpError(400, 'Password must be 8–72 characters.');
  if (code.length !== 6) throw new HttpError(400, 'Enter the 6-digit code.');
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  const row = user && db.prepare('SELECT * FROM password_resets WHERE user_id = ?').get(user.id);
  if (!user || !row) throw new HttpError(400, 'Request a new code.');
  const result = checkCode(row, code);
  if (result === 'expired') {
    db.prepare('DELETE FROM password_resets WHERE user_id = ?').run(user.id);
    throw new HttpError(400, 'That code expired. Request a new one.');
  }
  if (result === 'bad') {
    db.prepare('UPDATE password_resets SET attempts = attempts + 1 WHERE user_id = ?').run(user.id);
    throw new HttpError(400, 'That code does not match.');
  }
  db.prepare('UPDATE users SET password_hash = ? WHERE id = ?').run(hashPassword(password), user.id);
  db.prepare('DELETE FROM password_resets WHERE user_id = ?').run(user.id);
  const fresh = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
  setSession(res, fresh.id);
  send(res, 200, { user: sessionUser(fresh) });
}

async function touchServers() {
  const rows = db.prepare(`
    SELECT s.id, st.checked_at
    FROM servers s
    LEFT JOIN server_status st ON st.server_id = s.id
  `).all();
  const stale = rows.filter((row) => !row.checked_at || Date.now() - row.checked_at > 20000);
  const cap = process.env.VERCEL ? 2 : stale.length;
  for (const row of stale.slice(0, cap)) await refreshOne(row.id);
}

async function home() {
  await touchServers();
  const stats = {
    members: db.prepare('SELECT COUNT(*) AS n FROM users').get().n,
    threads: db.prepare('SELECT COUNT(*) AS n FROM threads').get().n,
    posts: db.prepare('SELECT COUNT(*) AS n FROM posts').get().n,
    servers: db.prepare('SELECT COUNT(*) AS n FROM servers').get().n,
    repos: db.prepare('SELECT COUNT(*) AS n FROM repositories').get().n,
  };
  const categories = db.prepare(`
    SELECT c.slug, c.name, c.description,
      (SELECT COUNT(*) FROM threads t WHERE t.category_id = c.id) AS threads
    FROM categories c ORDER BY c.sort
  `).all();
  const latest = db.prepare(`
    SELECT t.id, t.title, t.updated_at, t.pinned, c.name AS category, c.slug,
      u.username, u.role
    FROM threads t
    JOIN categories c ON c.id = t.category_id
    JOIN users u ON u.id = t.user_id
    ORDER BY t.updated_at DESC
    LIMIT 6
  `).all();
  return {
    stats,
    categories,
    latest,
    servers: serverRows().map((row) => presentServer(row, false)),
    repos: repoRows().map(presentRepo).slice(0, 4),
  };
}

function category(req, _res, params) {
  const cat = db.prepare('SELECT * FROM categories WHERE slug = ?').get(params.slug);
  if (!cat) throw new HttpError(404, 'That board does not exist.');
  const url = new URL(req.url, 'http://localhost');
  const page = Math.max(1, Number(url.searchParams.get('page') || 1) || 1);
  const pageSize = 20;
  const total = db.prepare('SELECT COUNT(*) AS n FROM threads WHERE category_id = ?').get(cat.id).n;
  const threads = db.prepare(`
    SELECT t.id, t.title, t.created_at, t.updated_at, t.pinned, t.locked,
      u.username, u.role,
      (SELECT COUNT(*) FROM posts p WHERE p.thread_id = t.id) AS posts,
      (SELECT u2.username FROM posts p JOIN users u2 ON u2.id = p.user_id
        WHERE p.thread_id = t.id ORDER BY p.id DESC LIMIT 1) AS last_user
    FROM threads t
    JOIN users u ON u.id = t.user_id
    WHERE t.category_id = ?
    ORDER BY t.pinned DESC, t.updated_at DESC
    LIMIT ? OFFSET ?
  `).all(cat.id, pageSize, (page - 1) * pageSize);
  return {
    category: { slug: cat.slug, name: cat.name, description: cat.description },
    threads,
    page,
    pages: Math.max(1, Math.ceil(total / pageSize)),
  };
}

function threadDetail(_req, _res, params) {
  const thread = db.prepare(`
    SELECT t.*, c.slug, c.name AS category, u.username, u.role
    FROM threads t
    JOIN categories c ON c.id = t.category_id
    JOIN users u ON u.id = t.user_id
    WHERE t.id = ?
  `).get(Number(params.id));
  if (!thread) throw new HttpError(404, 'That thread is gone.');
  const posts = db.prepare(`
    SELECT p.id, p.body, p.created_at, u.username, u.role
    FROM posts p JOIN users u ON u.id = p.user_id
    WHERE p.thread_id = ?
    ORDER BY p.id ASC
  `).all(thread.id);
  return {
    thread: {
      id: thread.id,
      title: thread.title,
      pinned: !!thread.pinned,
      locked: !!thread.locked,
      createdAt: thread.created_at,
      category: { slug: thread.slug, name: thread.category },
      author: { username: thread.username, role: thread.role },
    },
    posts: posts.map((post) => ({
      id: post.id,
      body: post.body,
      createdAt: post.created_at,
      user: { username: post.username, role: post.role },
    })),
  };
}

function createThread(_req, _res, _params, user, body) {
  must(user);
  if (!limit(`thread:${user.id}`, 1, 20000)) throw new HttpError(429, 'Wait a moment before opening another thread.');
  const cat = db.prepare('SELECT * FROM categories WHERE slug = ?').get(String(body.slug || ''));
  if (!cat) throw new HttpError(400, 'Pick a board.');
  if (cat.slug === 'announcements' && user.role === 'member') {
    throw new HttpError(403, 'Only staff can post announcements.');
  }
  const title = requireText(body.title, 4, 100, 'Title');
  const text = requireText(body.body, 2, 5000, 'Post');
  const now = Date.now();
  db.exec('BEGIN');
  try {
    const info = db.prepare(
      `INSERT INTO threads (category_id, user_id, title, created_at, updated_at, pinned, locked)
       VALUES (?, ?, ?, ?, ?, 0, 0)`
    ).run(cat.id, user.id, title, now, now);
    const threadId = Number(info.lastInsertRowid);
    db.prepare('INSERT INTO posts (thread_id, user_id, body, created_at) VALUES (?, ?, ?, ?)').run(threadId, user.id, text, now);
    db.exec('COMMIT');
    return { id: threadId };
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
}

function reply(_req, _res, params, user, body) {
  must(user);
  if (!limit(`reply:${user.id}`, 1, 8000)) throw new HttpError(429, 'Wait a moment before posting again.');
  const thread = db.prepare('SELECT * FROM threads WHERE id = ?').get(Number(params.id));
  if (!thread) throw new HttpError(404, 'That thread is gone.');
  if (thread.locked && !isStaff(user)) throw new HttpError(403, 'This thread is locked.');
  const text = requireText(body.body, 1, 5000, 'Reply');
  const now = Date.now();
  const info = db.prepare('INSERT INTO posts (thread_id, user_id, body, created_at) VALUES (?, ?, ?, ?)').run(
    thread.id, user.id, text, now
  );
  db.prepare('UPDATE threads SET updated_at = ? WHERE id = ?').run(now, thread.id);
  return { id: Number(info.lastInsertRowid) };
}

function toggleLock(_req, _res, params, user) {
  must(user, ['staff', 'owner']);
  const thread = db.prepare('SELECT * FROM threads WHERE id = ?').get(Number(params.id));
  if (!thread) throw new HttpError(404, 'That thread is gone.');
  db.prepare('UPDATE threads SET locked = ? WHERE id = ?').run(thread.locked ? 0 : 1, thread.id);
  return { locked: !thread.locked };
}

function togglePin(_req, _res, params, user) {
  must(user, ['staff', 'owner']);
  const thread = db.prepare('SELECT * FROM threads WHERE id = ?').get(Number(params.id));
  if (!thread) throw new HttpError(404, 'That thread is gone.');
  db.prepare('UPDATE threads SET pinned = ? WHERE id = ?').run(thread.pinned ? 0 : 1, thread.id);
  return { pinned: !thread.pinned };
}

function deletePost(_req, _res, params, user) {
  must(user);
  const post = db.prepare('SELECT * FROM posts WHERE id = ?').get(Number(params.id));
  if (!post) throw new HttpError(404, 'That post is gone.');
  const first = db.prepare('SELECT id FROM posts WHERE thread_id = ? ORDER BY id ASC LIMIT 1').get(post.thread_id);
  if (post.id === first.id) throw new HttpError(400, 'Delete the thread instead of the opening post.');
  if (post.user_id !== user.id && !isStaff(user)) throw new HttpError(403, 'You cannot delete that.');
  db.prepare('DELETE FROM posts WHERE id = ?').run(post.id);
  return { ok: true };
}

function deleteThread(_req, _res, params, user) {
  must(user, ['staff', 'owner']);
  const thread = db.prepare('SELECT id FROM threads WHERE id = ?').get(Number(params.id));
  if (!thread) throw new HttpError(404, 'That thread is gone.');
  db.exec('BEGIN');
  try {
    db.prepare('DELETE FROM posts WHERE thread_id = ?').run(thread.id);
    db.prepare('DELETE FROM threads WHERE id = ?').run(thread.id);
    db.exec('COMMIT');
  } catch (err) {
    db.exec('ROLLBACK');
    throw err;
  }
  return { ok: true };
}

function search(req) {
  const url = new URL(req.url, 'http://localhost');
  const q = String(url.searchParams.get('q') || '').trim().slice(0, 60);
  if (q.length < 2) return { results: [] };
  const like = `%${q.replace(/[\\%_]/g, (ch) => `\\${ch}`)}%`;
  const results = db.prepare(`
    SELECT t.id, t.title, t.updated_at, c.name AS category, u.username, u.role
    FROM threads t
    JOIN categories c ON c.id = t.category_id
    JOIN users u ON u.id = t.user_id
    WHERE t.title LIKE ? ESCAPE '\\'
    ORDER BY t.updated_at DESC
    LIMIT 20
  `).all(like);
  return { query: q, results };
}

function members() {
  const users = db.prepare(`
    SELECT u.id, u.username, u.role, u.created_at,
      (SELECT COUNT(*) FROM posts p WHERE p.user_id = u.id) AS posts
    FROM users u
    ORDER BY CASE u.role WHEN 'owner' THEN 0 WHEN 'staff' THEN 1 ELSE 2 END, u.username COLLATE NOCASE
  `).all();
  return { members: users };
}

function profile(_req, _res, params) {
  const user = db.prepare('SELECT * FROM users WHERE username = ?').get(params.username);
  if (!user) throw new HttpError(404, 'No player by that name.');
  const posts = db.prepare('SELECT COUNT(*) AS n FROM posts WHERE user_id = ?').get(user.id).n;
  const recent = db.prepare(`
    SELECT t.id, t.title, t.updated_at
    FROM threads t
    WHERE t.user_id = ?
    ORDER BY t.updated_at DESC
    LIMIT 8
  `).all(user.id);
  return {
    user: { ...publicUser(user), posts },
    recent,
  };
}

function createReport(_req, _res, _params, user, body) {
  must(user);
  if (!limit(`report:${user.id}`, 8, 60 * 60 * 1000)) throw new HttpError(429, 'Too many reports. Wait a bit.');
  const type = body.type === 'admin' ? 'admin' : body.type === 'player' ? 'player' : '';
  if (!type) throw new HttpError(400, 'Pick what you are reporting.');
  const target = requireText(body.target, 2, 32, 'Name');
  const reason = requireText(body.reason, 3, 80, 'Reason');
  const details = requireText(body.details, 8, 2000, 'Details');
  const serverLabel = String(body.server || '').trim().slice(0, 80);
  const info = db.prepare(`
    INSERT INTO reports (type, user_id, target, server_label, reason, details, status, created_at)
    VALUES (?, ?, ?, ?, ?, ?, 'open', ?)
  `).run(type, user.id, target, serverLabel, reason, details, Date.now());
  return { id: Number(info.lastInsertRowid) };
}

function listReports(_req, _res, _params, user) {
  must(user, ['staff', 'owner']);
  const reports = db.prepare(`
    SELECT r.id, r.type, r.target, r.server_label, r.reason, r.details, r.status, r.created_at,
      u.username, u.role
    FROM reports r JOIN users u ON u.id = r.user_id
    ORDER BY CASE r.status WHEN 'open' THEN 0 WHEN 'reviewing' THEN 1 ELSE 2 END, r.created_at DESC
  `).all();
  return { reports };
}

function reportStatus(_req, _res, params, user, body) {
  must(user, ['staff', 'owner']);
  const status = ['open', 'reviewing', 'closed'].includes(body.status) ? body.status : '';
  if (!status) throw new HttpError(400, 'Pick a status.');
  const info = db.prepare('UPDATE reports SET status = ? WHERE id = ?').run(status, Number(params.id));
  if (!info.changes) throw new HttpError(404, 'That report is gone.');
  return { ok: true };
}

function apply(_req, _res, _params, user, body) {
  must(user);
  if (user.role !== 'member') throw new HttpError(400, 'You already have a staff role.');
  const pending = db.prepare(`SELECT id FROM applications WHERE user_id = ? AND status = 'pending'`).get(user.id);
  if (pending) throw new HttpError(400, 'You already have an application waiting.');
  const nick = requireText(body.nick, 2, 32, 'In-game name');
  const experience = requireText(body.experience, 8, 1000, 'Experience');
  const why = requireText(body.why, 8, 1000, 'Reason');
  const availability = requireText(body.availability, 2, 200, 'Availability');
  const info = db.prepare(`
    INSERT INTO applications (user_id, nick, experience, why, availability, status, created_at)
    VALUES (?, ?, ?, ?, ?, 'pending', ?)
  `).run(user.id, nick, experience, why, availability, Date.now());
  return { id: Number(info.lastInsertRowid) };
}

function listApplications(_req, _res, _params, user) {
  must(user, ['staff', 'owner']);
  const applications = db.prepare(`
    SELECT a.id, a.nick, a.experience, a.why, a.availability, a.status, a.created_at,
      u.username, u.role
    FROM applications a JOIN users u ON u.id = a.user_id
    ORDER BY CASE a.status WHEN 'pending' THEN 0 WHEN 'accepted' THEN 1 ELSE 2 END, a.created_at DESC
  `).all();
  return { applications };
}

function reviewApplication(_req, _res, params, user, body) {
  must(user, ['owner']);
  const action = body.action === 'accept' || body.action === 'decline' ? body.action : '';
  if (!action) throw new HttpError(400, 'Pick a decision.');
  const app = db.prepare('SELECT * FROM applications WHERE id = ?').get(Number(params.id));
  if (!app) throw new HttpError(404, 'That application is gone.');
  if (app.status !== 'pending') throw new HttpError(400, 'That application is already decided.');
  const status = action === 'accept' ? 'accepted' : 'declined';
  db.prepare('UPDATE applications SET status = ?, reviewed_at = ? WHERE id = ?').run(status, Date.now(), app.id);
  if (action === 'accept') {
    const applicant = db.prepare('SELECT * FROM users WHERE id = ?').get(app.user_id);
    if (applicant && applicant.role !== 'owner') {
      db.prepare(`UPDATE users SET role = 'staff' WHERE id = ?`).run(applicant.id);
    }
  }
  return { ok: true };
}

function manage(_req, _res, _params, user) {
  must(user, ['owner']);
  return {
    servers: serverRows().map((row) => presentServer(row, true)),
    repos: repoRows().map(presentRepo),
    members: members().members,
  };
}

function parseGithub(input) {
  let raw = String(input || '').trim().replace(/\.git$/i, '').replace(/\/+$/, '');
  if (!raw) return null;
  let pathname = raw;
  if (/^https?:\/\//i.test(raw) || /^github\.com\//i.test(raw)) {
    try {
      const url = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
      if (url.hostname !== 'github.com' && url.hostname !== 'www.github.com') return null;
      pathname = url.pathname;
    } catch {
      return null;
    }
  }
  const parts = pathname.split('/').filter(Boolean);
  if (parts.length < 2) return null;
  const owner = parts[0];
  const name = parts[1];
  if (!/^[A-Za-z0-9][A-Za-z0-9-]{0,38}$/.test(owner)) return null;
  if (!/^[A-Za-z0-9_.-]{1,100}$/.test(name)) return null;
  return { owner, name };
}

async function fetchGithubRepo(owner, name) {
  let response;
  try {
    response = await fetch(`https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(name)}`, {
      headers: {
        'User-Agent': 'Trapstar-Forum',
        Accept: 'application/vnd.github+json',
      },
      signal: AbortSignal.timeout(8000),
    });
  } catch {
    throw new HttpError(502, 'GitHub did not answer. Try that link again in a minute.');
  }
  if (response.status === 404) throw new HttpError(400, 'That GitHub repository is not public.');
  if (!response.ok) throw new HttpError(502, 'GitHub did not answer. Try that link again in a minute.');
  const data = await response.json();
  if (!data || data.private || !data.owner || !data.full_name) {
    throw new HttpError(400, 'That GitHub repository is not public.');
  }
  const url = new URL(data.html_url);
  if (url.hostname !== 'github.com') throw new HttpError(400, 'Paste a github.com link.');
  return {
    owner: data.owner.login,
    name: data.name,
    description: String(data.description || '').slice(0, 300),
    html_url: data.html_url,
    language: data.language || '',
    stars: Number(data.stargazers_count) || 0,
    forks: Number(data.forks_count) || 0,
    pushed_at: data.pushed_at ? Date.parse(data.pushed_at) : null,
  };
}

function repoRows() {
  return db.prepare('SELECT * FROM repositories ORDER BY created_at DESC').all();
}

function presentRepo(row) {
  return {
    id: row.id,
    owner: row.owner,
    name: row.name,
    fullName: `${row.owner}/${row.name}`,
    description: row.description,
    url: row.html_url,
    language: row.language,
    stars: row.stars,
    forks: row.forks,
    pushedAt: row.pushed_at,
    addedAt: row.created_at,
  };
}

async function touchRepos() {
  const stale = db.prepare(`
    SELECT id, owner, name FROM repositories
    WHERE checked_at IS NULL OR checked_at < ?
    ORDER BY checked_at ASC
    LIMIT 1
  `).get(Date.now() - 6 * 60 * 60 * 1000);
  if (!stale) return;
  try {
    const info = await fetchGithubRepo(stale.owner, stale.name);
    db.prepare(`
      UPDATE repositories
      SET owner = ?, name = ?, description = ?, html_url = ?, language = ?, stars = ?, forks = ?, pushed_at = ?, checked_at = ?
      WHERE id = ?
    `).run(info.owner, info.name, info.description, info.html_url, info.language, info.stars, info.forks, info.pushed_at, Date.now(), stale.id);
  } catch {
    db.prepare('UPDATE repositories SET checked_at = ? WHERE id = ?').run(Date.now(), stale.id);
  }
}

async function listRepos() {
  await touchRepos();
  return { repos: repoRows().map(presentRepo) };
}

async function addRepo(_req, _res, _params, user, body) {
  must(user, ['owner']);
  const parsed = parseGithub(body.url);
  if (!parsed) throw new HttpError(400, 'Paste a public link like https://github.com/owner/repo.');
  const info = await fetchGithubRepo(parsed.owner, parsed.name);
  const existing = db.prepare('SELECT id FROM repositories WHERE lower(owner) = lower(?) AND lower(name) = lower(?)').get(info.owner, info.name);
  if (existing) throw new HttpError(400, 'That repository is already listed.');
  const now = Date.now();
  const inserted = db.prepare(`
    INSERT INTO repositories (owner, name, description, html_url, language, stars, forks, pushed_at, checked_at, added_by, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(info.owner, info.name, info.description, info.html_url, info.language, info.stars, info.forks, info.pushed_at, now, user.id, now);
  const row = db.prepare('SELECT * FROM repositories WHERE id = ?').get(Number(inserted.lastInsertRowid));
  return { repo: presentRepo(row) };
}

function removeRepo(_req, _res, params, user) {
  must(user, ['owner']);
  const info = db.prepare('DELETE FROM repositories WHERE id = ?').run(Number(params.id));
  if (!info.changes) throw new HttpError(404, 'That repository is already gone.');
  return { ok: true };
}

async function addServer(_req, _res, _params, user, body) {
  must(user, ['owner']);
  const parsed = parseAddress(body.address);
  if (!parsed) throw new HttpError(400, 'Use an address like 203.0.113.10:27015.');
  const existing = db.prepare('SELECT id FROM servers WHERE host = ? AND port = ?').get(parsed.host, parsed.port);
  if (existing) throw new HttpError(400, 'That server is already listed.');
  const info = db.prepare('INSERT INTO servers (host, port, created_at) VALUES (?, ?, ?)').run(
    parsed.host, parsed.port, Date.now()
  );
  const id = Number(info.lastInsertRowid);
  await refreshOne(id);
  const row = serverRows().find((item) => item.id === id);
  return { server: presentServer(row, true) };
}

function removeServer(_req, _res, params, user) {
  must(user, ['owner']);
  const id = Number(params.id);
  db.prepare('DELETE FROM server_status WHERE server_id = ?').run(id);
  const info = db.prepare('DELETE FROM servers WHERE id = ?').run(id);
  if (!info.changes) throw new HttpError(404, 'That server is already gone.');
  return { ok: true };
}

function addStaff(_req, _res, _params, user, body) {
  must(user, ['owner']);
  const username = String(body.username || '').trim();
  const target = username && db.prepare('SELECT * FROM users WHERE username = ?').get(username);
  if (!target) throw new HttpError(404, 'No player by that name.');
  if (target.role === 'owner') throw new HttpError(400, 'The owner role stays on this account.');
  db.prepare(`UPDATE users SET role = 'staff' WHERE id = ?`).run(target.id);
  return { ok: true };
}

function removeStaff(_req, _res, params, user) {
  must(user, ['owner']);
  const target = db.prepare('SELECT * FROM users WHERE id = ?').get(Number(params.id));
  if (!target) throw new HttpError(404, 'No player by that name.');
  if (target.role === 'owner') throw new HttpError(400, 'The owner role stays on this account.');
  db.prepare(`UPDATE users SET role = 'member' WHERE id = ?`).run(target.id);
  return { ok: true };
}

const routes = [
  ['GET', '/api/meta', () => ({
    discord: DISCORD,
    mailFrom: 'trapstarforum@gmail.com',
    contact: contactEmail(),
    mailConfigured: mailConfigured(),
  })],
  ['GET', '/api/auth/me', (_req, _res, _params, user) => ({ user: user ? sessionUser(user) : null })],
  ['POST', '/api/auth/register', registerStart],
  ['POST', '/api/auth/register/resend', registerResend],
  ['POST', '/api/auth/register/verify', registerVerify],
  ['POST', '/api/auth/login', login],
  ['POST', '/api/auth/logout', logout],
  ['POST', '/api/auth/reset', resetStart],
  ['POST', '/api/auth/reset/confirm', resetConfirm],
  ['GET', '/api/home', home],
  ['GET', '/api/categories/:slug', category],
  ['GET', '/api/threads/:id', threadDetail],
  ['POST', '/api/threads', createThread],
  ['POST', '/api/threads/:id/posts', reply],
  ['POST', '/api/threads/:id/lock', toggleLock],
  ['POST', '/api/threads/:id/pin', togglePin],
  ['DELETE', '/api/posts/:id', deletePost],
  ['DELETE', '/api/threads/:id', deleteThread],
  ['GET', '/api/search', search],
  ['GET', '/api/servers', async () => {
    await touchServers();
    return { servers: serverRows().map((row) => presentServer(row, false)) };
  }],
  ['GET', '/api/chat', listChat],
  ['POST', '/api/chat', postChat],
  ['POST', '/api/servers', addServer],
  ['DELETE', '/api/servers/:id', removeServer],
  ['GET', '/api/members', members],
  ['GET', '/api/users/:username', profile],
  ['POST', '/api/reports', createReport],
  ['GET', '/api/reports', listReports],
  ['POST', '/api/reports/:id/status', reportStatus],
  ['POST', '/api/applications', apply],
  ['GET', '/api/applications', listApplications],
  ['POST', '/api/applications/:id/review', reviewApplication],
  ['GET', '/api/repos', listRepos],
  ['POST', '/api/repos', addRepo],
  ['DELETE', '/api/repos/:id', removeRepo],
  ['GET', '/api/manage', manage],
  ['POST', '/api/staff', addStaff],
  ['DELETE', '/api/staff/:id', removeStaff],
];

function matchPath(routePath, pathname) {
  const left = routePath.split('/').filter(Boolean);
  const right = pathname.split('/').filter(Boolean);
  if (left.length !== right.length) return null;
  const params = {};
  for (let i = 0; i < left.length; i++) {
    if (left[i].startsWith(':')) params[left[i].slice(1)] = decodeURIComponent(right[i]);
    else if (left[i] !== right[i]) return null;
  }
  return params;
}

function contentType(file) {
  const ext = path.extname(file).toLowerCase();
  return {
    '.html': 'text/html; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.js': 'text/javascript; charset=utf-8',
    '.png': 'image/png',
    '.jpg': 'image/jpeg',
    '.jpeg': 'image/jpeg',
    '.svg': 'image/svg+xml',
    '.ico': 'image/x-icon',
    '.webp': 'image/webp',
  }[ext] || 'application/octet-stream';
}

function safeFile(pathname) {
  let rel = pathname.replace(/^\/+/, '');
  if (!rel || rel.includes('\0')) return null;
  const file = path.resolve(publicDir, rel);
  const relTo = path.relative(publicDir, file);
  if (relTo.startsWith('..') || path.isAbsolute(relTo)) return null;
  return file;
}

function sendFile(res, file) {
  const data = fs.readFileSync(file);
  const type = contentType(file);
  res.writeHead(200, {
    'Content-Type': type,
    'Content-Length': data.length,
    'Cache-Control': type.startsWith('image/') ? 'public, max-age=86400' : 'no-store',
    ...securityHeaders(),
  });
  res.end(data);
}

async function handle(req, res) {
  if (String(req.headers.upgrade || '').toLowerCase() === 'websocket') return;
  try {
    const url = new URL(req.url, 'http://localhost');
    const pathname = decodeURIComponent(url.pathname);
    if (pathname.startsWith('/api/')) {
      const found = routes.find((route) => route[0] === req.method && matchPath(route[1], pathname));
      if (!found) return send(res, 404, { error: 'Not found' });
      const params = matchPath(found[1], pathname);
      const user = currentUser(req);
      const body = ['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method) ? await readBody(req) : {};
      const result = await found[2](req, res, params, user, body);
      if (result !== undefined) send(res, 200, result);
      return;
    }
    if (req.method === 'GET') {
      const file = safeFile(pathname);
      if (file && fs.existsSync(file) && fs.statSync(file).isFile()) return sendFile(res, file);
      if (!pathname.includes('.')) return sendFile(res, path.join(publicDir, 'index.html'));
    }
    res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8', ...securityHeaders() });
    res.end('Not found');
  } catch (err) {
    const status = err.status || 500;
    if (status === 500) console.error(err);
    send(res, status, { error: status === 500 ? 'Something went wrong.' : err.message });
  }
}

function sendFrame(socket, opcode, payload) {
  if (!socket || socket.destroyed) return;
  const data = Buffer.isBuffer(payload) ? payload : Buffer.from(payload);
  let header;
  if (data.length < 126) header = Buffer.from([0x80 | opcode, data.length]);
  else if (data.length < 65536) {
    header = Buffer.alloc(4);
    header[0] = 0x80 | opcode;
    header[1] = 126;
    header.writeUInt16BE(data.length, 2);
  } else return;
  socket.write(Buffer.concat([header, data]));
}

function sendText(socket, value) {
  sendFrame(socket, 1, typeof value === 'string' ? value : JSON.stringify(value));
}

function mapMessage(row) {
  return {
    id: row.id,
    body: row.body,
    createdAt: row.created_at,
    user: { id: row.uid, username: row.username, role: row.role },
  };
}

function listChat(req) {
  const url = new URL(req.url, 'http://localhost');
  const after = Number(url.searchParams.get('after') || 0);
  if (!after) return { messages: recentMessages() };
  return {
    messages: db.prepare(`
      SELECT m.id, m.body, m.created_at, u.id AS uid, u.username, u.role
      FROM messages m JOIN users u ON u.id = m.user_id
      WHERE m.id > ?
      ORDER BY m.id ASC
      LIMIT 50
    `).all(after).map(mapMessage),
  };
}

function postChat(_req, _res, _params, user, body) {
  must(user);
  const text = requireText(body.body, 1, 400, 'Message');
  if (!limit(`chat:${user.id}`, 6, 10000)) throw new HttpError(429, 'Slow down a little.');
  const fresh = db.prepare('SELECT * FROM users WHERE id = ?').get(user.id);
  const now = Date.now();
  const info = db.prepare('INSERT INTO messages (user_id, body, created_at) VALUES (?, ?, ?)').run(fresh.id, text, now);
  return {
    message: {
      id: Number(info.lastInsertRowid),
      body: text,
      createdAt: now,
      user: publicUser(fresh),
    },
  };
}

function recentMessages() {
  return db.prepare(`
    SELECT m.id, m.body, m.created_at, u.id AS uid, u.username, u.role
    FROM messages m JOIN users u ON u.id = m.user_id
    ORDER BY m.id DESC LIMIT 80
  `).all().reverse().map(mapMessage);
}

function presencePayload() {
  const byId = new Map();
  let guests = 0;
  for (const client of sockets) {
    if (!client.alive) continue;
    if (client.user) byId.set(client.user.id, { username: client.user.username, role: client.user.role });
    else guests += 1;
  }
  return { type: 'presence', members: byId.size, guests, online: [...byId.values()].slice(0, 40) };
}

function broadcast(payload) {
  const text = JSON.stringify(payload);
  for (const client of sockets) {
    if (client.alive) sendText(client.raw, text);
  }
}

function onClientMessage(client, text) {
  let data;
  try { data = JSON.parse(text); } catch { return; }
  if (!data || data.type !== 'chat') return;
  if (!client.user) {
    sendText(client.raw, { type: 'error', error: 'Sign in to talk.' });
    return;
  }
  const user = db.prepare('SELECT * FROM users WHERE id = ?').get(client.user.id);
  if (!user) return;
  client.user = user;
  let body;
  try { body = requireText(data.body, 1, 400, 'Message'); }
  catch (err) {
    sendText(client.raw, { type: 'error', error: err.message });
    return;
  }
  if (!limit(`chat:${user.id}`, 6, 10000)) {
    sendText(client.raw, { type: 'error', error: 'Slow down a little.' });
    return;
  }
  const now = Date.now();
  const info = db.prepare('INSERT INTO messages (user_id, body, created_at) VALUES (?, ?, ?)').run(user.id, body, now);
  broadcast({
    type: 'message',
    message: { id: Number(info.lastInsertRowid), body, createdAt: now, user: publicUser(user) },
  });
}

function drain(client) {
  while (true) {
    const buf = client.buf;
    if (buf.length < 2) return;
    const opcode = buf[0] & 0x0f;
    const fin = (buf[0] & 0x80) !== 0;
    const masked = (buf[1] & 0x80) !== 0;
    let len = buf[1] & 0x7f;
    let offset = 2;
    if (len === 126) {
      if (buf.length < 4) return;
      len = buf.readUInt16BE(2);
      offset = 4;
    } else if (len === 127) {
      if (buf.length < 10) return;
      const big = buf.readBigUInt64BE(2);
      if (big > 65536n) return client.raw.destroy();
      len = Number(big);
      offset = 10;
    }
    if (len > 65536) return client.raw.destroy();
    const maskLen = masked ? 4 : 0;
    if (buf.length < offset + maskLen + len) return;
    let payload = buf.subarray(offset + maskLen, offset + maskLen + len);
    if (masked) {
      const mask = buf.subarray(offset, offset + 4);
      payload = Buffer.from(payload);
      for (let i = 0; i < payload.length; i++) payload[i] ^= mask[i & 3];
    }
    client.buf = buf.subarray(offset + maskLen + len);
    if (opcode === 8) return client.raw.end();
    if (opcode === 9) {
      sendFrame(client.raw, 0xA, payload);
      continue;
    }
    if (opcode === 10) continue;
    if (opcode === 1) client.frags = [payload];
    else if (opcode === 0) client.frags.push(payload);
    else continue;
    if (fin) {
      const message = Buffer.concat(client.frags).toString('utf8');
      client.frags = [];
      onClientMessage(client, message);
    }
  }
}

function handleUpgrade(req, socket, head) {
  if (req.url !== '/ws') return socket.destroy();
  const key = req.headers['sec-websocket-key'];
  if (!key) return socket.destroy();
  const accept = crypto.createHash('sha1').update(key + WS_MAGIC).digest('base64');
  socket.write(
    'HTTP/1.1 101 Switching Protocols\r\n' +
    'Upgrade: websocket\r\n' +
    'Connection: Upgrade\r\n' +
    `Sec-WebSocket-Accept: ${accept}\r\n\r\n`
  );
  const user = currentUser(req);
  const client = { raw: socket, user, buf: head && head.length ? Buffer.from(head) : Buffer.alloc(0), frags: [], alive: true };
  sockets.add(client);
  sendText(socket, { type: 'hello', user: user ? publicUser(user) : null });
  sendText(socket, { type: 'history', messages: recentMessages() });
  broadcast(presencePayload());
  socket.on('data', (chunk) => {
    client.buf = Buffer.concat([client.buf, chunk]);
    try { drain(client); } catch { socket.destroy(); }
  });
  socket.on('close', () => {
    client.alive = false;
    sockets.delete(client);
    broadcast(presencePayload());
  });
  socket.on('error', () => socket.destroy());
}

async function statusLoop() {
  for (;;) {
    try {
      const ids = db.prepare('SELECT id FROM servers').all().map((row) => row.id);
      for (const id of ids) await refreshOne(id);
    } catch (err) {
      console.error(err);
    }
    await new Promise((resolve) => setTimeout(resolve, 20000));
  }
}

async function entry(req, res) {
  return handle(req, res);
}
entry.handle = handle;
module.exports = entry;

if (require.main === module) {
  const server = http.createServer(handle);
  server.on('upgrade', handleUpgrade);
  const port = Number(process.env.PORT || 3000);
  server.listen(port, '0.0.0.0', () => {
    console.log(`Trapstar forum listening on port ${port}`);
    console.log(mailConfigured()
      ? 'Mail: codes send from trapstarforum@gmail.com'
      : 'Mail: add SMTP settings before signup codes can send');
  });
  statusLoop();
  setInterval(() => {
    const now = Date.now();
    db.prepare('DELETE FROM sessions WHERE expires_at < ?').run(now);
    db.prepare('DELETE FROM pending_signups WHERE expires_at < ?').run(now);
  }, 60 * 60 * 1000).unref();
}
