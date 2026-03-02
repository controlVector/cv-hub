#!/bin/bash
# MCP Handshake Health Check
# Tests the full MCP handshake sequence against the live API.
# Usage: ./scripts/test-mcp-handshake.sh [token]
#   token: OAuth access token or PAT (defaults to CV_HUB_PAT env var)

set -euo pipefail

API="${CV_HUB_API:-https://api.hub.controlvector.io}"
TOKEN="${1:-${CV_HUB_PAT:-}}"
PASSED=0
FAILED=0

pass() { echo "  ✓ $1"; PASSED=$((PASSED + 1)); }
fail() { echo "  ✗ $1"; FAILED=$((FAILED + 1)); }

echo "MCP Handshake Health Check"
echo "API: $API"
echo ""

# ── Step 1: HEAD /mcp ─────────────────────────────────────────────────
echo "Step 1: HEAD /mcp (protocol discovery)"
HEAD_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X HEAD "$API/mcp")
HEAD_VERSION=$(curl -s -D - -o /dev/null -X HEAD "$API/mcp" 2>/dev/null | grep -i "mcp-protocol-version" | awk '{print $2}' | tr -d '\r')

if [ "$HEAD_STATUS" = "200" ]; then
  pass "HEAD returns 200"
else
  fail "HEAD returns $HEAD_STATUS (expected 200)"
fi

if [ -n "$HEAD_VERSION" ]; then
  pass "MCP-Protocol-Version: $HEAD_VERSION"
else
  fail "Missing MCP-Protocol-Version header"
fi
echo ""

# ── Step 2: POST without auth ────────────────────────────────────────
echo "Step 2: POST /mcp without auth (should get 401)"
NOAUTH_STATUS=$(curl -s -o /dev/null -w "%{http_code}" -X POST "$API/mcp" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","method":"initialize","id":1}')
NOAUTH_WWW=$(curl -s -D - -o /dev/null -X POST "$API/mcp" \
  -H "Content-Type: application/json" \
  -d '{"jsonrpc":"2.0","method":"initialize","id":1}' 2>/dev/null \
  | grep -i "www-authenticate" | head -1)

if [ "$NOAUTH_STATUS" = "401" ]; then
  pass "Returns 401 without auth"
else
  fail "Returns $NOAUTH_STATUS (expected 401)"
fi

if echo "$NOAUTH_WWW" | grep -qi "resource_metadata"; then
  pass "WWW-Authenticate includes resource_metadata"
else
  fail "Missing resource_metadata in WWW-Authenticate"
fi
echo ""

# ── Step 3: POST initialize (requires token) ─────────────────────────
if [ -z "$TOKEN" ]; then
  echo "Step 3-4: SKIPPED (no token provided)"
  echo "  Set CV_HUB_PAT or pass token as argument"
  echo ""
  echo "Results: $PASSED passed, $FAILED failed (2 skipped)"
  exit $( [ "$FAILED" -gt 0 ] && echo 1 || echo 0 )
fi

echo "Step 3: POST /mcp initialize"
INIT_RESP=$(curl -s -X POST "$API/mcp" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","method":"initialize","params":{"protocolVersion":"2025-11-25","capabilities":{},"clientInfo":{"name":"health-check","version":"1.0"}},"id":1}')

INIT_JSON=$(echo "$INIT_RESP" | grep "^data:" | sed 's/^data: //')
if [ -z "$INIT_JSON" ]; then
  INIT_JSON="$INIT_RESP"
fi

SERVER_NAME=$(echo "$INIT_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin)['result']['serverInfo']['name'])" 2>/dev/null || echo "")
PROTO_VER=$(echo "$INIT_JSON" | python3 -c "import sys,json; print(json.load(sys.stdin)['result']['protocolVersion'])" 2>/dev/null || echo "")
HAS_TOOLS_CAP=$(echo "$INIT_JSON" | python3 -c "import sys,json; print('tools' in json.load(sys.stdin)['result']['capabilities'])" 2>/dev/null || echo "")

if [ -n "$SERVER_NAME" ]; then
  pass "Server: $SERVER_NAME"
else
  fail "No serverInfo.name in response"
fi

if [ -n "$PROTO_VER" ]; then
  pass "Protocol version: $PROTO_VER"
else
  fail "No protocolVersion in response"
fi

if [ "$HAS_TOOLS_CAP" = "True" ]; then
  pass "capabilities.tools present"
else
  fail "capabilities.tools missing"
fi
echo ""

# ── Step 4: POST tools/list ──────────────────────────────────────────
echo "Step 4: POST /mcp tools/list"
TOOLS_RESP=$(curl -s -X POST "$API/mcp" \
  -H "Authorization: Bearer $TOKEN" \
  -H "Content-Type: application/json" \
  -H "Accept: application/json, text/event-stream" \
  -d '{"jsonrpc":"2.0","method":"tools/list","id":2}')

TOOLS_JSON=$(echo "$TOOLS_RESP" | grep "^data:" | sed 's/^data: //')
if [ -z "$TOOLS_JSON" ]; then
  TOOLS_JSON="$TOOLS_RESP"
fi

TOOL_COUNT=$(echo "$TOOLS_JSON" | python3 -c "import sys,json; print(len(json.load(sys.stdin)['result']['tools']))" 2>/dev/null || echo "0")

if [ "$TOOL_COUNT" -gt 0 ]; then
  pass "$TOOL_COUNT tools registered"
else
  fail "No tools returned"
fi

# Verify tool schemas
SCHEMA_OK=$(echo "$TOOLS_JSON" | python3 -c "
import sys, json
d = json.load(sys.stdin)
tools = d['result']['tools']
bad = [t['name'] for t in tools if t.get('inputSchema',{}).get('type') != 'object']
if bad:
    print(f'BAD: {bad}')
else:
    print('OK')
" 2>/dev/null || echo "PARSE_ERROR")

if [ "$SCHEMA_OK" = "OK" ]; then
  pass "All tool inputSchemas have type: object"
else
  fail "Bad tool schemas: $SCHEMA_OK"
fi
echo ""

# ── Summary ──────────────────────────────────────────────────────────
echo "Results: $PASSED passed, $FAILED failed"
exit $( [ "$FAILED" -gt 0 ] && echo 1 || echo 0 )
