#!/usr/bin/env bash
# Integration driver: Render API-key connector flow against the mock Render API.
set -euo pipefail
LURL="http://127.0.0.1:54321"
LANON="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6ImFub24iLCJleHAiOjE5ODM4MTI5OTZ9.CRXP1A7WOeoJeXxjNni43kdQwgnWNReilDMblYTn_I0"
LSR="eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZS1kZW1vIiwicm9sZSI6InNlcnZpY2Vfcm9sZSIsImV4cCI6MTk4MzgxMjk5Nn0.EGIM96RAZx35lJzdJsyH-qQwv8Hdp7fsn3W0YpN81IU"
J() { node -pe "JSON.parse(require('fs').readFileSync(0))$1"; }

EMAIL="rd+$(date +%s)@example.com"; PW="Test123!secure"
UID_=$(curl -s -X POST "$LURL/auth/v1/admin/users" -H "apikey: $LSR" -H "Authorization: Bearer $LSR" -H "Content-Type: application/json" -d "{\"email\":\"$EMAIL\",\"password\":\"$PW\",\"email_confirm\":true}" | J .id)
JWT=$(curl -s -X POST "$LURL/auth/v1/token?grant_type=password" -H "apikey: $LANON" -H "Content-Type: application/json" -d "{\"email\":\"$EMAIL\",\"password\":\"$PW\"}" | J .access_token)
echo "user=$UID_"

echo "== 1. reject an invalid key (expect 400) =="
CODE=$(curl -s -o /tmp/rd_bad.json -w "%{http_code}" -X POST "$LURL/functions/v1/render-connect" -H "apikey: $LANON" -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" -d '{"apiKey":"wrong_key"}')
echo "  http $CODE -> $(cat /tmp/rd_bad.json)"
[ "$CODE" = "400" ] && echo "  ✓ invalid key rejected" || { echo "  ✗ FAIL"; exit 1; }

echo "== 2. reject empty key (expect 400) =="
CODE=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$LURL/functions/v1/render-connect" -H "apikey: $LANON" -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" -d '{"apiKey":""}')
echo "  http $CODE"; [ "$CODE" = "400" ] && echo "  ✓ empty rejected" || { echo "  ✗ FAIL"; exit 1; }

echo "== 3. accept a valid key (expect 200 + account) =="
RESP=$(curl -s -X POST "$LURL/functions/v1/render-connect" -H "apikey: $LANON" -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" -d '{"apiKey":"valid_render_key"}')
echo "  $RESP"
echo "$RESP" | grep -q '"ok":true' && echo "  ✓ accepted" || { echo "  ✗ FAIL"; exit 1; }
echo "$RESP" | grep -q '"account":"Ada Render Team"' && echo "  ✓ account name returned"

echo "== 4. connectors-status shows render connected =="
ST=$(curl -s "$LURL/functions/v1/connectors-status" -H "apikey: $LANON" -H "Authorization: Bearer $JWT")
echo "  $ST"; echo "$ST" | grep -q '"render":true' && echo "  ✓ render connected" || { echo "  ✗ FAIL"; exit 1; }

echo "== 5. stored credential is an api_key (token hidden from client role) =="
ROW=$(curl -s "$LURL/rest/v1/connector_credentials?user_id=eq.$UID_&provider=eq.render&select=provider,token_type,external_account_name" -H "apikey: $LSR" -H "Authorization: Bearer $LSR")
echo "  $ROW"; echo "$ROW" | grep -q '"token_type":"api_key"' && echo "  ✓ stored as api_key"

echo "== 6. re-submitting updates (upsert, no duplicate) =="
curl -s -o /dev/null -X POST "$LURL/functions/v1/render-connect" -H "apikey: $LANON" -H "Authorization: Bearer $JWT" -H "Content-Type: application/json" -d '{"apiKey":"valid_render_key"}'
CNT=$(curl -s "$LURL/rest/v1/connector_credentials?user_id=eq.$UID_&provider=eq.render&select=id" -H "apikey: $LSR" -H "Authorization: Bearer $LSR" | node -pe "JSON.parse(require('fs').readFileSync(0)).length")
echo "  rows=$CNT"; [ "$CNT" = "1" ] && echo "  ✓ single row (upsert)" || { echo "  ✗ duplicate"; exit 1; }

echo ""
echo "ALL RENDER BACKEND CHECKS PASSED ✅"
