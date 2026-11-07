const state = { me: null, meta: null };
let viewGen = 0;
let pollTimer = 0;
let chatTimer = 0;
let chatSeen = new Set();
let pullChat = null;

const MAPS = {
  de_dust2: 'Long A, short cat, the warmup everyone knows.',
  de_dust: 'The older yard. Tight mid and a loud tunnels fight.',
  de_inferno: 'Banana smoke, apartments, and a long B hold.',
  de_nuke: 'Ramp, hut, and heaven. Sound tells you everything.',
  de_train: 'Ivy, alley, and bombsite trains you can play forever.',
  de_aztec: 'Double doors, bridge, and a water spawn.',
  de_cbble: 'Long courtyard and a B site that punishes greed.',
  de_prodigy: 'Dark halls and a mid that never stays quiet.',
  cs_office: 'Paper, side hall, and a hostage rush.',
  cs_italy: 'Wine, apartments, and a long approach.',
  cs_assault: 'Warehouse front door and a loud garage.',
  cs_militia: 'The house, the barn, and a yard with no cover.',
  cs_siege: 'A classic hostage layout still played on public servers.',
};

const ICONS = {
  member: '<svg viewBox="0 0 24 24" class="role-ico" aria-hidden="true"><path d="M12 3.2 18.5 6v5.2c0 4-2.6 6.8-6.5 8.3-3.9-1.5-6.5-4.3-6.5-8.3V6L12 3.2z" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="12" cy="10" r="1.7" fill="currentColor"/><path d="M8.8 15.4c.7-1.3 1.8-1.9 3.2-1.9s2.5.6 3.2 1.9" fill="none" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/></svg>',
  staff: '<svg viewBox="0 0 24 24" class="role-ico" aria-hidden="true"><path d="M12 2.8 19 6v6.2c0 4.4-2.9 7.4-7 9-4.1-1.6-7-4.6-7-9V6l7-3.2z" fill="none" stroke="currentColor" stroke-width="1.6"/><path d="m12 7.2 1.1 2.8h2.4l-2 1.5.8 2.5L12 12.8 9.7 14l.8-2.5-2-1.5h2.4L12 7.2z" fill="currentColor"/></svg>',
  owner: '<svg viewBox="0 0 24 24" class="role-ico" aria-hidden="true"><path d="M12 2.5v6.2M7.2 4.2 9.4 8.6M16.8 4.2 14.6 8.6M8 8.8h8M12 8.8v9.2M9.2 20.5h5.6" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>',
};

const GEAR = {
  phoenix: '<path d="M48 78c8-28 56-28 64 0 4 16-8 24-32 24S44 94 48 78z" fill="#1a2433"/><path d="M50 74h60l-8 16H58z" fill="#ff5a3c"/><circle cx="68" cy="86" r="3" fill="#9fd4ff"/><circle cx="92" cy="86" r="3" fill="#9fd4ff"/>',
  leet: '<path d="M50 62c2-18 58-18 60 2v40c-8 16-52 16-60 0V62z" fill="#141820"/><rect x="58" y="78" width="44" height="8" rx="2" fill="#ffb020"/><circle cx="70" cy="82" r="2" fill="#111"/><circle cx="90" cy="82" r="2" fill="#111"/>',
  arctic: '<path d="M42 88c2-40 74-46 80 2 2 18-10 28-40 30S40 108 42 88z" fill="#d7f4ff"/><circle cx="80" cy="96" r="16" fill="#102033"/><circle cx="74" cy="96" r="2" fill="#9fd4ff"/><circle cx="86" cy="96" r="2" fill="#9fd4ff"/>',
  guerilla: '<path d="M46 90c4-34 64-36 70 2v28c-10 14-52 14-66 0V90z" fill="#203024"/><path d="M48 78c6-26 58-28 66 0v8H48z" fill="#6f8f4a"/><circle cx="70" cy="98" r="2.4" fill="#d7f4ff"/><circle cx="90" cy="98" r="2.4" fill="#d7f4ff"/>',
  urban: '<path d="M48 70c4-16 60-16 64 2v18H48V70z" fill="#8eb6d0"/><path d="M52 90h56v24c-8 14-40 14-56 0V90z" fill="#1a3148"/><rect x="60" y="78" width="40" height="6" fill="#07111e"/><circle cx="72" cy="104" r="2" fill="#9fd4ff"/><circle cx="90" cy="104" r="2" fill="#9fd4ff"/>',
  gsg9: '<path d="M46 74c6-22 62-24 70 0v16H46V74z" fill="#d5dde8"/><path d="M50 92h60v22c-8 16-44 16-60 0V92z" fill="#243246"/><rect x="58" y="86" width="44" height="10" fill="#3ec5ff" opacity=".8"/><circle cx="80" cy="108" r="3" fill="#111"/>',
  sas: '<path d="M48 72c4-20 60-22 66 0v36c-8 18-50 18-66 0V72z" fill="#101820"/><circle cx="68" cy="96" r="10" fill="#0b0f14" stroke="#3ec5ff" stroke-width="3"/><circle cx="94" cy="96" r="10" fill="#0b0f14" stroke="#3ec5ff" stroke-width="3"/><path d="M78 96h8" stroke="#3ec5ff" stroke-width="3"/>',
  gign: '<path d="M44 70c10-28 64-30 74 0-16 6-58 6-74 0z" fill="#1d4e89"/><path d="M52 78c6-8 50-8 58 2v28c-8 16-42 16-58 0V78z" fill="#20344c"/><circle cx="70" cy="98" r="2.2" fill="#d7f4ff"/><circle cx="90" cy="98" r="2.2" fill="#d7f4ff"/>',
};

const MODELS = [
  { id: 'phoenix', side: 'T', pack: 'Phoenix Connexion', name: 'Terror', accent: '#ff5a3c', text: 'Red bandana, open collar, the skin most publics still call “the Terror model.” Loud on dust and fine when you just want to be seen.' },
  { id: 'leet', side: 'T', pack: 'Elite Crew', name: 'Leet', accent: '#ffb020', text: 'Balaclava and a gold-brown kit. Players pick Leet when they want a thinner head and a look that reads at long range.' },
  { id: 'arctic', side: 'T', pack: 'Arctic Avengers', name: 'Arctic', accent: '#9ee7ff', text: 'White hood, cold camo. On snow maps and dark ones alike, Arctic is the T skin people notice before the rifle.' },
  { id: 'guerilla', side: 'T', pack: 'Guerrilla Warfare', name: 'Guerilla', accent: '#8fbf62', text: 'Cap, vest, jungle cloth. A common pick on militia, aztec, and any server that still rotates the old hostage maps.' },
  { id: 'urban', side: 'CT', pack: 'SEAL Team 6', name: 'Urban', accent: '#8eb6d0', text: 'Blue helmet, city camo. Urban is the default CT look on a lot of Trapstar-style publics.' },
  { id: 'gsg9', side: 'CT', pack: 'GSG-9', name: 'GSG9', accent: '#d5dde8', text: 'Grey kit and a visor. GSG9 shows up on office and siege when players want a clean helmet line.' },
  { id: 'sas', side: 'CT', pack: 'SAS', name: 'SAS', accent: '#3ec5ff', text: 'Gas mask, black gear, the CT model everyone recognizes before the first shot on dust2.' },
  { id: 'gign', side: 'CT', pack: 'GIGN', name: 'GIGN', accent: '#6aa7ff', text: 'Blue beret and a heavier vest. GIGN is the CT skin players use when they want a profile that is not a mask.' },
];

