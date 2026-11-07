const fs = require('fs');
const path = require('path');
const net = require('net');
const tls = require('tls');
const crypto = require('crypto');

const FROM_DEFAULT = 'Trapstar <trapstarforum@gmail.com>';
const CONTACT_EMAIL = 'staff@trapstar-forum.lol';

function mailConfigured() {
  return Boolean(process.env.SMTP_HOST && String(process.env.SMTP_HOST).trim());
}

function fromHeader() {
  return (process.env.SMTP_FROM || FROM_DEFAULT).trim();
}

function contactEmail() {
  return (process.env.CONTACT_EMAIL || CONTACT_EMAIL).trim();
}

function envelopeAddress(from) {
  const match = from.match(/<([^>]+)>/);
  return (match ? match[1] : from).trim();
}

function wrapBase64(buf) {
  return buf.toString('base64').replace(/.{1,76}/g, '$&\r\n').trim();
}

function dotStuff(text) {
  return text
    .replace(/\r?\n/g, '\r\n')
    .split('\r\n')
    .map((line) => (line.startsWith('.') ? `.${line}` : line))
    .join('\r\n');
}

function buildMessage({ to, subject, text, html, logo }) {
  const from = fromHeader();
  const mixed = `rel_${crypto.randomBytes(8).toString('hex')}`;
  const alt = `alt_${crypto.randomBytes(8).toString('hex')}`;
  const lines = [
    `From: ${from}`,
    `To: ${to}`,
    `Reply-To: ${contactEmail()}`,
    `Subject: ${subject}`,
    `Date: ${new Date().toUTCString()}`,
    `Message-ID: <${crypto.randomBytes(12).toString('hex')}@trapstar-forum.lol>`,
    'MIME-Version: 1.0',
  ];
  if (logo) {
    lines.push(`Content-Type: multipart/related; boundary="${mixed}"`, '', `--${mixed}`);
    lines.push(`Content-Type: multipart/alternative; boundary="${alt}"`, '', `--${alt}`);
  } else {
    lines.push(`Content-Type: multipart/alternative; boundary="${alt}"`, '', `--${alt}`);
  }
  lines.push(
    'Content-Type: text/plain; charset="UTF-8"',
    'Content-Transfer-Encoding: 8bit',
    '',
    text,
    '',
    `--${alt}`,
    'Content-Type: text/html; charset="UTF-8"',
    'Content-Transfer-Encoding: 8bit',
    '',
    html,
    '',
    `--${alt}--`,
    ''
  );
  if (logo) {
    lines.push(
      `--${mixed}`,
      'Content-Type: image/png',
      'Content-Transfer-Encoding: base64',
      'Content-ID: <trapstar-logo>',
      'Content-Disposition: inline; filename="logo.png"',
      '',
      wrapBase64(logo),
      '',
      `--${mixed}--`,
      ''
    );
  }
  return dotStuff(lines.join('\r\n'));
}

