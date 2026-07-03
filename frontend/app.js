// RepoHosting frontend logic.
//
// Auth talks directly to Supabase GoTrue (Supabase Auth) over REST so the app
// stays a dependency-free static site that GitHub Pages can serve, and so every
// network boundary is trivially mockable in Playwright tests.

const cfg = window.REPOHOSTING_CONFIG;
const SESSION_KEY = 'repohosting.session';
const PROVIDERS = ['vercel', 'render', 'netlify'];

/* ------------------------------------------------------------------ */
/* session helpers                                                     */
/* ------------------------------------------------------------------ */
const Session = {
  get() {
    try {
      return JSON.parse(localStorage.getItem(SESSION_KEY) || 'null');
    } catch {
      return null;
    }
  },
  set(s) {
    localStorage.setItem(SESSION_KEY, JSON.stringify(s));
  },
  clear() {
    localStorage.removeItem(SESSION_KEY);
  },
};

// Capture tokens handed back by Supabase in the URL fragment after OAuth.
function captureOAuthFragment() {
  if (!location.hash || location.hash.length < 2) return false;
  const params = new URLSearchParams(location.hash.slice(1));
  const access_token = params.get('access_token');
  if (!access_token) return false;
  const expires_in = parseInt(params.get('expires_in') || '3600', 10);
  Session.set({
    access_token,
    refresh_token: params.get('refresh_token'),
    expires_at: Math.floor(Date.now() / 1000) + expires_in,
  });
  // scrub tokens from the address bar
  history.replaceState(null, '', location.pathname + location.search);
  return true;
}

async function authFetch(path, init = {}) {
  const session = Session.get();
  const headers = {
    apikey: cfg.SUPABASE_ANON_KEY,
    'Content-Type': 'application/json',
    ...(init.headers || {}),
  };
  if (session?.access_token) headers.Authorization = `Bearer ${session.access_token}`;
  return fetch(`${cfg.SUPABASE_URL}${path}`, { ...init, headers });
}

async function fetchUser() {
  const session = Session.get();
  if (!session?.access_token) return null;
  const res = await authFetch('/auth/v1/user');
  if (!res.ok) {
    Session.clear();
    return null;
  }
  const u = await res.json();
  const meta = u.user_metadata || {};
  return {
    id: u.id,
    email: u.email || meta.email || '',
    name: meta.full_name || meta.name || u.email || 'there',
    avatar: meta.avatar_url || meta.picture || '',
  };
}

function loginWithGoogle() {
  const redirect = encodeURIComponent(location.origin + location.pathname);
  location.assign(
    `${cfg.SUPABASE_URL}/auth/v1/authorize?provider=google&redirect_to=${redirect}`
  );
}

async function logout() {
  try {
    await authFetch('/auth/v1/logout', { method: 'POST' });
  } catch {
    /* best-effort */
  }
  Session.clear();
  state.user = null;
  state.connectors = { vercel: false, render: false, netlify: false };
  render();
}

/* ------------------------------------------------------------------ */
/* connectors                                                          */
/* ------------------------------------------------------------------ */
async function fetchConnectorStatus() {
  const session = Session.get();
  if (!session?.access_token) return { vercel: false, render: false, netlify: false };
  try {
    const res = await fetch(`${cfg.FUNCTIONS_BASE}/connectors-status`, {
      headers: {
        apikey: cfg.SUPABASE_ANON_KEY,
        Authorization: `Bearer ${session.access_token}`,
      },
    });
    if (!res.ok) throw new Error(`status ${res.status}`);
    const data = await res.json();
    return {
      vercel: !!data.vercel,
      render: !!data.render,
      netlify: !!data.netlify,
    };
  } catch {
    return { vercel: false, render: false, netlify: false };
  }
}

async function startOAuthConnect(provider) {
  const session = Session.get();
  const res = await fetch(
    `${cfg.FUNCTIONS_BASE}/oauth-start?provider=${encodeURIComponent(provider)}`,
    {
      headers: {
        apikey: cfg.SUPABASE_ANON_KEY,
        Authorization: `Bearer ${session?.access_token || ''}`,
      },
    }
  );
  if (!res.ok) {
    toast(`Could not start ${provider} connection.`, 'error');
    return;
  }
  const { url } = await res.json();
  if (url) location.assign(url);
}

