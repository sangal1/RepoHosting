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
};

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
    ? 'You’re in. Connect a platform to deploy.'
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
  }
}

// expose a tiny surface for tests / debugging
window.RepoHosting = { init, state, render, Session };

if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', init);
} else {
  init();
}
