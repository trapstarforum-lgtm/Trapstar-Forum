const dgram = require('dgram');

const INFO_WAIT = 1400;
const PLAYER_WAIT = 1100;

function cleanField(value, max = 96) {
  return String(value || '')
    .replace(/[\u0000-\u001F]/g, '')
    .trim()
    .slice(0, max);
}

function readString(buf, offset) {
  const end = buf.indexOf(0, offset);
  if (end === -1) return { str: '', next: buf.length };
  return { str: buf.toString('utf8', offset, end), next: end + 1 };
}

function headerOf(buf) {
  if (!buf || buf.length < 5) return null;
  const head = buf.readInt32LE(0);
  if (head === -1) return buf;
  return null;
}

function coalesce(buffers) {
  const singles = [];
  const groups = new Map();
  for (const buf of buffers) {
    if (!buf || buf.length < 4) continue;
    const head = buf.readInt32LE(0);
    if (head === -1) {
      singles.push(buf);
      continue;
    }
    if (head !== -2 || buf.length < 10) continue;
    const id = buf.readInt32LE(4);
    const total = buf[8];
    const number = buf[9];
    if (!total || total > 16 || number >= total) continue;
    if (!groups.has(id)) groups.set(id, { total, chunks: new Map() });
    groups.get(id).chunks.set(number, buf.subarray(10));
  }
  if (singles.length) return singles[singles.length - 1];
  for (const group of groups.values()) {
    if (group.chunks.size !== group.total) continue;
    const parts = [];
    let ok = true;
    for (let i = 0; i < group.total; i++) {
      if (!group.chunks.has(i)) ok = false;
      else parts.push(group.chunks.get(i));
    }
    if (!ok) continue;
    const joined = Buffer.concat(parts);
    const single = headerOf(joined);
    if (single) return single;
  }
  return null;
}

function parseInfo(buf) {
  const type = buf[4];
  if (type === 0x49) {
    let o = 6;
    const name = readString(buf, o); o = name.next;
    const map = readString(buf, o); o = map.next;
    const folder = readString(buf, o); o = folder.next;
    const game = readString(buf, o); o = game.next;
    if (o + 4 > buf.length) return null;
    return {
      name: cleanField(name.str),
      map: cleanField(map.str, 64),
      game: cleanField(game.str),
      players: buf[o + 2],
      maxPlayers: buf[o + 3],
    };
  }
  if (type === 0x6d) {
    let o = 5;
    const address = readString(buf, o); o = address.next;
    const name = readString(buf, o); o = name.next;
    const map = readString(buf, o); o = map.next;
    const folder = readString(buf, o); o = folder.next;
    const game = readString(buf, o); o = game.next;
    if (o + 2 > buf.length) return null;
    return {
      name: cleanField(name.str),
      map: cleanField(map.str, 64),
      game: cleanField(game.str),
      players: buf[o],
      maxPlayers: buf[o + 1],
    };
  }
  return null;
}

function parsePlayers(buf) {
  if (!buf || buf[4] !== 0x44) return [];
  const count = buf[5];
  let o = 6;
  const names = [];
  for (let i = 0; i < count && i < 64; i++) {
    if (o >= buf.length) break;
    o += 1;
    const name = readString(buf, o);
    o = name.next;
    if (o + 8 > buf.length) break;
    o += 8;
    const cleaned = cleanField(name.str, 32);
    if (cleaned) names.push(cleaned);
  }
  return names;
}

function a2sInfo(challenge) {
  const base = Buffer.concat([
    Buffer.from([0xff, 0xff, 0xff, 0xff, 0x54]),
    Buffer.from('Source Engine Query\0', 'ascii'),
  ]);
  if (!challenge) return base;
  return Buffer.concat([base, challenge]);
}

function goldsrcDetails() {
  return Buffer.concat([
    Buffer.from([0xff, 0xff, 0xff, 0xff]),
    Buffer.from('details\0', 'ascii'),
  ]);
}

function a2sPlayers(challenge) {
  return Buffer.concat([
    Buffer.from([0xff, 0xff, 0xff, 0xff, 0x55]),
    challenge || Buffer.from([0xff, 0xff, 0xff, 0xff]),
  ]);
}

function udpRound(host, port, packet, waitMs) {
  return new Promise((resolve) => {
    const socket = dgram.createSocket('udp4');
    const got = [];
    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      try { socket.close(); } catch { /* already closed */ }
      resolve(got);
    };
    const timer = setTimeout(finish, waitMs);
    socket.on('error', finish);
    socket.on('message', (msg) => {
      got.push(Buffer.from(msg));
      const joined = coalesce(got);
      if (joined && joined[4] !== undefined) finish();
    });
    try {
      socket.send(packet, port, host, (err) => {
        if (err) finish();
      });
    } catch {
      finish();
    }
  });
}

function challengeFrom(buf) {
  if (!buf || buf[4] !== 0x41 || buf.length < 9) return null;
  return buf.subarray(5, 9);
}

async function queryPlayers(host, port) {
  try {
    const first = coalesce(await udpRound(host, port, a2sPlayers(), PLAYER_WAIT));
    const challenge = challengeFrom(first);
    const buf = challenge
      ? coalesce(await udpRound(host, port, a2sPlayers(challenge), PLAYER_WAIT))
      : first;
    return parsePlayers(buf);
  } catch {
    return [];
  }
}

async function queryServer(host, port) {
  const started = Date.now();
  try {
    let infoBuf = coalesce(await udpRound(host, port, a2sInfo(), INFO_WAIT));
    const challenge = challengeFrom(infoBuf);
    if (challenge) infoBuf = coalesce(await udpRound(host, port, a2sInfo(challenge), INFO_WAIT));
    let info = infoBuf ? parseInfo(infoBuf) : null;
    if (!info || (!info.name && !info.map)) {
      infoBuf = coalesce(await udpRound(host, port, goldsrcDetails(), INFO_WAIT));
      info = infoBuf ? parseInfo(infoBuf) : null;
    }
    if (!info || (!info.name && !info.map)) {
      return { online: false, error: 'No response' };
    }
    const playerNames = await queryPlayers(host, port);
    return {
      online: true,
      name: info.name || 'Counter-Strike server',
      map: info.map || 'unknown',
      game: info.game || 'Counter-Strike',
      players: Number.isFinite(info.players) ? info.players : playerNames.length,
      maxPlayers: Number.isFinite(info.maxPlayers) ? info.maxPlayers : 0,
      playerNames,
      rtt: Date.now() - started,
      error: '',
    };
  } catch (err) {
    const code = err && err.code;
    return {
      online: false,
      error: code === 'ENOTFOUND' ? 'Address not found' : 'No response',
    };
  }
}

module.exports = { queryServer, parseInfo, parsePlayers, coalesce };
