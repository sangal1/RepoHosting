#!/usr/bin/env bash
# Integration driver: full Netlify OAuth connector flow against the mock provider.
# Exercises the same generic oauth-start/oauth-callback functions as Vercel.
set -euo pipefail
LURL="http://127.0.0.1:54321"
LANON="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0"
LSR="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU"
J() { node -pe "JSON.parse(require('fs').readFileSync(0))$1"; }

EMAIL="nl+$(date +%s)@example.com"; PW="Test123!secure"
UID_=$(curl -s -X POST "$LURL/auth/v1/admin/users" -H "apikey: $LSR" -H "Authorization: Bearer $LSR" -H "Content-Type: application/json" -d "{\"email\":\"$EMAIL\",\"password\":\"$PW\",\"email_confirm\":true}" | J .id)
JWT=$(curl -s -X POST "$LURL/auth/v1/token?grant_type=password" -H "apikey: $LANON" -H "Content-Type: application/json" -d "{\"email\":\"$EMAIL\",\"password\":\"$PW\"}" | J .access_token)
echo "user=$UID_"

echo "== 1. oauth-start?provider=netlify =="
START=$(curl -s "$LURL/functions/v1/oauth-start?provider=netlify" -H "apikey: $LANON" -H "Authorization: Bearer $JWT")
echo "  $START"
AUTH_URL=$(echo "$START" | J .url)
STATE=$(node -pe "new URL(process.argv[1]).searchParams.get('state')" "$AUTH_URL")
echo "$AUTH_URL" | grep -q "app.netlify.com\|host.docker.internal" && echo "  ✓ authorize url points at netlify endpoint"
echo "$AUTH_URL" | grep -q "response_type=code" && echo "  ✓ response_type=code"

echo "== 2. oauth-callback (simulate netlify redirect) =="
LOC=$(curl -s -o /dev/null -D - "$LURL/functions/v1/oauth-callback?code=nlcode1&state=$STATE" -H "apikey: $LANON" | tr -d '\r' | awk 'tolower($1)=="location:"{print $2}')
echo "  redirect: $LOC"
echo "$LOC" | grep -q "connected=netlify" && echo "  ✓ connected=netlify" || { echo "  ✗ FAIL"; exit 1; }

echo "== 3. connectors-status =="
ST=$(curl -s "$LURL/functions/v1/connectors-status" -H "apikey: $LANON" -H "Authorization: Bearer $JWT")
echo "  $ST"
echo "$ST" | grep -q '"netlify":true' && echo "  ✓ netlify connected" || { echo "  ✗ FAIL"; exit 1; }

echo "== 4. stored credential (netlify uses full_name for account) =="
ROW=$(curl -s "$LURL/rest/v1/connector_credentials?user_id=eq.$UID_&provider=eq.netlify&select=provider,external_account_name,external_account_id" -H "apikey: $LSR" -H "Authorization: Bearer $LSR")
echo "  $ROW"
echo "$ROW" | grep -q '"external_account_name":"Ada Mock"' && echo "  ✓ account name captured" || echo "  ⚠ account name not captured"

echo "== 5. state consumed =="
LEFT=$(curl -s "$LURL/rest/v1/oauth_states?state=eq.$STATE&select=state" -H "apikey: $LSR" -H "Authorization: Bearer $LSR")
[ "$LEFT" = "[]" ] && echo "  ✓ state deleted" || { echo "  ✗ state present"; exit 1; }

echo ""
echo "ALL NETLIFY BACKEND CHECKS PASSED ✅"
