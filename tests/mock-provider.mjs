// Minimal mock OAuth provider (stands in for Vercel/Netlify) for local
// integration testing of the oauth-callback edge function.
//   POST /token  -> { access_token, token_type }
//   GET  /user   -> account identity payload
// Usage: node tests/mock-provider.mjs [port]
import http from 'node:http';

const port = Number(process.argv[2] || 9999);
const ISSUED = new Map(); // code -> token
const POLLS = new Map(); // external id -> times polled (for status progression)

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${port}`);
  const send = (code, obj) => {
    res.writeHead(code, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(obj));
  };
  // status progression: first poll -> in-progress, second+ -> terminal
  const polled = (id) => {
    const n = (POLLS.get(id) ?? 0) + 1;
    POLLS.set(id, n);
    return n;
  };

  if (req.method === 'POST' && url.pathname === '/token') {
    let body = '';
    for await (const chunk of req) body += chunk;
    const params = new URLSearchParams(body);
    const code = params.get('code');
    const clientId = params.get('client_id');
    const clientSecret = params.get('client_secret');
    if (!code || clientId !== 'test_client' || clientSecret !== 'test_secret') {
      return send(400, { error: 'invalid_request' });
    }
    const token = `mock_access_${code}`;
    ISSUED.set(token, true);
    return send(200, {
      access_token: token,
      token_type: 'Bearer',
      scope: 'read write',
      team_id: 'team_mock_1',
    });
  }

  // Mock Render API: validate a personal API key. `valid_render_key` passes.
  if (req.method === 'GET' && url.pathname === '/render/owners') {
    const auth = req.headers['authorization'] || '';
    const key = auth.replace('Bearer ', '');
    if (key !== 'valid_render_key') return send(401, { message: 'Unauthorized' });
    return send(200, [
      { owner: { id: 'own_mock_1', name: 'Ada Render Team', email: 'ada@mock.dev', type: 'team' } },
    ]);
  }

  // Userinfo. Netlify uses GET; "Sign in with Vercel" uses POST. Accept both.
  if ((req.method === 'GET' || req.method === 'POST') && url.pathname === '/user') {
    const auth = req.headers['authorization'] || '';
    const token = auth.replace('Bearer ', '');
    if (!ISSUED.has(token)) return send(401, { error: 'unauthorized' });
    // Shape covers all accessors: Netlify (full_name), and Vercel OIDC
    // (sub / preferred_username / name).
    return send(200, {
      id: 'acct_mock_123',
      sub: 'acct_mock_123',
      full_name: 'Ada Mock',
      name: 'Ada Mock',
      preferred_username: 'ada-mock',
      email: 'ada@mock.dev',
    });
  }

  // ----------------------- list-repos endpoints -------------------------
  if (req.method === 'GET' && url.pathname === '/vercel/v9/projects') {
    return send(200, {
      projects: [
        { id: 'prj_1', name: 'repohosting', link: { type: 'github', org: 'sangal1', repo: 'RepoHosting', productionBranch: 'main' } },
        { id: 'prj_2', name: 'no-git' }, // filtered out (no link)
      ],
    });
  }
  if (req.method === 'GET' && url.pathname === '/netlify/sites') {
    return send(200, [
      { id: 'site_a', name: 'my-site', build_settings: { repo_url: 'https://github.com/sangal1/RepoHosting', repo_branch: 'main' } },
      { id: 'site_b', name: 'manual' }, // filtered out (no repo)
    ]);
  }

  // ----------------------- Vercel deploy --------------------------------
  if (req.method === 'POST' && url.pathname === '/vercel/v13/deployments') {
    return send(200, { id: 'dpl_mock_1', url: 'repohosting-mock.vercel.app', inspectorUrl: 'https://vercel.com/sangal1/repohosting/dpl_mock_1', readyState: 'QUEUED' });
  }
  if (req.method === 'GET' && url.pathname.startsWith('/vercel/v13/deployments/')) {
    const id = url.pathname.split('/').pop();
    return send(200, { readyState: polled(id) >= 2 ? 'READY' : 'BUILDING' });
  }
  if (req.method === 'POST' && /^\/vercel\/v10\/projects\/[^/]+\/env$/.test(url.pathname)) {
    return send(201, { created: true });
  }

  // ----------------------- Render deploy --------------------------------
  if (req.method === 'POST' && url.pathname === '/render/services') {
    return send(201, { service: { id: 'srv_mock_1', dashboardUrl: 'https://dashboard.render.com/web/srv_mock_1' }, deployId: 'dep_mock_1' });
  }
  if (req.method === 'GET' && /^\/render\/services\/[^/]+\/deploys$/.test(url.pathname)) {
    const id = url.pathname.split('/')[3];
    return send(200, [{ deploy: { id: 'dep_mock_1', status: polled(id) >= 2 ? 'live' : 'build_in_progress' } }]);
  }

  // ----------------------- Netlify deploy -------------------------------
  if (req.method === 'POST' && url.pathname === '/netlify/sites') {
    return send(201, { id: 'site_mock_1', admin_url: 'https://app.netlify.com/sites/site_mock_1', url: 'https://site-mock-1.netlify.app' });
  }
  if (req.method === 'GET' && /^\/netlify\/sites\/[^/]+\/deploys$/.test(url.pathname)) {
    const id = url.pathname.split('/')[3];
    return send(200, [{ id: 'ndep_1', state: polled(id) >= 2 ? 'ready' : 'building' }]);
  }

  send(404, { error: 'not_found' });
});

server.listen(port, () => console.log(`mock-provider listening on ${port}`));