async function saveRenderKey(apiKey) {
  const session = Session.get();
  const res = await fetch(`${cfg.FUNCTIONS_BASE}/render-connect`, {
    method: 'POST',
    headers: {
      apikey: cfg.SUPABASE_ANON_KEY,
      Authorization: `Bearer ${session?.access_token || ''}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ apiKey }),
  });
  return res;
}

/* ------------------------------------------------------------------ */
/* rendering                                                           */
/* ------------------------------------------------------------------ */
const state = {
  user: null,
  connectors: { vercel: false, render: false, netlify: false },
  deployments: [],
};
const polling = new Set(); // deployment ids currently being polled
const PROVIDER_LABELS = { vercel: 'Vercel', render: 'Render', netlify: 'Netlify' };

const $ = (sel) => document.querySelector(sel);

function render() {
  const loggedIn = !!state.user;

  // navbar
  $('#google-login').hidden = loggedIn;
  $('#user-chip').hidden = !loggedIn;
  if (loggedIn) {
    $('#user-name').textContent = state.user.name;
    const avatar = $('#user-avatar');
    if (state.user.avatar) {
      avatar.src = state.user.avatar;
      avatar.hidden = false;
    } else {
      avatar.hidden = true;
    }
  }

  // hint
  $('#auth-hint').textContent = loggedIn
    ? 'Pick a platform, point at a repo, ship it.'
    : 'Sign in with Google to begin.';

  // connectors
  for (const p of PROVIDERS) {
    const connected = state.connectors[p];
    const btn = $(`#connect-${p}`);
    const status = $(`#status-${p}`);
    btn.disabled = !loggedIn;
    btn.textContent = connected ? 'Connected' : 'Connect';
    btn.classList.toggle('connected', connected);
    status.textContent = connected ? 'Connected' : 'Not connected';
    status.classList.toggle('connected', connected);
  }

  renderDeployForm();
}

let toastTimer;
function toast(message, kind = '') {
  const el = $('#toast');
  el.textContent = message;
  el.className = `toast ${kind}`.trim();
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.hidden = true;
  }, 3500);
}

/* ------------------------------------------------------------------ */
/* render modal                                                        */
/* ------------------------------------------------------------------ */
function openRenderModal() {
  $('#render-modal-error').hidden = true;
  $('#render-api-key').value = '';
  $('#render-modal').hidden = false;
  $('#render-api-key').focus();
}
function closeRenderModal() {
  $('#render-modal').hidden = true;
}
async function submitRenderKey() {
  const key = $('#render-api-key').value.trim();
  const errEl = $('#render-modal-error');
  if (!key) {
    errEl.textContent = 'Please paste an API key.';
    errEl.hidden = false;
    return;
  }
  const saveBtn = $('#render-save');
  saveBtn.disabled = true;
  saveBtn.textContent = 'Connecting…';
  try {
    const res = await saveRenderKey(key);
    if (!res.ok) {
      const body = await res.json().catch(() => ({}));
      errEl.textContent = body.error || 'That key was rejected by Render.';
      errEl.hidden = false;
      return;
    }
    state.connectors.render = true;
    render();
    closeRenderModal();
    toast('Render connected 🎉', 'success');
  } catch {
    errEl.textContent = 'Network error — please try again.';
    errEl.hidden = false;
  } finally {
    saveBtn.disabled = false;
    saveBtn.textContent = 'Save & connect';
  }
}

/* ------------------------------------------------------------------ */
/* deploy form                                                         */
/* ------------------------------------------------------------------ */
function renderDeployForm() {
  const loggedIn = !!state.user;
  const select = $('#provider-select');
  const prev = select.value;
  select.innerHTML = '';
  for (const p of PROVIDERS) {
    const opt = document.createElement('option');
    opt.value = p;
    const connected = state.connectors[p];
    opt.textContent = connected ? PROVIDER_LABELS[p] : `${PROVIDER_LABELS[p]} (not connected)`;
    opt.disabled = !connected; // shown but not selectable
    select.appendChild(opt);
  }
  // keep prior selection if still valid, else pick first connected provider
  const firstConnected = PROVIDERS.find((p) => state.connectors[p]);
  if (prev && state.connectors[prev]) select.value = prev;
  else if (firstConnected) select.value = firstConnected;
  select.disabled = !loggedIn;

  updateDeployControls();
}

function updateDeployControls() {
  const loggedIn = !!state.user;
  const provider = $('#provider-select').value;
  const connected = loggedIn && !!state.connectors[provider];
  const hasRepo = $('#repo-url').value.trim().length > 0;

  $('#deploy-btn').disabled = !(connected && hasRepo);
  // "Select repository" only applies to OAuth providers (Vercel/Netlify)
  $('#select-repo').disabled = !(connected && (provider === 'vercel' || provider === 'netlify'));
  ['repo-url', 'branch', 'root-dir', 'start-command', 'env-vars', 'copy-env'].forEach((id) => {
    $(`#${id}`).disabled = !loggedIn;
  });
}