function renderEmail({ purpose, code, username, publicUrl }) {
  const reason = purpose === 'reset'
    ? 'Use this code to set a new Trapstar password.'
    : `Use this code to finish creating the Trapstar account${username ? ` for ${username}` : ''}.`;
  const subject = purpose === 'reset' ? 'Reset your Trapstar password' : 'Your Trapstar code';
  const siteLine = publicUrl ? `Enter it at ${publicUrl}` : 'Enter it on the Trapstar site where you asked for it.';
  const text = [
    'TRAPSTAR',
    'CS 1.6 community',
    '',
    reason,
    '',
    `Code: ${code}`,
    '',
    'This code expires in 15 minutes.',
    siteLine,
    '',
    'This code was sent from trapstarforum@gmail.com.',
    'Questions: staff@trapstar-forum.lol',
    'If you did not ask for this, ignore the email. Nobody can enter the account without the code.',
    '',
    'Discord: https://discord.gg/trapstarcommunity',
  ].join('\n');

  const safeUser = username
    ? username.replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]))
    : '';
  const lead = purpose === 'reset'
    ? 'A password reset was requested for this email.'
    : `This code opens the member account${safeUser ? ` <strong style="color:#e7f4ff;">${safeUser}</strong>` : ''}.`;

  const html = `<!DOCTYPE html>
<html lang="en">
<body style="margin:0;padding:0;background:#050910;">
  <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#050910;padding:28px 12px;">
    <tr>
      <td align="center">
        <table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#0b1526;border:1px solid #1d4e86;border-radius:8px;">
          <tr>
            <td style="padding:28px 28px 8px;text-align:center;background:linear-gradient(180deg,#12325c,#0b1526);">
              <img src="cid:trapstar-logo" width="84" height="84" alt="Trapstar" style="display:block;margin:0 auto 8px;border:0;">
              <div style="font-family:Arial Narrow,Impact,sans-serif;font-size:34px;letter-spacing:4px;color:#e7f4ff;line-height:1;">TRAPSTAR</div>
              <div style="font-family:Segoe UI,Arial,sans-serif;font-size:12px;letter-spacing:3px;text-transform:uppercase;color:#7ec8ff;padding-top:4px;">CS 1.6 community</div>
            </td>
          </tr>
          <tr>
            <td style="padding:8px 28px 0;">
              <div style="height:2px;background:linear-gradient(90deg,transparent,#2f9bff,transparent);"></div>
            </td>
          </tr>
          <tr>
            <td style="padding:22px 28px 8px;font-family:Segoe UI,Arial,sans-serif;color:#d5e8f8;font-size:15px;line-height:1.55;">
              ${lead}
              <p style="margin:14px 0 0;">${reason}</p>
            </td>
          </tr>
          <tr>
            <td style="padding:16px 28px;">
              <div style="border:1px solid #2a6cb3;background:#07111e;text-align:center;padding:18px 12px;">
                <div style="font-family:Segoe UI,Arial,sans-serif;font-size:11px;letter-spacing:3px;text-transform:uppercase;color:#8fb7d6;">Verification code</div>
                <div style="font-family:Consolas,Courier New,monospace;font-size:36px;letter-spacing:10px;color:#7fd2ff;font-weight:700;padding-top:8px;">${code}</div>
              </div>
            </td>
          </tr>
          <tr>
            <td style="padding:0 28px 22px;font-family:Segoe UI,Arial,sans-serif;color:#9fb6cc;font-size:13px;line-height:1.5;">
              The code expires in 15 minutes. ${siteLine}
              <br><br>
              This code was sent from trapstarforum@gmail.com.
              Questions go to <a href="mailto:staff@trapstar-forum.lol" style="color:#7fd2ff;text-decoration:none;">staff@trapstar-forum.lol</a>.
              If you did not ask for a code, you can ignore this message.
            </td>
          </tr>
          <tr>
            <td style="padding:14px 28px 22px;background:#08101c;font-family:Segoe UI,Arial,sans-serif;font-size:12px;color:#7f97ad;text-align:center;">
              <a href="https://discord.gg/trapstarcommunity" style="color:#7fd2ff;text-decoration:none;">discord.gg/trapstarcommunity</a>
            </td>
          </tr>
        </table>
      </td>
    </tr>
  </table>
</body>
</html>`;
  return { subject, text, html };
}

function createSession(socket) {
  let buf = '';
  let waiter = null;
  socket.on('data', (chunk) => {
    buf += chunk.toString('utf8');
    if (waiter) waiter();
  });
  function nextReply() {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('Mail server timed out')), 20000);
      const tryParse = () => {
        if (!buf.endsWith('\r\n')) return;
        const lines = buf.split('\r\n').slice(0, -1);
        let endAt = -1;
        for (let i = 0; i < lines.length; i++) {
          if (/^\d{3} /.test(lines[i])) {
            endAt = i;
            break;
          }
        }
        if (endAt === -1) return;
        const used = lines.slice(0, endAt + 1);
        buf = buf.slice(used.join('\r\n').length + 2);
        clearTimeout(timer);
        waiter = null;
        resolve({ code: Number(used[endAt].slice(0, 3)), text: used.join('\n') });
      };
      waiter = tryParse;
      tryParse();
    });
  }
  async function cmd(line) {
    if (line != null) socket.write(`${line}\r\n`);
    return nextReply();
  }
  return { cmd };
}

function expect(reply, codes, step) {
  if (!codes.includes(reply.code)) {
    const err = new Error(`Mail server rejected ${step}`);
    err.publicMessage = 'Could not send the email. Check the Gmail settings for trapstarforum@gmail.com.';
    err.detail = reply.text;
    throw err;
  }
}

