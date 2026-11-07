const { handle } = require('../server');

module.exports = async (req, res) => {
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
};