const WEAPONS = ['Knife', 'Glock-18', 'USP', 'Desert Eagle', 'AK-47', 'M4A1', 'AWP', 'HE Grenade'];

function esc(value) {
  return String(value ?? '').replace(/[&<>"']/g, (ch) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[ch]));
}

function rich(text) {
  return esc(text).replace(/https?:\/\/[^\s<]+/g, (url) => (
    `<a href="${url}" target="_blank" rel="noopener noreferrer">${url}</a>`
  ));
}

function ago(ts) {
  const seconds = Math.max(1, Math.round((Date.now() - ts) / 1000));
  const units = [['year', 31536000], ['month', 2592000], ['day', 86400], ['hour', 3600], ['minute', 60]];
  for (const [name, size] of units) {
    if (seconds >= size) {
      const value = Math.floor(seconds / size);
      return `${value} ${name}${value > 1 ? 's' : ''} ago`;
    }
  }
  return 'just now';
}

function roleKey(role) {
  return role === 'owner' || role === 'staff' ? role : 'member';
}

function roleBadge(role) {
  const key = roleKey(role);
  const label = key === 'owner' ? 'Owner' : key === 'staff' ? 'Staff' : 'Member';
  return `<span class="role role-${key}">${ICONS[key]}<span>${label}</span></span>`;
}

function userLink(username, role) {
  return `<a class="user-link" href="/u/${encodeURIComponent(username)}">${roleBadge(role)}<span class="uname">${esc(username)}</span></a>`;
}

function avatar(name) {
  let hash = 0;
  for (const ch of name || '?') hash = (hash * 33 + ch.charCodeAt(0)) >>> 0;
  return `<span class="avatar av-${hash % 8}">${esc((name || '?').slice(0, 1).toUpperCase())}</span>`;
}

function page(key, title, inner) {
  return `<div class="page" data-page="${key}" data-title="${esc(title)}"><div class="wrap">${inner}</div></div>`;
}

function mailNote() {
  if (!state.meta) return '';
  if (state.meta.mailConfigured) {
    return `<p class="help">The code comes from ${esc(state.meta.mailFrom)}. Check spam if it takes a minute. Questions go to ${esc(state.meta.contact)}.</p>`;
  }
  return `<p class="warn">Codes cannot send yet. Add the Gmail app password for ${esc(state.meta.mailFrom)}.</p>`;
}

async function api(url, opts = {}) {
  const init = { method: opts.method || 'GET', credentials: 'same-origin', headers: {} };
  if (opts.body !== undefined) {
    init.headers['Content-Type'] = 'application/json';
    init.body = JSON.stringify(opts.body);
  }
  const res = await fetch(url, init);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || 'Request failed');
  return data;
}

function toast(message) {
  const el = document.createElement('div');
  el.className = 'toast';
  el.textContent = message;
  document.getElementById('toasts').appendChild(el);
  setTimeout(() => el.remove(), 3800);
}

function setError(form, message) {
  const el = form.querySelector('.form-error');
  if (el) el.textContent = message || '';
}

async function withButton(button, label, fn) {
  if (!button) return fn();
  const old = button.textContent;
  button.disabled = true;
  button.textContent = label;
  try { await fn(); }
  finally {
    if (button.isConnected) {
      button.disabled = false;
      button.textContent = old;
    }
  }
}

function closeSocket() {
  pullChat = null;
  if (chatTimer) clearInterval(chatTimer);
  chatTimer = 0;
}

function stopPoll() {
  if (pollTimer) clearInterval(pollTimer);
  pollTimer = 0;
}

function serverCard(server, manage) {
  const title = server.name || (server.checkedAt ? 'No response yet' : 'Checking server');
  const names = server.playerNames || [];
  const extra = names.length
    ? `<ul class="plist">${names.slice(0, 12).map((name) => `<li>${esc(name)}</li>`).join('')}${names.length > 12 ? `<li>+${names.length - 12}</li>` : ''}</ul>`
    : '';
  const blurb = MAPS[(server.map || '').toLowerCase()] || '';
  return `<article class="hud server-card ${server.online ? 'is-on' : 'is-off'}">
    <div class="server-top"><span class="dot ${server.online ? '' : 'off'}"></span><span>${server.online ? 'Online' : 'Offline'}</span>${server.online && server.rtt ? `<span class="ping">${server.rtt} ms</span>` : ''}</div>
    <h3>${esc(title)}</h3>
    <p class="map">${esc(server.map || '—')}${blurb ? `<span>${esc(blurb)}</span>` : ''}</p>
    <div class="score"><b>${server.online ? server.players : '–'}</b><span>/ ${server.maxPlayers || '–'}</span></div>
    <p class="address">${esc(server.address)}</p>
    <button type="button" class="btn btn-ghost" data-act="copy" data-copy="connect ${esc(server.address)}">Copy connect</button>
    ${manage && server.error ? `<p class="help">${esc(server.error)}</p>` : ''}
    ${manage ? `<button type="button" class="btn btn-danger" data-act="remove-server" data-id="${server.id}" data-label="Remove">Remove</button>` : ''}
    ${extra}
  </article>`;
}

function serverGrid(servers, manage) {
  if (!servers.length) {
    const ownerHint = state.me && state.me.role === 'owner'
      ? ' Add one from Manage with ip:port.'
      : '';
    return `<div class="empty hud">No community server is listed yet.${esc(ownerHint)}</div>`;
  }
  return servers.map((server) => serverCard(server, manage)).join('');
}

function repoCard(repo, manage) {
  const bits = [
    repo.language ? esc(repo.language) : '',
    `${repo.stars} stars`,
    `${repo.forks} forks`,
  ].filter(Boolean);
  return `<article class="hud repo-card">
    <p class="map">${esc(repo.owner)}</p>
    <h3>${esc(repo.name)}</h3>
    <p class="desc">${esc(repo.description || 'No description on GitHub.')}</p>
    <p class="repo-stats">${bits.join(' · ')}</p>
    <a class="btn btn-ghost" href="${esc(repo.url)}" target="_blank" rel="noopener">Open on GitHub</a>
    ${manage ? `<button type="button" class="btn btn-danger" data-act="remove-repo" data-id="${repo.id}" data-label="Remove">Remove</button>` : ''}
  </article>`;
}

function repoGrid(repos, manage) {
  if (!repos.length) {
    const ownerHint = state.me && state.me.role === 'owner'
      ? ' Add one from Manage with a github.com link.'
      : '';
    return `<div class="empty hud">No GitHub repository is listed yet.${esc(ownerHint)}</div>`;
  }
  return repos.map((repo) => repoCard(repo, manage)).join('');
}

function navActive(test) {
  return test(location.pathname) ? 'active' : '';
}

function renderShell() {
  const me = state.me;
  const links = [
    ['/', 'Home', (p) => p === '/'],
    ['/forum', 'Forum', (p) => p === '/forum' || p.startsWith('/c/') || p.startsWith('/t/')],
    ['/servers', 'Servers', (p) => p === '/servers'],
    ['/repos', 'Repos', (p) => p === '/repos'],
    ['/models', 'Models', (p) => p === '/models'],
    ['/chat', 'Chat', (p) => p === '/chat'],
    ['/members', 'Members', (p) => p === '/members' || p.startsWith('/u/')],
    ['/rules', 'Rules', (p) => p === '/rules'],
  ];
  const auth = me
    ? `${userLink(me.username, me.role)}<button type="button" class="btn btn-ghost" data-act="logout">Log out</button>`
    : `<a class="btn btn-ghost" href="/login">Log in</a><a class="btn" href="/register">Sign up</a>`;
  const queue = me && (me.role === 'staff' || me.role === 'owner')
    ? `<a class="${navActive((p) => p === '/queue')}" href="/queue">Queue</a>` : '';
  const manage = me && me.role === 'owner'
    ? `<a class="${navActive((p) => p === '/manage')}" href="/manage">Manage</a>` : '';
  document.getElementById('header').innerHTML = `<div class="wrap header-inner">
    <a class="brand" href="/"><img src="/assets/logo.png" alt="Trapstar logo"><span><span class="brand-name">TRAPSTAR</span><span class="brand-sub">CS 1.6</span></span></a>
    <button type="button" class="btn btn-ghost nav-toggle" data-act="nav">Menu</button>
    <nav id="nav">
      ${links.map(([href, label, test]) => `<a class="${navActive(test)}" href="${href}">${label}</a>`).join('')}
      <details class="menu"><summary>Reports</summary><div class="menu-pop">
        <a href="/report/player">Report a player</a>
        <a href="/report/admin">Report an admin</a>
        <a href="/apply">Apply for admin</a>
      </div></details>
      ${queue}${manage}
    </nav>
    <div class="header-actions"><a class="discord" href="${state.meta.discord}" target="_blank" rel="noopener">Discord</a>${auth}</div>
  </div>`;
}

function renderFooter() {
  document.getElementById('footer').innerHTML = `<div class="wrap footer-inner">
    <div class="footer-brand"><img src="/assets/logo.png" alt=""><div><strong>Trapstar</strong><div>CS 1.6 community</div></div></div>
    <div><a href="${state.meta.discord}" target="_blank" rel="noopener">discord.gg/trapstarcommunity</a><p><a href="mailto:${esc(state.meta.contact)}">${esc(state.meta.contact)}</a></p><p>Counter-Strike is a trademark of Valve Corporation. Trapstar is a fan community.</p></div>
  </div>`;
}

async function refreshStatusBar() {
  try {
    const data = await api('/api/servers');
    const bar = document.getElementById('status-bar');
    if (!data.servers.length) {
      bar.hidden = true;
      bar.innerHTML = '';
      return;
    }
    bar.hidden = false;
    bar.innerHTML = data.servers.map((server) => {
      const bits = [server.name || server.address, server.map || 'unknown', server.online ? `${server.players}/${server.maxPlayers}` : 'offline'];
      return `<a class="pill" href="/servers"><span class="dot ${server.online ? '' : 'off'}"></span>${esc(bits.join(' · '))}</a>`;
    }).join('');
  } catch { /* keep the last strip */ }
}

async function refreshServerGrid() {
  const grid = document.getElementById('server-grid');
  if (!grid) return;
  const data = await api('/api/servers');
  grid.innerHTML = serverGrid(data.servers, false);
}

function portrait(model) {
  return `<svg viewBox="0 0 160 190" class="portrait" aria-hidden="true">
    <defs><linearGradient id="g-${model.id}" x1="0" y1="0" x2="1" y2="1"><stop offset="0" stop-color="${model.accent}"/><stop offset="1" stop-color="#07111e"/></linearGradient></defs>
    <path d="M80 8 142 36v64c0 46-62 80-62 80s-62-34-62-80V36L80 8z" fill="#07111e" stroke="url(#g-${model.id})" stroke-width="3"/>
    ${GEAR[model.id]}
  </svg>`;
}

async function renderHome() {
  const data = await api('/api/home');
  const latest = data.latest.length ? data.latest.map((thread) => `
    <div class="thread-row"><div><a class="title" href="/t/${thread.id}">${esc(thread.title)}</a><div class="row-meta"><span class="tag">${esc(thread.category)}</span>${userLink(thread.username, thread.role)}</div></div><span class="muted">${ago(thread.updated_at)}</span></div>
  `).join('') : '<div class="empty">The board is quiet.</div>';
  return `<div data-page="home" data-title="Trapstar">
    <section class="hero"><img src="/assets/banner.jpg" alt="Trapstar banner, CS 1.6 community"></section>
    <div class="wrap">
      <div class="hero-actions">
        <a class="btn" href="${state.meta.discord}" target="_blank" rel="noopener">Join Discord</a>
        <a class="btn btn-ghost" href="/servers">Servers</a>
        <a class="btn btn-ghost" href="/forum">Forum</a>
      </div>
      <div class="grid-stats">
        <div class="stat"><b>${data.stats.members}</b><span>Members</span></div>
        <div class="stat"><b>${data.stats.threads}</b><span>Threads</span></div>
        <div class="stat"><b>${data.stats.posts}</b><span>Posts</span></div>
        <div class="stat"><b>${data.stats.servers}</b><span>Servers</span></div>
        <div class="stat"><b>${data.stats.repos}</b><span>Repos</span></div>
      </div>
      <div class="section-head"><h2>Live servers</h2><a href="/servers">All servers</a></div>
      <div id="server-grid" class="grid-servers">${serverGrid(data.servers, false)}</div>
      <div class="section-head"><h2>GitHub</h2><a href="/repos">All repos</a></div>
      <div class="grid-repos">${repoGrid(data.repos || [], false)}</div>
      <div class="grid-2 mt-lg">
        <section class="panel"><div class="section-head"><h2>Latest</h2><a href="/forum">Boards</a></div>${latest}</section>
        <section>
          <div class="panel"><p class="kicker">Discord</p><h2>Trapstar Community</h2><p class="lede">Mixes, server talk, and the people you just played with.</p><a class="btn" href="${state.meta.discord}" target="_blank" rel="noopener">discord.gg/trapstarcommunity</a></div>
          <div class="panel stack"><p class="kicker">Roles</p>
            <p>${roleBadge('member')} Every new account.</p>
            <p>${roleBadge('staff')} Added by the owner. Reads reports and applications.</p>
            <p>${roleBadge('owner')} Manages staff, servers, and GitHub repos.</p>
          </div>
        </section>
      </div>
      <div class="section-head"><h2>CS 1.6 models</h2><a href="/models">Full roster</a></div>
      <div class="grid-models">${MODELS.slice(0, 4).map((model) => `<a class="hud model-card" href="/models"><div class="tag ${model.side === 'T' ? 'side-t' : 'side-ct'}">${model.side}</div>${portrait(model)}<strong>${esc(model.name)}</strong><div class="muted">${esc(model.pack)}</div></a>`).join('')}</div>
    </div>
  </div>`;
}

async function renderForum() {
  const params = new URLSearchParams(location.search);
  const q = params.get('q') || '';
  const data = await api('/api/home');
  let results = '';
  if (q.trim().length >= 2) {
    const found = await api(`/api/search?q=${encodeURIComponent(q.trim())}`);
    results = found.results.length
      ? found.results.map((thread) => `<div class="thread-row"><div><a class="title" href="/t/${thread.id}">${esc(thread.title)}</a><div class="row-meta"><span class="tag">${esc(thread.category)}</span>${userLink(thread.username, thread.role)}</div></div></div>`).join('')
      : '<div class="empty">No threads with that title.</div>';
  }
  const boards = data.categories.map((cat) => `
    <a class="thread-row" href="/c/${cat.slug}"><div><strong class="title">${esc(cat.name)}</strong><div class="muted">${esc(cat.description)}</div></div><span class="muted">${cat.threads} threads</span></a>
  `).join('');
  return page('forum', 'Forum', `
    <p class="kicker">Board</p><h1>Forum</h1>
    <form class="form my" data-form="search"><div class="field"><input name="q" value="${esc(q)}" placeholder="Search thread titles" aria-label="Search thread titles"></div></form>
    ${results ? `<div class="panel mb">${results}</div>` : ''}
    <div>${boards}</div>
  `);
}

async function renderCategory(slug) {
  const params = new URLSearchParams(location.search);
  const pageNo = params.get('page') || '1';
  const data = await api(`/api/categories/${slug}?page=${pageNo}`);
  const canPost = state.me && (data.category.slug !== 'announcements' || state.me.role !== 'member');
  const rows = data.threads.length ? data.threads.map((thread) => `
    <div class="thread-row"><div>${thread.pinned ? '<span class="tag">Pinned</span> ' : ''}${thread.locked ? '<span class="tag">Locked</span> ' : ''}<a class="title" href="/t/${thread.id}">${esc(thread.title)}</a><div class="row-meta">${userLink(thread.username, thread.role)}<span class="muted">${Math.max(0, thread.posts - 1)} replies</span></div></div><span class="muted">${ago(thread.updated_at)}</span></div>
  `).join('') : '<div class="empty">No threads on this board yet.</div>';
  const composer = canPost ? `<form class="form panel mt" data-form="thread"><h2>New thread</h2><input type="hidden" name="slug" value="${esc(slug)}"><label class="field"><span>Title</span><input name="title" maxlength="100" required></label><label class="field"><span>Post</span><textarea name="body" maxlength="5000" required></textarea></label><p class="form-error"></p><button class="btn" type="submit">Post thread</button></form>` : (state.me ? '' : '<p class="help">Sign in to start a thread.</p>');
  const pager = `<div class="pager">${data.page > 1 ? `<a href="/c/${slug}?page=${data.page - 1}">Newer</a>` : '<span></span>'}<span class="muted">Page ${data.page} / ${data.pages}</span>${data.page < data.pages ? `<a href="/c/${slug}?page=${data.page + 1}">Older</a>` : '<span></span>'}</div>`;
  return page('category', data.category.name, `<p class="kicker">Board</p><h1>${esc(data.category.name)}</h1><p class="lede">${esc(data.category.description)}</p><div class="mt">${rows}</div>${pager}${composer}`);
}

async function renderThread(id) {
  const data = await api(`/api/threads/${id}`);
  const staff = state.me && (state.me.role === 'staff' || state.me.role === 'owner');
  const posts = data.posts.map((post, index) => {
    const ownReply = state.me && index > 0 && post.user.username === state.me.username;
    const remove = ownReply || (staff && index > 0)
      ? `<button type="button" class="btn btn-danger" data-act="delete-post" data-id="${post.id}" data-label="Delete">Delete</button>` : '';
    return `<article class="post"><div class="post-head"><div class="chat-row">${avatar(post.user.username)}<div>${userLink(post.user.username, post.user.role)}<div class="muted">${ago(post.createdAt)}</div></div></div>${remove}</div><div class="prose">${rich(post.body)}</div></article>`;
  }).join('');
  const tools = staff ? `<div class="inline-actions my">
    <button type="button" class="btn btn-ghost" data-act="lock" data-id="${data.thread.id}">${data.thread.locked ? 'Unlock' : 'Lock'}</button>
    <button type="button" class="btn btn-ghost" data-act="pin" data-id="${data.thread.id}">${data.thread.pinned ? 'Unpin' : 'Pin'}</button>
    <button type="button" class="btn btn-danger" data-act="delete-thread" data-id="${data.thread.id}" data-label="Delete thread">Delete thread</button>
  </div>` : '';
  const reply = !state.me
    ? '<p class="help">Sign in to reply.</p>'
    : (data.thread.locked && !staff)
      ? '<p class="help">This thread is locked.</p>'
      : `<form class="form panel" data-form="reply"><input type="hidden" name="id" value="${data.thread.id}"><label class="field"><span>Reply</span><textarea name="body" maxlength="5000" required></textarea></label><p class="form-error"></p><button class="btn" type="submit">Reply</button></form>`;
  return page('thread', data.thread.title, `
    <p class="kicker"><a href="/c/${data.thread.category.slug}">${esc(data.thread.category.name)}</a></p>
    <h1>${esc(data.thread.title)}</h1>
    ${tools}
    <div class="stack mt-sm">${posts}</div>
    <div class="mt">${reply}</div>
  `);
}

async function renderRepos() {
  const data = await api('/api/repos');
  return page('repos', 'Repos', `<p class="kicker">GitHub</p><h1>Repositories</h1><p class="lede">Public GitHub projects for this community. The owner adds a link and the name, description, and stars come from GitHub.</p><div class="grid-repos mt">${repoGrid(data.repos, false)}</div>`);
}

async function renderServers() {
  const data = await api('/api/servers');
  return page('servers', 'Servers', `<p class="kicker">Status</p><h1>Servers</h1><p class="lede">Name, map, and players update from the CS 1.6 query port. Copy the connect line into your console.</p><div id="server-grid" class="grid-servers mt">${serverGrid(data.servers, false)}</div>`);
}

function renderModels() {
  const cards = MODELS.map((model) => `
    <button type="button" class="hud model-card ${model.id === 'sas' ? 'selected' : ''}" data-act="model" data-id="${model.id}">
      <div class="tag ${model.side === 'T' ? 'side-t' : 'side-ct'}">${model.side}</div>
      ${portrait(model)}
      <strong>${esc(model.name)}</strong>
      <div class="muted">${esc(model.pack)}</div>
    </button>`).join('');
  const dossiers = MODELS.map((model) => `
    <article class="panel dossier" data-id="${model.id}" ${model.id === 'sas' ? '' : 'hidden'}>
      ${portrait(model)}
      <div><p class="tag ${model.side === 'T' ? 'side-t' : 'side-ct'}">${model.side === 'T' ? 'Terrorist' : 'Counter-terrorist'}</p><h2>${esc(model.pack)}</h2><p class="lede">${esc(model.text)}</p><p class="muted">In-game model: ${esc(model.name)}</p></div>
    </article>`).join('');
  const weapons = WEAPONS.map((name) => `<div class="hud weapon"><b>${esc(name)}</b><span class="muted">CS 1.6</span></div>`).join('');
  return page('models', 'Models', `<p class="kicker">Roster</p><h1>CS 1.6 models</h1><p class="lede">The eight player packs from classic Counter-Strike. Pick one to read where it shows up on a public server.</p><div class="grid-models my">${cards}</div>${dossiers}<div class="section-head"><h2>Buy menu</h2></div><div class="weapon-grid">${weapons}</div>`);
}

function renderChat() {
  const form = state.me
    ? `<form class="chat-form" data-form="chat"><input name="body" maxlength="400" placeholder="Talk to Trapstar" autocomplete="off" required><button class="btn" type="submit">Send</button></form>`
    : '<p class="help">Sign in to talk. You can still read the room.</p>';
  return page('chat', 'Chat', `<p class="kicker">Live</p><h1>Chat</h1><div class="panel chat-shell mt-sm"><div class="chat-top"><span id="presence" class="presence">Connecting…</span></div><div id="chat-log" class="chat-log"></div>${form}</div>`);
}

function bindChat() {
  chatSeen = new Set();
  let after = 0;
  const log = document.getElementById('chat-log');
  const presence = document.getElementById('presence');
  const push = (message) => {
    if (!message || chatSeen.has(message.id)) return;
    chatSeen.add(message.id);
    after = Math.max(after, message.id);
    const row = document.createElement('div');
    row.className = 'chat-row';
    row.innerHTML = `${avatar(message.user.username)}<div>${userLink(message.user.username, message.user.role)} <span class="muted">${ago(message.createdAt)}</span><div class="prose">${rich(message.body)}</div></div>`;
    log.appendChild(row);
    log.scrollTop = log.scrollHeight;
  };
  pullChat = async () => {
    try {
      const data = await api(`/api/chat?after=${after}`);
      data.messages.forEach(push);
      if (presence) presence.textContent = 'Live chat';
    } catch {
      if (presence) presence.textContent = 'Chat reconnecting…';
    }
  };
  pullChat();
  chatTimer = setInterval(() => { if (pullChat) pullChat(); }, 2000);
}

async function renderMembers() {
  const data = await api('/api/members');
  const rows = data.members.map((member) => `
    <div class="member-row"><div>${userLink(member.username, member.role)}</div><span class="muted">${member.posts} posts · joined ${ago(member.created_at)}</span></div>
  `).join('');
  return page('members', 'Members', `<p class="kicker">Roster</p><h1>Members</h1><div class="grid-3 my"><div class="panel">${roleBadge('member')}<p>New accounts.</p></div><div class="panel">${roleBadge('staff')}<p>Reports and the queue.</p></div><div class="panel">${roleBadge('owner')}<p>Staff, servers, and GitHub repos.</p></div></div>${rows}`);
}

async function renderProfile(username) {
  const data = await api(`/api/users/${encodeURIComponent(username)}`);
  const recent = data.recent.length
    ? data.recent.map((thread) => `<div class="thread-row"><a class="title" href="/t/${thread.id}">${esc(thread.title)}</a><span class="muted">${ago(thread.updated_at)}</span></div>`).join('')
    : '<div class="empty">No threads yet.</div>';
  return page('profile', data.user.username, `<p class="kicker">Player</p><h1>${esc(data.user.username)}</h1><p>${roleBadge(data.user.role)}</p><p class="muted">${data.user.posts} posts · joined ${ago(data.user.createdAt)}</p><div class="section-head"><h2>Threads</h2></div>${recent}`);
}

function renderRules() {
  return page('rules', 'Rules', `<p class="kicker">House rules</p><h1>Play it straight</h1><div class="panel"><ul class="rules">
    <li>No cheats, no scripts that play the round for you, no bug abuse the server has already called out.</li>
    <li>No spam, ads, or dumping someone else’s personal info.</li>
    <li>Staff calls on a live server stand. If you disagree, file a report here instead of arguing in all-chat.</li>
    <li>Slurs and harassment get a report, then a decision from staff.</li>
    <li>Applications are for people who already play here. The owner is the one who grants Staff.</li>
  </ul></div>`);
}

function renderLogin() {
  return page('login', 'Log in', `<div class="panel auth-card"><p class="kicker">Account</p><h1>Log in</h1><form class="form" data-form="login"><label class="field"><span>Email or name</span><input name="identifier" autocomplete="username" required></label><label class="field"><span>Password</span><input name="password" type="password" autocomplete="current-password" required></label><p class="form-error"></p><button class="btn" type="submit">Log in</button></form><p class="help"><a href="/reset">Forgot password</a> · <a href="/register">Create an account</a></p></div>`);
}

function renderRegister() {
  return page('register', 'Sign up', `<div class="panel auth-card" id="auth-card"><p class="kicker">Account</p><h1>Sign up</h1>${mailNote()}<form class="form" data-form="register"><label class="field"><span>Name</span><input name="username" minlength="3" maxlength="16" required></label><label class="field"><span>Email</span><input name="email" type="email" autocomplete="email" required></label><label class="field"><span>Password</span><input name="password" type="password" minlength="8" autocomplete="new-password" required></label><label class="field"><span>Confirm password</span><input name="confirm" type="password" minlength="8" required></label><label class="check"><input name="age" type="checkbox" required> I am 13 or older</label><p class="form-error"></p><button class="btn" type="submit">Email me a code</button></form></div>`);
}

function renderReset() {
  return page('reset', 'Reset password', `<div class="panel auth-card" id="auth-card"><p class="kicker">Account</p><h1>Reset password</h1>${mailNote()}<p class="help">Use the same login as everyone else. The code arrives from trapstarforum@gmail.com.</p><form class="form" data-form="reset"><label class="field"><span>Email</span><input name="email" type="email" required></label><p class="form-error"></p><button class="btn" type="submit">Send code</button></form></div>`);
}

function reportForm(kind) {
  const title = kind === 'admin' ? 'Report an admin' : 'Report a player';
  const who = kind === 'admin' ? 'Admin name' : 'Player name';
  if (!state.me) return page('report', title, `<div class="panel"><h1>${title}</h1><p>Sign in to file this.</p><a class="btn" href="/login">Log in</a></div>`);
  return page('report', title, `<div class="panel auth-card"><p class="kicker">Queue</p><h1>${title}</h1><form class="form" data-form="report"><input type="hidden" name="type" value="${kind}"><label class="field"><span>${who}</span><input name="target" maxlength="32" required></label><label class="field"><span>Server</span><input name="server" maxlength="80" placeholder="Optional, ip:port or server name"></label><label class="field"><span>Reason</span><input name="reason" maxlength="80" required></label><label class="field"><span>What happened</span><textarea name="details" maxlength="2000" required></textarea></label><p class="form-error"></p><button class="btn" type="submit">Send report</button></form></div>`);
}

function renderApply() {
  if (!state.me) return page('apply', 'Apply for admin', `<div class="panel"><h1>Apply for admin</h1><p>Sign in first. Accepted players get the Staff icon.</p><a class="btn" href="/login">Log in</a></div>`);
  return page('apply', 'Apply for admin', `<div class="panel auth-card"><p class="kicker">Staff</p><h1>Apply for admin</h1><p class="help">The owner reads this and can grant the Staff role. New accounts stay Members until then.</p><form class="form" data-form="apply"><label class="field"><span>In-game name</span><input name="nick" maxlength="32" required></label><label class="field"><span>Where you play and for how long</span><textarea name="experience" maxlength="1000" required></textarea></label><label class="field"><span>Why you want it</span><textarea name="why" maxlength="1000" required></textarea></label><label class="field"><span>When you are around</span><input name="availability" maxlength="200" required></label><p class="form-error"></p><button class="btn" type="submit">Send application</button></form></div>`);
}

async function renderQueue() {
  if (!state.me || (state.me.role !== 'staff' && state.me.role !== 'owner')) {
    return page('queue', 'Queue', '<div class="empty">Staff handle the queue.</div>');
  }
  const [reports, applications] = await Promise.all([api('/api/reports'), api('/api/applications')]);
  const reportCards = reports.reports.length ? reports.reports.map((report) => `
    <article class="queue-card"><div class="row-meta"><span class="tag">${report.type === 'admin' ? 'Admin report' : 'Player report'}</span><span class="tag">${esc(report.status)}</span></div><h3>${esc(report.target)}</h3><p>${esc(report.reason)}</p><p class="prose">${rich(report.details)}</p><p class="muted">${report.server_label ? esc(report.server_label) + ' · ' : ''}by ${userLink(report.username, report.role)} · ${ago(report.created_at)}</p>
    <form class="form" data-form="report-status"><input type="hidden" name="id" value="${report.id}"><label class="field"><span>Status</span><select name="status">${['open', 'reviewing', 'closed'].map((status) => `<option ${status === report.status ? 'selected' : ''}>${status}</option>`).join('')}</select></label><button class="btn btn-ghost" type="submit">Update</button></form></article>
  `).join('') : '<div class="empty">No reports.</div>';
  const apps = applications.applications.length ? applications.applications.map((app) => `
    <article class="queue-card"><div class="row-meta"><span class="tag">${esc(app.status)}</span>${userLink(app.username, app.role)}</div><h3>${esc(app.nick)}</h3><p class="prose">${rich(app.experience)}</p><p class="prose">${rich(app.why)}</p><p class="muted">${esc(app.availability)} · ${ago(app.created_at)}</p>
    ${state.me.role === 'owner' && app.status === 'pending' ? `<div class="inline-actions"><button type="button" class="btn" data-act="accept-app" data-id="${app.id}">Accept as staff</button><button type="button" class="btn btn-danger" data-act="decline-app" data-id="${app.id}">Decline</button></div>` : ''}
    </article>
  `).join('') : '<div class="empty">No applications.</div>';
  return page('queue', 'Queue', `<p class="kicker">Staff</p><h1>Queue</h1><div class="section-head"><h2>Reports</h2></div>${reportCards}<div class="section-head"><h2>Admin applications</h2></div>${apps}`);
}

async function renderManage() {
  if (!state.me || state.me.role !== 'owner') return page('manage', 'Manage', '<div class="empty">Only the owner can manage staff, servers, and repositories.</div>');
  const data = await api('/api/manage');
  const people = data.members.map((member) => {
    let action = '';
    if (member.role === 'member') action = `<button type="button" class="btn" data-act="make-staff" data-username="${esc(member.username)}">Make staff</button>`;
    if (member.role === 'staff') action = `<button type="button" class="btn btn-danger" data-act="remove-staff" data-id="${member.id}" data-label="Remove staff">Remove staff</button>`;
    if (member.role === 'owner') action = '<span class="muted">Owner</span>';
    return `<div class="member-row" data-member="${esc(member.username.toLowerCase())}"><div>${userLink(member.username, member.role)}</div>${action}</div>`;
  }).join('');
  return page('manage', 'Manage', `
    <p class="kicker">Owner</p><h1>Manage</h1>
    <div class="grid-2 mt">
      <section class="panel"><h2>CS 1.6 servers</h2><p class="help">Type ip:port. Everyone will see the name, map, and players.</p>
        <form class="form" data-form="server"><label class="field"><span>Address</span><input name="address" placeholder="203.0.113.10:27015" required></label><p class="form-error"></p><button class="btn" type="submit">Add server</button></form>
        <div id="manage-servers" class="grid-servers mt-sm">${serverGrid(data.servers, true)}</div>
      </section>
      <section class="panel"><h2>Staff</h2><p class="help">Members stay Members until you promote them. Applications also sit in the queue.</p>
        <form class="form" data-form="staff"><label class="field"><span>Player name</span><input name="username" required></label><p class="form-error"></p><button class="btn" type="submit">Make staff</button></form>
        <label class="field mt-sm"><span>Find</span><input id="member-filter" placeholder="Filter names"></label>
        <div id="member-list" class="mt-sm">${people}</div>
      </section>
    </div>
    <section class="panel mt">
      <h2>GitHub repositories</h2>
      <p class="help">Paste a public github.com/owner/repo link. Everyone sees the name, description, and stars.</p>
      <form class="form" data-form="repo"><label class="field"><span>Repository</span><input name="url" placeholder="https://github.com/alliedmodders/amxmodx" required></label><p class="form-error"></p><button class="btn" type="submit">Add repository</button></form>
      <div class="grid-repos mt-sm">${repoGrid(data.repos || [], true)}</div>
    </section>
  `);
}

function bindManage() {
  const input = document.getElementById('member-filter');
  if (!input) return;
  input.addEventListener('input', () => {
    const q = input.value.trim().toLowerCase();
    document.querySelectorAll('[data-member]').forEach((row) => {
      row.hidden = Boolean(q) && !row.dataset.member.includes(q);
    });
  });
}

function renderMissing() {
  return page('missing', 'Not found', '<div class="empty">That page is not on the board.</div>');
}

async function renderRoute() {
  closeSocket();
  stopPoll();
  const gen = ++viewGen;
  const path = location.pathname;
  const view = document.getElementById('view');
  try {
    let html = '';
    const cat = path.match(/^\/c\/([a-z0-9-]+)$/);
    const thread = path.match(/^\/t\/(\d+)$/);
    const profile = path.match(/^\/u\/([A-Za-z0-9_]+)$/);
    if (path === '/') html = await renderHome();
    else if (path === '/forum') html = await renderForum();
    else if (cat) html = await renderCategory(cat[1]);
    else if (thread) html = await renderThread(thread[1]);
    else if (path === '/servers') html = await renderServers();
    else if (path === '/repos') html = await renderRepos();
    else if (path === '/models') html = renderModels();
    else if (path === '/chat') html = renderChat();
    else if (path === '/members') html = await renderMembers();
    else if (profile) html = await renderProfile(profile[1]);
    else if (path === '/rules') html = renderRules();
    else if (path === '/login') html = renderLogin();
    else if (path === '/register') html = renderRegister();
    else if (path === '/reset') html = renderReset();
    else if (path === '/report/player') html = reportForm('player');
    else if (path === '/report/admin') html = reportForm('admin');
    else if (path === '/apply') html = renderApply();
    else if (path === '/queue') html = await renderQueue();
    else if (path === '/manage') html = await renderManage();
    else html = renderMissing();
    if (gen !== viewGen) return;
    view.innerHTML = html;
    const title = view.querySelector('[data-title]')?.getAttribute('data-title') || 'Trapstar';
    document.title = title === 'Trapstar' ? 'Trapstar — CS 1.6' : `${title} — Trapstar`;
    const pageName = view.querySelector('[data-page]')?.dataset.page;
    if (pageName === 'chat') bindChat();
    if (pageName === 'manage') bindManage();
    if (document.getElementById('server-grid')) {
      pollTimer = setInterval(() => { refreshServerGrid().catch(() => {}); }, 15000);
    }
  } catch (err) {
    if (gen !== viewGen) return;
    view.innerHTML = page('error', 'Trapstar', `<div class="empty">${esc(err.message)}</div>`);
  }
}

async function navigate(url, replace) {
  document.querySelectorAll('details[open]').forEach((el) => { el.open = false; });
  const nav = document.getElementById('nav');
  if (nav) nav.classList.remove('open');
  if (replace) history.replaceState({}, '', url);
  else if (url !== location.pathname + location.search) history.pushState({}, '', url);
  state.me = (await api('/api/auth/me')).user;
  renderShell();
  await renderRoute();
}

function signedIn(user, message) {
  state.me = user;
  toast(message);
  renderShell();
  navigate('/');
}

const forms = {
  async search(form) {
    const q = form.q.value.trim();
    navigate(q ? `/forum?q=${encodeURIComponent(q)}` : '/forum');
  },
  async login(form) {
    setError(form, '');
    await withButton(form.querySelector('button'), 'Signing in…', async () => {
      try {
        const data = await api('/api/auth/login', { method: 'POST', body: { identifier: form.identifier.value.trim(), password: form.password.value } });
        signedIn(data.user, 'Signed in.');
      } catch (err) { setError(form, err.message); }
    });
  },
  async register(form) {
    setError(form, '');
    if (form.password.value !== form.confirm.value) return setError(form, 'Passwords do not match.');
    await withButton(form.querySelector('button'), 'Sending code…', async () => {
      try {
        const email = form.email.value.trim();
        await api('/api/auth/register', { method: 'POST', body: { username: form.username.value.trim(), email, password: form.password.value, older: form.age.checked } });
        document.getElementById('auth-card').innerHTML = `<p class="kicker">Account</p><h1>Enter the code</h1><p class="help">We sent a 6-digit code to ${esc(email)} from trapstarforum@gmail.com.</p><form class="form" data-form="register-verify"><input type="hidden" name="email" value="${esc(email)}"><label class="field"><span>Code</span><input class="pin" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" required></label><p class="form-error"></p><button class="btn" type="submit">Create account</button></form><button type="button" class="btn btn-ghost" data-act="resend" data-email="${esc(email)}">Send a new code</button>`;
      } catch (err) { setError(form, err.message); }
    });
  },
  async 'register-verify'(form) {
    setError(form, '');
    await withButton(form.querySelector('button'), 'Checking…', async () => {
      try {
        const data = await api('/api/auth/register/verify', { method: 'POST', body: { email: form.email.value, code: form.code.value } });
        signedIn(data.user, 'Welcome to Trapstar.');
      } catch (err) { setError(form, err.message); }
    });
  },
  async reset(form) {
    setError(form, '');
    await withButton(form.querySelector('button'), 'Sending…', async () => {
      try {
        const email = form.email.value.trim();
        await api('/api/auth/reset', { method: 'POST', body: { email } });
        document.getElementById('auth-card').innerHTML = `<p class="kicker">Account</p><h1>Set a new password</h1><p class="help">If ${esc(email)} has an account, the code is in that inbox from trapstarforum@gmail.com.</p><form class="form" data-form="reset-confirm"><input type="hidden" name="email" value="${esc(email)}"><label class="field"><span>Code</span><input class="pin" name="code" inputmode="numeric" autocomplete="one-time-code" maxlength="6" required></label><label class="field"><span>New password</span><input name="password" type="password" minlength="8" required></label><p class="form-error"></p><button class="btn" type="submit">Save password</button></form>`;
      } catch (err) { setError(form, err.message); }
    });
  },
  async 'reset-confirm'(form) {
    setError(form, '');
    await withButton(form.querySelector('button'), 'Saving…', async () => {
      try {
        const data = await api('/api/auth/reset/confirm', { method: 'POST', body: { email: form.email.value, code: form.code.value, password: form.password.value } });
        signedIn(data.user, 'Password updated.');
      } catch (err) { setError(form, err.message); }
    });
  },
  async thread(form) {
    setError(form, '');
    await withButton(form.querySelector('button'), 'Posting…', async () => {
      try {
        const data = await api('/api/threads', { method: 'POST', body: { slug: form.slug.value, title: form.title.value, body: form.body.value } });
        toast('Thread posted.');
        navigate(`/t/${data.id}`);
      } catch (err) { setError(form, err.message); }
    });
  },
  async reply(form) {
    setError(form, '');
    await withButton(form.querySelector('button'), 'Replying…', async () => {
      try {
        await api(`/api/threads/${form.id.value}/posts`, { method: 'POST', body: { body: form.body.value } });
        await renderRoute();
      } catch (err) { setError(form, err.message); }
    });
  },
  async report(form) {
    setError(form, '');
    await withButton(form.querySelector('button'), 'Sending…', async () => {
      try {
        await api('/api/reports', { method: 'POST', body: { type: form.type.value, target: form.target.value, server: form.server.value, reason: form.reason.value, details: form.details.value } });
        toast('Report is in the queue.');
        navigate('/');
      } catch (err) { setError(form, err.message); }
    });
  },
  async apply(form) {
    setError(form, '');
    await withButton(form.querySelector('button'), 'Sending…', async () => {
      try {
        await api('/api/applications', { method: 'POST', body: { nick: form.nick.value, experience: form.experience.value, why: form.why.value, availability: form.availability.value } });
        toast('Application sent.');
        navigate('/');
      } catch (err) { setError(form, err.message); }
    });
  },
  async 'report-status'(form) {
    await withButton(form.querySelector('button'), 'Saving…', async () => {
      await api(`/api/reports/${form.id.value}/status`, { method: 'POST', body: { status: form.status.value } });
      toast('Report updated.');
      await renderRoute();
    });
  },
  async server(form) {
    setError(form, '');
    await withButton(form.querySelector('button'), 'Checking…', async () => {
      try {
        await api('/api/servers', { method: 'POST', body: { address: form.address.value } });
        toast('Server added.');
        await renderRoute();
      } catch (err) { setError(form, err.message); }
    });
  },
  async repo(form) {
    setError(form, '');
    await withButton(form.querySelector('button'), 'Checking…', async () => {
      try {
        await api('/api/repos', { method: 'POST', body: { url: form.url.value } });
        toast('Repository added.');
        await renderRoute();
      } catch (err) { setError(form, err.message); }
    });
  },
  async staff(form) {
    setError(form, '');
    await withButton(form.querySelector('button'), 'Saving…', async () => {
      try {
        await api('/api/staff', { method: 'POST', body: { username: form.username.value } });
        toast('Staff updated.');
        await renderRoute();
      } catch (err) { setError(form, err.message); }
    });
  },
  async chat(form) {
    const text = form.body.value;
    if (!text.trim()) return;
    form.body.value = '';
    try {
      const data = await api('/api/chat', { method: 'POST', body: { body: text } });
      if (pullChat) await pullChat();
      if (data.message) {
        const log = document.getElementById('chat-log');
        if (log && !chatSeen.has(data.message.id)) {
          chatSeen.add(data.message.id);
          const row = document.createElement('div');
          row.className = 'chat-row';
          row.innerHTML = `${avatar(data.message.user.username)}<div>${userLink(data.message.user.username, data.message.user.role)} <span class="muted">${ago(data.message.createdAt)}</span><div class="prose">${rich(data.message.body)}</div></div>`;
          log.appendChild(row);
          log.scrollTop = log.scrollHeight;
        }
      }
    } catch (err) {
      form.body.value = text;
      toast(err.message);
    }
  },
};

function armConfirm(el) {
  if (el.dataset.confirm === 'ready') return true;
  el.dataset.confirm = 'ready';
  el.dataset.label = el.dataset.label || el.textContent;
  el.textContent = 'Confirm';
  setTimeout(() => {
    if (el.isConnected && el.dataset.confirm === 'ready') {
      el.dataset.confirm = '';
      el.textContent = el.dataset.label;
    }
  }, 3500);
  return false;
}

async function onAct(el) {
  const act = el.dataset.act;
  if (act === 'nav') {
    document.getElementById('nav').classList.toggle('open');
    return;
  }
  if (act === 'logout') {
    await api('/api/auth/logout', { method: 'POST', body: {} });
    state.me = null;
    toast('Logged out.');
    renderShell();
    navigate('/');
    return;
  }
  if (act === 'copy') {
    try {
      await navigator.clipboard.writeText(el.dataset.copy);
      toast('Copied the connect command.');
    } catch { toast('Copy the address from the card.'); }
    return;
  }
  if (act === 'resend') {
    await api('/api/auth/register/resend', { method: 'POST', body: { email: el.dataset.email } });
    toast('A new code is on the way.');
    return;
  }
  if (act === 'model') {
    document.querySelectorAll('.model-card').forEach((card) => card.classList.toggle('selected', card.dataset.id === el.dataset.id));
    document.querySelectorAll('.dossier').forEach((card) => { card.hidden = card.dataset.id !== el.dataset.id; });
    return;
  }
  const confirmActs = new Set(['delete-post', 'delete-thread', 'remove-server', 'remove-repo', 'remove-staff']);
  if (confirmActs.has(act) && !armConfirm(el)) return;
  if (act === 'delete-post') await api(`/api/posts/${el.dataset.id}`, { method: 'DELETE' });
  if (act === 'delete-thread') {
    await api(`/api/threads/${el.dataset.id}`, { method: 'DELETE' });
    toast('Thread deleted.');
    navigate('/forum');
    return;
  }
  if (act === 'lock') await api(`/api/threads/${el.dataset.id}/lock`, { method: 'POST', body: {} });
  if (act === 'pin') await api(`/api/threads/${el.dataset.id}/pin`, { method: 'POST', body: {} });
  if (act === 'remove-server') await api(`/api/servers/${el.dataset.id}`, { method: 'DELETE' });
  if (act === 'remove-repo') await api(`/api/repos/${el.dataset.id}`, { method: 'DELETE' });
  if (act === 'make-staff') await api('/api/staff', { method: 'POST', body: { username: el.dataset.username } });
  if (act === 'remove-staff') await api(`/api/staff/${el.dataset.id}`, { method: 'DELETE' });
  if (act === 'accept-app') await api(`/api/applications/${el.dataset.id}/review`, { method: 'POST', body: { action: 'accept' } });
  if (act === 'decline-app') await api(`/api/applications/${el.dataset.id}/review`, { method: 'POST', body: { action: 'decline' } });
  toast('Saved.');
  await renderRoute();
}

document.addEventListener('click', (event) => {
  const act = event.target.closest('[data-act]');
  if (act) {
    event.preventDefault();
    onAct(act).catch((err) => toast(err.message));
    return;
  }
  const link = event.target.closest('a[href]');
  if (!link) return;
  const url = new URL(link.href, location.origin);
  if (url.origin !== location.origin) return;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey || event.button !== 0) return;
  if (link.target === '_blank') return;
  event.preventDefault();
  navigate(url.pathname + url.search).catch((err) => toast(err.message));
});

document.addEventListener('submit', (event) => {
  const form = event.target;
  const kind = form.getAttribute('data-form');
  if (!kind || !forms[kind]) return;
  event.preventDefault();
  forms[kind](form).catch((err) => {
    setError(form, err.message);
    toast(err.message);
  });
});

window.addEventListener('popstate', () => {
  api('/api/auth/me').then((data) => {
    state.me = data.user;
    renderShell();
    return renderRoute();
  }).catch((err) => toast(err.message));
});

async function boot() {
  state.meta = await api('/api/meta');
  state.me = (await api('/api/auth/me')).user;
  renderShell();
  renderFooter();
  await refreshStatusBar();
  setInterval(() => { refreshStatusBar().catch(() => {}); }, 15000);
  await renderRoute();
}

boot().catch((err) => {
  document.getElementById('view').innerHTML = `<div class="wrap"><div class="empty">${esc(err.message)}</div></div>`;
});