async function smtpSend(rawMessage, to) {
  const host = process.env.SMTP_HOST.trim();
  const port = Number(process.env.SMTP_PORT || 587);
  const secure = process.env.SMTP_SECURE === '1' || port === 465;
  const user = process.env.SMTP_USER || '';
  const pass = process.env.SMTP_PASS || '';
  const envelope = envelopeAddress(fromHeader());

  const socket = secure
    ? tls.connect({ host, port, servername: host })
    : net.connect({ host, port });
  let activeSocket = socket;
  let session = createSession(socket);
  await new Promise((resolve, reject) => {
    const ready = () => { socket.off('error', reject); resolve(); };
    socket.once('error', reject);
    socket.once(secure ? 'secureConnect' : 'connect', ready);
  });

  try {
    const greet = await session.cmd(null);
    expect(greet, [220], 'the greeting');
    let ehlo = await session.cmd('EHLO trapstar-forum.lol');
    expect(ehlo, [250], 'EHLO');
    if (!secure && /STARTTLS/i.test(ehlo.text)) {
      const ready = await session.cmd('STARTTLS');
      expect(ready, [220], 'STARTTLS');
      const upgraded = tls.connect({ socket, servername: host });
      await new Promise((resolve, reject) => {
        upgraded.once('secureConnect', resolve);
        upgraded.once('error', reject);
      });
      activeSocket = upgraded;
      session = createSession(activeSocket);
      ehlo = await session.cmd('EHLO trapstar-forum.lol');
      expect(ehlo, [250], 'EHLO');
    }
    if (user) {
      const start = await session.cmd('AUTH LOGIN');
      expect(start, [334], 'AUTH');
      const userReply = await session.cmd(Buffer.from(user).toString('base64'));
      expect(userReply, [334], 'the username');
      const passReply = await session.cmd(Buffer.from(pass).toString('base64'));
      expect(passReply, [235], 'the password');
    }
    expect(await session.cmd(`MAIL FROM:<${envelope}>`), [250], 'MAIL FROM');
    expect(await session.cmd(`RCPT TO:<${to}>`), [250, 251], 'RCPT TO');
    expect(await session.cmd('DATA'), [354], 'DATA');
    activeSocket.write(`${rawMessage}\r\n.\r\n`);
    expect(await session.cmd(null), [250], 'the message body');
    await session.cmd('QUIT').catch(() => {});
  } finally {
    try { activeSocket.end(); } catch { /* ignore */ }
  }
}

async function sendCodeEmail({ root, to, purpose, code, username }) {
  const logoPath = path.join(root, 'public', 'assets', 'logo.png');
  const logo = fs.existsSync(logoPath) ? fs.readFileSync(logoPath) : null;
  const rendered = renderEmail({
    purpose,
    code,
    username,
    publicUrl: process.env.PUBLIC_URL || '',
  });
  const raw = buildMessage({ to, subject: rendered.subject, text: rendered.text, html: rendered.html, logo });

  if (process.env.MAIL_SINK === '1') {
    const dir = path.join(root, 'data', 'mail');
    fs.mkdirSync(dir, { recursive: true });
    const stamp = Date.now();
    fs.writeFileSync(path.join(dir, `${stamp}.html`), rendered.html);
    fs.writeFileSync(path.join(dir, `${stamp}.txt`), rendered.text);
    fs.writeFileSync(path.join(dir, 'latest.html'), rendered.html);
    return;
  }

  if (!mailConfigured()) {
    const err = new Error('SMTP missing');
    err.publicMessage = 'Email cannot be sent yet. Add the Gmail app password for trapstarforum@gmail.com.';
    throw err;
  }

  try {
    await smtpSend(raw, to);
    console.log(`Mail sent to ${to} (${purpose})`);
  } catch (err) {
    if (err.detail) console.error(err.detail);
    if (!err.publicMessage) {
      err.publicMessage = 'Could not send the email. Check the Gmail settings for trapstarforum@gmail.com.';
    }
    throw err;
  }
}

module.exports = { sendCodeEmail, mailConfigured, fromHeader, contactEmail, renderEmail, buildMessage };