function parseEnv(text) {
  const env = {};
  for (const raw of text.split('\n')) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) {
      val = val.slice(1, -1);
    }
    if (key) env[key] = val;
  }
  return env;
}

async function copyEnv() {
  const text = $('#env-vars').value;
  try {
    await navigator.clipboard.writeText(text);
    toast('.env copied to clipboard', 'success');
  } catch {
    toast('Copy failed — select and copy manually.', 'error');
  }
}

/* ---- repo picker ---- */
function openRepoModal() {
  const provider = $('#provider-select').value;
  $('#repo-modal-error').hidden = true;
  $('#repo-modal-sub').textContent = `Repositories on your ${PROVIDER_LABELS[provider]} account.`;
  const list = $('#repo-list');
  list.innerHTML = '<p class="repo-loading">Loading…</p>';
  $('#repo-modal').hidden = false;
  loadRepos(provider);
}
function closeRepoModal() {
  $('#repo-modal').hidden = true;
}
async function loadRepos(provider) {
  const session = Session.get();
  const list = $('#repo-list');
  try {
    const res = await fetch(`${cfg.FUNCTIONS_BASE}/list-repos?provider=${provider}`, {
      headers: { apikey: cfg.SUPABASE_ANON_KEY, Authorization: `Bearer ${session?.access_token || ''}` },
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || 'Could not load repositories');
    const repos = body.repos || [];
    if (!repos.length) {
      list.innerHTML = '<p class="repo-loading">No repositories found for this account.</p>';
      return;
    }
    list.innerHTML = '';
    for (const r of repos) {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'repo-item';
      item.setAttribute('data-testid', 'repo-item');
      const name = document.createElement('span');
      name.className = 'repo-item-name';
      name.textContent = r.name;
      const url = document.createElement('span');
      url.className = 'repo-item-url';
      url.textContent = r.url;
      item.append(name, url);
      item.addEventListener('click', () => {
        $('#repo-url').value = r.url;
        if (r.branch) $('#branch').value = r.branch;
        closeRepoModal();
        updateDeployControls();
      });
      list.appendChild(item);
    }
  } catch (e) {
    list.innerHTML = '';
    const err = $('#repo-modal-error');
    err.textContent = String(e.message || e);
    err.hidden = false;
  }
}

/* ---- deploy ---- */
async function doDeploy() {
  const provider = $('#provider-select').value;
  const repoUrl = $('#repo-url').value.trim();
  const branch = $('#branch').value.trim() || 'main';
  const rootDir = $('#root-dir').value.trim();
  const startCommand = $('#start-command').value.trim();
  const env = parseEnv($('#env-vars').value);

  const btn = $('#deploy-btn');
  btn.disabled = true;
  const original = btn.textContent;
  btn.textContent = 'Deploying…';
  try {
    const session = Session.get();
    const res = await fetch(`${cfg.FUNCTIONS_BASE}/deploy`, {
      method: 'POST',
      headers: {
        apikey: cfg.SUPABASE_ANON_KEY,
        Authorization: `Bearer ${session?.access_token || ''}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ provider, repoUrl, branch, rootDir, startCommand, env }),
    });
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      toast(body.error || 'Deployment could not be started.', 'error');
      return;
    }
    state.deployments.unshift(body.deployment);
    renderDeploymentsTable();
    toast(`Deploying ${body.deployment.repo_name}…`);
    pollDeployment(body.deployment.id);
  } catch {
    toast('Network error starting deployment.', 'error');
  } finally {
    btn.textContent = original;
    updateDeployControls();
  }
}

/* ------------------------------------------------------------------ */
/* deployments table                                                   */
/* ------------------------------------------------------------------ */
async function loadDeployments() {
  const session = Session.get();
  if (!session?.access_token) {
    state.deployments = [];
    renderDeploymentsTable();
    return;
  }
  try {
    const res = await fetch(
      `${cfg.SUPABASE_URL}/rest/v1/deployments?select=id,provider,repo_name,repo_url,status,external_url,created_at&order=created_at.desc&limit=50`,
      { headers: { apikey: cfg.SUPABASE_ANON_KEY, Authorization: `Bearer ${session.access_token}` } }
    );
    if (!res.ok) throw new Error();
    state.deployments = await res.json();
    renderDeploymentsTable();
    for (const d of state.deployments) {
      if (d.status === 'deploying' || d.status === 'queued') pollDeployment(d.id);
    }
  } catch {
    /* leave table as-is */
  }
}

function statusCell(status) {
  const span = document.createElement('span');
  const s = status === 'queued' ? 'deploying' : status;
  span.className = `status ${s}`;
  if (s === 'deploying') {
    const sp = document.createElement('span');
    sp.className = 'spinner';
    span.append(sp, document.createTextNode('Deploying'));
  } else {
    span.textContent = s.charAt(0).toUpperCase() + s.slice(1);
  }
  return span;
}

function renderDeploymentsTable() {
  const body = $('#deployments-body');
  body.innerHTML = '';
  if (!state.deployments.length) {
    const tr = document.createElement('tr');
    tr.className = 'empty-row';
    const td = document.createElement('td');
    td.colSpan = 3;
    td.textContent = state.user ? 'No deployments yet.' : 'Sign in to deploy.';
    tr.appendChild(td);
    body.appendChild(tr);
    return;
  }
  for (const d of state.deployments) {
    const tr = document.createElement('tr');
    tr.setAttribute('data-deployment-id', d.id);
    tr.setAttribute('data-testid', 'deployment-row');

    const repo = document.createElement('td');
    repo.textContent = d.repo_name;
    repo.title = `${PROVIDER_LABELS[d.provider] || d.provider} · ${d.repo_url}`;

    const status = document.createElement('td');
    status.setAttribute('data-testid', 'deployment-status');
    status.appendChild(statusCell(d.status));

    const link = document.createElement('td');
    if (d.external_url) {
      const a = document.createElement('a');
      a.href = d.external_url;
      a.target = '_blank';
      a.rel = 'noopener';
      a.textContent = 'View ↗';
      link.appendChild(a);
    } else {
      link.textContent = '—';
    }
    tr.append(repo, status, link);
    body.appendChild(tr);
  }
}

async function pollDeployment(id) {
  if (polling.has(id)) return;
  polling.add(id);
  const session = Session.get();
  const tick = async () => {
    try {
      const res = await fetch(`${cfg.FUNCTIONS_BASE}/deployment-status?id=${id}`, {
        headers: { apikey: cfg.SUPABASE_ANON_KEY, Authorization: `Bearer ${session?.access_token || ''}` },
      });
      if (res.ok) {
        const s = await res.json();
        const dep = state.deployments.find((d) => d.id === id);
        if (dep) {
          dep.status = s.status;
          if (s.external_url) dep.external_url = s.external_url;
          renderDeploymentsTable();
        }
        if (s.status === 'success' || s.status === 'failed' || s.status === 'canceled') {
          polling.delete(id);
          return;
        }
      }
    } catch {
      /* keep polling */
    }
    setTimeout(tick, 4000);
  };
  setTimeout(tick, 1500);
}

/* ------------------------------------------------------------------ */
/* wiring                                                              */
/* ------------------------------------------------------------------ */
function wire() {
  $('#google-login').addEventListener('click', loginWithGoogle);
  $('#logout').addEventListener('click', logout);

  $('#connect-vercel').addEventListener('click', () => startOAuthConnect('vercel'));
  $('#connect-netlify').addEventListener('click', () => startOAuthConnect('netlify'));
  $('#connect-render').addEventListener('click', openRenderModal);

  $('#render-cancel').addEventListener('click', closeRenderModal);
  $('#render-save').addEventListener('click', submitRenderKey);
  $('#render-modal').addEventListener('click', (e) => {
    if (e.target === $('#render-modal')) closeRenderModal();
  });
  $('#render-api-key').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') submitRenderKey();
  });

  // deploy form
  $('#provider-select').addEventListener('change', updateDeployControls);
  $('#repo-url').addEventListener('input', updateDeployControls);
  $('#copy-env').addEventListener('click', copyEnv);
  $('#select-repo').addEventListener('click', openRepoModal);
  $('#deploy-btn').addEventListener('click', doDeploy);
  $('#repo-cancel').addEventListener('click', closeRepoModal);
  $('#repo-modal').addEventListener('click', (e) => {
    if (e.target === $('#repo-modal')) closeRepoModal();
  });
}

function handleConnectedRedirect() {
  const params = new URLSearchParams(location.search);
  const connected = params.get('connected');
  const error = params.get('connect_error');
  if (connected && PROVIDERS.includes(connected)) {
    toast(`${connected[0].toUpperCase() + connected.slice(1)} connected 🎉`, 'success');
  } else if (error) {
    toast(`Connection failed: ${error}`, 'error');
  }
  if (connected || error) {
    history.replaceState(null, '', location.pathname);
  }
}

async function init() {
  wire();
  captureOAuthFragment();
  state.user = await fetchUser();
  render(); // paint auth state immediately
  handleConnectedRedirect();
  if (state.user) {
    state.connectors = await fetchConnectorStatus();
    render();
    loadDeployments();
  }
}

// expose a tiny surface for tests / debugging
window.RepoHosting = { init, state, render, Session };

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
