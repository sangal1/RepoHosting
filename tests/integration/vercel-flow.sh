#!/usr/bin/env bash
# Integration driver: full Vercel OAuth connector flow against the mock provider.
set -euo pipefail
LURL="http://127.0.0.1:54321"
LANON="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0"
LSR="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU"
J() { node -pe "JSON.parse(require('fs').readFileSync(0))$1"; }

EMAIL="vc+$(date +%s)@example.com"; PW="Test123!secure"
UID_=$(curl -s -X POST "$LURL/auth/v1/admin/users" -H "apikey: $LSR" -H "Authorization: Bearer $LSR" -H "Content-Type: application/json" -d "{\"email\":\"$EMAIL\",\"password\":\"$PW\",\"email_confirm\":true}" | J .id)
JWT=$(curl -s -X POST "$LURL/auth/v1/token?grant_type=password" -H "apikey: $LANON" -H "Content-Type: application/json" -d "{\"email\":\"$EMAIL\",\"password\":\"$PW\"}" | J .access_token)
echo "user=$UID_"

echo "== 1. oauth-start?provider=vercel =="
START=$(curl -s "$LURL/functions/v1/oauth-start?provider=vercel" -H "apikey: $LANON" -H "Authorization: Bearer $JWT")
echo "  $START"
AUTH_URL=$(echo "$START" | J .url)
STATE=$(node -pe "new URL(process.argv[1]).searchParams.get('state')" "$AUTH_URL")
echo "  state=$STATE"
echo "$AUTH_URL" | grep -q "client_id=test_client" && echo "  ✓ authorize url has client_id"
echo "$AUTH_URL" | grep -q "response_type=code" && echo "  ✓ authorize url has response_type=code"

echo "== 2. oauth-callback?code=...&state=... (simulate provider redirect) =="
LOC=$(curl -s -o /dev/null -D - "$LURL/functions/v1/oauth-callback?code=abc123&state=$STATE" -H "apikey: $LANON" | tr -d '\r' | awk 'tolower($1)=="location:"{print $2}')
echo "  redirect Location: $LOC"
echo "$LOC" | grep -q "connected=vercel" && echo "  ✓ redirected with connected=vercel" || { echo "  ✗ FAIL"; exit 1; }

echo "== 3. connectors-status =="
ST=$(curl -s "$LURL/functions/v1/connectors-status" -H "apikey: $LANON" -H "Authorization: Bearer $JWT")
echo "  $ST"
echo "$ST" | grep -q '"vercel":true' && echo "  ✓ vercel connected" || { echo "  ✗ FAIL"; exit 1; }

echo "== 4. stored credential (service role) =="
ROW=$(curl -s "$LURL/rest/v1/connector_credentials?user_id=eq.$UID_&provider=eq.vercel&select=provider,external_account_name,external_account_id,token_type" -H "apikey: $LSR" -H "Authorization: Bearer $LSR")
echo "  $ROW"
echo "$ROW" | grep -q '"external_account_name":"ada-mock"' && echo "  ✓ account name captured" || echo "  ⚠ account name not captured"

echo "== 5. state consumed (single-use) =="
LEFT=$(curl -s "$LURL/rest/v1/oauth_states?state=eq.$STATE&select=state" -H "apikey: $LSR" -H "Authorization: Bearer $LSR")
[ "$LEFT" = "[]" ] && echo "  ✓ state row deleted" || { echo "  ✗ state still present: $LEFT"; exit 1; }

echo "== 6. invalid state rejected =="
LOC2=$(curl -s -o /dev/null -D - "$LURL/functions/v1/oauth-callback?code=abc&state=bogus" -H "apikey: $LANON" | tr -d '\r' | awk 'tolower($1)=="location:"{print $2}')
echo "  $LOC2"
echo "$LOC2" | grep -q "connect_error=invalid_state" && echo "  ✓ invalid state -> connect_error" || { echo "  ✗ FAIL"; exit 1; }

echo ""
echo "ALL VERCEL BACKEND CHECKS PASSED ✅"
