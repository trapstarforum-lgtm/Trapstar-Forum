module.exports = async (req, res) => {
  try {
    const { handle } = require('../server');
    if (!process.env.PUBLIC_URL) {
      const host = req.headers['x-forwarded-host'] || req.headers.host || 'trapstar-forum.lol';
      const proto = req.headers['x-forwarded-proto'] || 'https';
      process.env.PUBLIC_URL = `${proto}://${host}`;
    }
    let url = req.url || '/';
    if (!url.startsWith('/api')) {
      const parts = [].concat(req.query && req.query.path ? req.query.path : []).filter(Boolean);
      const query = url.includes('?') ? url.slice(url.indexOf('?')) : '';
      url = `/api/${parts.join('/')}${query}`;
    }
    req.url = url;
    await handle(req, res);
  } catch (err) {
    if (!res.headersSent) {
      const message = err && err.message ? err.message : 'The forum could not start.';
      const body = JSON.stringify({ error: message });
      res.writeHead(500, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' });
      res.end(body);
    }
  }
};
