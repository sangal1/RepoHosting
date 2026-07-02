// Minimal mock OAuth provider (stands in for Vercel/Netlify) for local
// integration testing of the oauth-callback edge function.
//   POST /token  -> { access_token, token_type }
//   GET  /user   -> account identity payload
// Usage: node tests/mock-provider.mjs [port]
import http from 'node:http';

const port = Number(process.argv[2] || 9999);
const ISSUED = new Map(); // code -> token

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, `http://localhost:${port}`);
  const send = (code, obj) => {
    res.writeHead(code, { 'Content-Type': 'application/json' });
    res.end(JSON.stringify(obj));
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

  if (req.method === 'GET' && url.pathname === '/user') {
    const auth = req.headers['authorization'] || '';
    const token = auth.replace('Bearer ', '');
    if (!ISSUED.has(token)) return send(401, { error: 'unauthorized' });
    // Shape covers both provider accessors (Vercel nests under .user).
    return send(200, {
      id: 'acct_mock_123',
      full_name: 'Ada Mock',
      email: 'ada@mock.dev',
      user: { id: 'acct_mock_123', username: 'ada-mock', email: 'ada@mock.dev' },
    });
  }

  send(404, { error: 'not_found' });
});

server.listen(port, () => console.log(`mock-provider listening on ${port}`));
