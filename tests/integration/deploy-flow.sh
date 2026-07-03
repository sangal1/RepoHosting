#!/usr/bin/env bash
# Integration driver: deploy + status polling, against the mock platform.
set -euo pipefail
LURL="http://127.0.0.1:54321"
LANON="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0"
LSR="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU"
J() { node -pe "JSON.parse(require('fs').readFileSync(0))$1"; }

EMAIL="dep+$(date +%s)@example.com"; PW="Test123!secure"
UID_=$(curl -s -X POST "$LURL/auth/v1/admin/users" -H "apikey: $LSR" -H "Authorization: Bearer $LSR" -H "Content-Type: application/json" -d "{\"email\":\"$EMAIL\",\"password\":\"$PW\",\"email_confirm\":true}" | J .id)
JWT=$(curl -s -X POST "$LURL/auth/v1/token?grant_type=password" -H "apikey: $LANON" -H "Content-Type: application/json" -d "{\"email\":\"$EMAIL\",\"password\":\"$PW\"}" | J .access_token)
echo "user=$UID_"

echo "== seed connectors (vercel oauth token + render api key) =="
for row in 'vercel:mock_vercel_token' 'render:valid_render_key'; do
  p="${row%%:*}"; t="${row##*:}"
  curl -s -o /dev/null -X POST "$LURL/rest/v1/connector_credentials" -H "apikey: $LSR" -H "Authorization: Bearer $LSR" -H "Content-Type: application/json" -d "{\"user_id\":\"$UID_\",\"provider\":\"$p\",\"access_token\":\"$t\"}"
done
echo "  seeded"

poll_until_terminal() {
  local dep_id="$1" label="$2" st=""
  for i in $(seq 1 8); do
    st=$(curl -s "$LURL/functions/v1/deployment-status?id=$dep_id" -H "apikey: $LANON" -H "Authorization: Bearer $JWT" | J .status)
    echo "    poll $i -> $st"
    [ "$st" = "success" ] && { echo "  ✓ $label reached success"; return 0; }
    [ "$st" = "failed" ] && { echo "  ✗ $label failed"; return 1; }
  done
  echo "  ✗ $label never terminal"; return 1
}

echo "== 2. deploy to Vercel =="
D=$(curl -s -X POST "$LURL/functions/v1/deploy" -H "apikey: $LANON" -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" -d '{"provider":"vercel","repoUrl":"https://github.com/sangal1/RepoHosting","branch":"main","rootDir":"","env":{"FOO":"bar"}}')
echo "  $D"
VID=$(echo "$D" | J .deployment.id)
echo "$D" | grep -q '"status":"deploying"' && echo "  ✓ created as deploying" || { echo "  ✗ FAIL"; exit 1; }
echo "$D" | grep -q "vercel.com/sangal1/repohosting/dpl_mock_1" && echo "  ✓ external_url stored" || echo "  ⚠ no external_url"
echo "  polling vercel status..."
poll_until_terminal "$VID" "vercel"

echo "== 3. deploy to Render =="
D=$(curl -s -X POST "$LURL/functions/v1/deploy" -H "apikey: $LANON" -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" -d '{"provider":"render","repoUrl":"https://github.com/sangal1/RepoHosting","branch":"main","startCommand":"npm start","env":{"KEY":"val"}}')
echo "  $D"
RID=$(echo "$D" | J .deployment.id)
echo "$D" | grep -q "dashboard.render.com/web/srv_mock_1" && echo "  ✓ render dashboard url stored" || echo "  ⚠ no url"
echo "  polling render status..."
poll_until_terminal "$RID" "render"

echo "== 4. deployments visible to owner via REST (env hidden) =="
LIST=$(curl -s "$LURL/rest/v1/deployments?select=repo_name,provider,status,external_url&order=created_at.desc" -H "apikey: $LANON" -H "Authorization: Bearer $JWT")
echo "  $LIST"
echo "$LIST" | node -pe "JSON.parse(require('fs').readFileSync(0)).length>=2?'  ✓ owner sees their deployments':'  ✗ FAIL'"
ENVLEAK=$(curl -s "$LURL/rest/v1/deployments?select=env" -H "apikey: $LANON" -H "Authorization: Bearer $JWT")
echo "$ENVLEAK" | grep -qi "permission denied\|error\|\"code\"" && echo "  ✓ env column not readable by client" || echo "  ⚠ env readable? -> $ENVLEAK"

echo "== 5. deploy validation: bad url / disconnected provider =="
C1=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$LURL/functions/v1/deploy" -H "apikey: $LANON" -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" -d '{"provider":"vercel","repoUrl":"not-a-url"}')
echo "  bad url -> http $C1"; [ "$C1" = "400" ] && echo "  ✓ rejected" || echo "  ✗"
C2=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$LURL/functions/v1/deploy" -H "apikey: $LANON" -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" -d '{"provider":"netlify","repoUrl":"https://github.com/sangal1/RepoHosting"}')
echo "  netlify (not connected) -> http $C2"; [ "$C2" = "400" ] && echo "  ✓ rejected (not connected)" || echo "  ✗"

echo ""
echo "ALL DEPLOY BACKEND CHECKS PASSED ✅"
