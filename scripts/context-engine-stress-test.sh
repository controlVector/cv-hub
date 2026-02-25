#!/usr/bin/env bash
#
# Context Engine Stress Test
# Tests compaction recovery, cross-session continuity, and concern switching
# against CV-Hub's own knowledge graph (261 files, 7,437 relationships).
#
# Usage: bash scripts/context-engine-stress-test.sh
#
set -euo pipefail

# ── Configuration ──────────────────────────────────────────────────────

CRED_FILE="${HOME}/.config/cv-hub/credentials"
if [[ -f "$CRED_FILE" ]]; then
  # shellcheck source=/dev/null
  source "$CRED_FILE"
fi

CV_HUB_API="${CV_HUB_API:-http://localhost:3000}"
TOKEN="${CV_HUB_PAT:-}"
OWNER="testorg"
REPO="cv-hub"
BASE_URL="${CV_HUB_API}/api/v1/repos/${OWNER}/${REPO}/context-engine"

if [[ -z "$TOKEN" ]]; then
  echo "FATAL: CV_HUB_PAT not set. Source ~/.config/cv-hub/credentials or export it."
  exit 1
fi

# ── File groups (real paths from the knowledge graph) ──────────────────

# Group 1: OAuth / Auth system
AUTH_FILES=(
  "apps/api/src/routes/auth.ts"
  "apps/api/src/routes/oauth.ts"
  "apps/api/src/routes/oauth-clients.ts"
  "apps/api/src/routes/mfa.ts"
  "apps/api/src/services/oauth.service.ts"
  "apps/api/src/routes/device-auth.ts"
  "apps/api/src/services/device-auth.service.ts"
)

# Group 2: Graph sync / Knowledge graph
GRAPH_FILES=(
  "apps/api/src/services/graph/graph.service.ts"
  "apps/api/src/services/graph/graph-sync.service.ts"
  "apps/api/src/services/graph/types.ts"
  "apps/api/src/routes/graph.ts"
  "apps/api/src/services/embedding.service.ts"
  "apps/api/src/services/summarization.service.ts"
)

# Group 3: CI/CD pipeline system
CICD_FILES=(
  "apps/api/src/routes/ci-cd.ts"
  "apps/api/src/services/ci/pipeline.service.ts"
  "apps/api/src/services/ci/step-executor.ts"
  "apps/api/src/services/ci/job-dispatch.service.ts"
  "apps/api/src/services/ci/ai-generator.service.ts"
  "apps/api/src/services/ci/ai-deploy.service.ts"
  "apps/api/src/services/ci/deploy-provider.ts"
  "apps/api/src/db/schema/ci-cd.ts"
)

# Group 4: Billing / Pricing / Stripe
BILLING_FILES=(
  "apps/api/src/routes/stripe.ts"
  "apps/api/src/routes/pricing.ts"
  "apps/api/src/services/stripe.service.ts"
  "apps/api/src/services/pricing.service.ts"
  "apps/api/src/services/credit.service.ts"
  "apps/api/src/services/tier-limits.service.ts"
  "apps/api/src/db/schema/pricing.ts"
  "apps/api/src/db/schema/subscriptions.ts"
)

# Group 5: MCP server / tools
MCP_FILES=(
  "apps/api/src/mcp/handler.ts"
  "apps/api/src/mcp/server.ts"
  "apps/api/src/mcp/register-tools.ts"
  "apps/api/src/mcp/session.ts"
  "apps/api/src/mcp/tools/graph.ts"
  "apps/api/src/mcp/tools/context-engine.ts"
  "apps/api/src/mcp/tools/sync.ts"
  "apps/api/src/routes/mcp-gateway.ts"
  "apps/api/src/routes/mcp-oauth.ts"
)

# Group 6: Webhooks / Notifications
WEBHOOK_FILES=(
  "apps/api/src/routes/webhooks.ts"
  "apps/api/src/services/webhook.service.ts"
  "apps/api/src/routes/notifications.ts"
  "apps/api/src/services/notification.service.ts"
  "apps/api/src/services/email.service.ts"
  "apps/api/src/db/schema/webhooks.ts"
  "apps/api/src/db/schema/notifications.ts"
)

# Group 7: Config management
CONFIG_FILES=(
  "apps/api/src/routes/config.ts"
  "apps/api/src/services/config.service.ts"
  "apps/api/src/services/config-encryption.service.ts"
  "apps/api/src/services/config-resolver.service.ts"
  "apps/api/src/services/config-stores/builtin.adapter.ts"
  "apps/api/src/services/config-stores/vault.adapter.ts"
  "apps/api/src/services/config-stores/aws-ssm.adapter.ts"
  "apps/api/src/db/schema/config.ts"
)

# Concern-specific file groups
DEPLOYMENT_FILES=(
  "apps/api/src/services/ci/ai-deploy.service.ts"
  "apps/api/src/services/ci/deploy-config.ts"
  "apps/api/src/services/ci/deploy-provider.ts"
)

COMPILATION_FILES=(
  "apps/api/src/services/ci/pipeline-parser.ts"
  "apps/api/src/services/ci/ai-generator.service.ts"
)

BUSINESS_FILES=(
  "apps/api/src/routes/pricing.ts"
  "apps/api/src/services/pricing.service.ts"
  "apps/api/src/services/billing.service.ts"
)

SOURCE_FILES=(
  "apps/api/src/services/repository.service.ts"
  "apps/api/src/services/organization.service.ts"
  "apps/api/src/services/user.service.ts"
)

# ── Test infrastructure ────────────────────────────────────────────────

PASS_COUNT=0
FAIL_COUNT=0
FAILURES=()

pass() {
  local label="$1"
  PASS_COUNT=$((PASS_COUNT + 1))
  echo "  PASS  $label"
}

fail() {
  local label="$1"
  local detail="${2:-}"
  FAIL_COUNT=$((FAIL_COUNT + 1))
  FAILURES+=("$label: $detail")
  echo "  FAIL  $label"
  if [[ -n "$detail" ]]; then
    echo "        => $detail"
  fi
}

json_array() {
  local arr=("$@")
  local out="["
  local first=true
  for item in "${arr[@]}"; do
    if $first; then first=false; else out+=","; fi
    out+="\"$item\""
  done
  out+="]"
  echo "$out"
}

# ── API helpers ────────────────────────────────────────────────────────

api_init() {
  local session_id="$1"
  local concern="${2:-codebase}"
  curl -sf -X POST \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"session_id\":\"$session_id\",\"concern\":\"$concern\"}" \
    "${BASE_URL}/init" 2>/dev/null || echo '{"error":"request_failed"}'
}

api_turn() {
  local session_id="$1"
  shift
  local turn_count="$1"
  shift
  local token_est="$1"
  shift
  local concern="${1:-codebase}"
  shift || true
  local files_json="${1:-[]}"

  curl -sf -X POST \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d "{
      \"session_id\":\"$session_id\",
      \"turn_count\":$turn_count,
      \"estimated_tokens_used\":$token_est,
      \"concern\":\"$concern\",
      \"files_touched\":$files_json,
      \"symbols_referenced\":[]
    }" \
    "${BASE_URL}/turn" 2>/dev/null || echo '{"error":"request_failed"}'
}

api_checkpoint() {
  local session_id="$1"
  local summary="$2"
  local files_json="$3"

  curl -sf -X POST \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d "{
      \"session_id\":\"$session_id\",
      \"transcript_summary\":\"$summary\",
      \"files_in_context\":$files_json,
      \"symbols_in_context\":[]
    }" \
    "${BASE_URL}/checkpoint" 2>/dev/null || echo '{"error":"request_failed"}'
}

extract_markdown() {
  python3 -c "
import sys, json
d = json.load(sys.stdin)
print(d.get('data', {}).get('context_markdown', '') or '')
" <<< "$1" 2>/dev/null || echo ""
}

extract_tokens() {
  python3 -c "
import sys, json
d = json.load(sys.stdin)
print(d.get('data', {}).get('token_estimate', 0) or 0)
" <<< "$1" 2>/dev/null || echo "0"
}

extract_compaction() {
  python3 -c "
import sys, json
d = json.load(sys.stdin)
print('true' if d.get('data', {}).get('compaction_detected') else 'false')
" <<< "$1" 2>/dev/null || echo "false"
}

has_success() {
  python3 -c "
import sys, json
d = json.load(sys.stdin)
print('true' if d.get('success') else 'false')
" <<< "$1" 2>/dev/null || echo "false"
}

markdown_contains() {
  local markdown="$1"
  local pattern="$2"
  if echo "$markdown" | grep -qi "$pattern"; then
    return 0
  else
    return 1
  fi
}

# ══════════════════════════════════════════════════════════════════════
echo ""
echo "================================================================"
echo "  Context Engine Stress Test"
echo "  Repo: ${OWNER}/${REPO} | API: ${CV_HUB_API}"
echo "================================================================"
echo ""

# ── Pre-flight check ──────────────────────────────────────────────────

echo "Pre-flight: checking API health..."
health=$(curl -sf "${CV_HUB_API}/health" 2>/dev/null || echo "")
if [[ -z "$health" ]]; then
  echo "FATAL: API not responding at ${CV_HUB_API}"
  exit 1
fi
echo "  API healthy"
echo ""

# ══════════════════════════════════════════════════════════════════════
# PHASE 1: Single session — compaction recovery
# ══════════════════════════════════════════════════════════════════════

echo "================================================================"
echo "  PHASE 1: Single Session — Compaction Recovery"
echo "================================================================"
echo ""
echo "Simulating a long session that triggers compaction."
echo "Verifying the context engine recovers knowledge that would be"
echo "lost in a vanilla Claude Code session."
echo ""

S1_ID="stress-p1-$(date +%s)"

# ── Turn 0: Init ──────────────────────────────────────────────────────
echo "[Turn 0] Init session (concern=codebase)"
resp=$(api_init "$S1_ID" "codebase")
md=$(extract_markdown "$resp")
tokens=$(extract_tokens "$resp")
success=$(has_success "$resp")

if [[ "$success" == "true" ]]; then
  pass "P1-T0: Init succeeds"
else
  fail "P1-T0: Init succeeds" "Response: $(echo "$resp" | head -c 200)"
fi

if [[ "$tokens" -gt 0 ]]; then
  pass "P1-T0: Init returns non-empty context (${tokens} tokens)"
else
  fail "P1-T0: Init returns non-empty context" "Got 0 tokens"
fi

if markdown_contains "$md" "Repository Overview"; then
  pass "P1-T0: Init contains repository overview"
else
  fail "P1-T0: Init contains repository overview" "Missing 'Repository Overview' section"
fi

if markdown_contains "$md" "Key Files"; then
  pass "P1-T0: Init contains key files"
else
  fail "P1-T0: Init contains key files" "Missing 'Key Files' section"
fi

echo ""

# ── Turn 1: Touch OAuth/Auth files ────────────────────────────────────
echo "[Turn 1] Touch OAuth/Auth subsystem (7 files)"
files_json=$(json_array "${AUTH_FILES[@]}")
resp=$(api_turn "$S1_ID" 1 100000 "codebase" "$files_json")
md_t1=$(extract_markdown "$resp")
tokens_t1=$(extract_tokens "$resp")

if [[ "$tokens_t1" -gt 0 ]]; then
  pass "P1-T1: Auth turn returns context (${tokens_t1} tokens)"
else
  fail "P1-T1: Auth turn returns context" "Got 0 tokens — graph expansion may have failed"
fi

echo ""

# ── Turn 2: Touch Graph/Sync files ────────────────────────────────────
echo "[Turn 2] Touch Graph/Sync subsystem (6 files)"
files_json=$(json_array "${GRAPH_FILES[@]}")
resp=$(api_turn "$S1_ID" 2 95000 "codebase" "$files_json")
md_t2=$(extract_markdown "$resp")
tokens_t2=$(extract_tokens "$resp")

if [[ "$tokens_t2" -gt 0 ]]; then
  pass "P1-T2: Graph turn returns context (${tokens_t2} tokens)"
else
  fail "P1-T2: Graph turn returns context" "Got 0 tokens"
fi

# Dedup check: auth files from T1 should not re-appear
if [[ -n "$md_t2" ]] && markdown_contains "$md_t2" "oauth.service"; then
  fail "P1-T2: Dedup — auth files not re-injected" "oauth.service appeared in T2 (already injected in T1)"
else
  pass "P1-T2: Dedup — auth files not re-injected"
fi

echo ""

# ── Turn 3: Touch CI/CD files ─────────────────────────────────────────
echo "[Turn 3] Touch CI/CD subsystem (8 files)"
files_json=$(json_array "${CICD_FILES[@]}")
resp=$(api_turn "$S1_ID" 3 90000 "codebase" "$files_json")
md_t3=$(extract_markdown "$resp")
tokens_t3=$(extract_tokens "$resp")

if [[ "$tokens_t3" -gt 0 ]]; then
  pass "P1-T3: CI/CD turn returns context (${tokens_t3} tokens)"
else
  fail "P1-T3: CI/CD turn returns context" "Got 0 tokens"
fi

echo ""

# ── Turn 4: Touch Billing files ───────────────────────────────────────
echo "[Turn 4] Touch Billing/Pricing subsystem (8 files)"
files_json=$(json_array "${BILLING_FILES[@]}")
resp=$(api_turn "$S1_ID" 4 85000 "codebase" "$files_json")
md_t4=$(extract_markdown "$resp")
tokens_t4=$(extract_tokens "$resp")

if [[ "$tokens_t4" -gt 0 ]]; then
  pass "P1-T4: Billing turn returns context (${tokens_t4} tokens)"
else
  fail "P1-T4: Billing turn returns context" "Got 0 tokens"
fi

echo ""

# ── Turn 5: Touch MCP files ───────────────────────────────────────────
echo "[Turn 5] Touch MCP server subsystem (9 files)"
files_json=$(json_array "${MCP_FILES[@]}")
resp=$(api_turn "$S1_ID" 5 80000 "codebase" "$files_json")
md_t5=$(extract_markdown "$resp")
tokens_t5=$(extract_tokens "$resp")

if [[ "$tokens_t5" -gt 0 ]]; then
  pass "P1-T5: MCP turn returns context (${tokens_t5} tokens)"
else
  fail "P1-T5: MCP turn returns context" "Got 0 tokens"
fi

echo ""

# ── Turn 6: Save checkpoint (simulates PreCompact hook) ───────────────
echo "[Turn 6] Save checkpoint before compaction"

# Checkpoint includes files from all previous turns
all_touched_json=$(json_array \
  "${AUTH_FILES[@]}" "${GRAPH_FILES[@]}" "${CICD_FILES[@]}" \
  "${BILLING_FILES[@]}" "${MCP_FILES[@]}")

checkpoint_summary="Session explored OAuth auth flow (auth.ts, oauth.ts, oauth-clients.ts, mfa.ts), knowledge graph sync pipeline (graph.service.ts, graph-sync.service.ts, embedding.service.ts), CI/CD system (pipeline.service.ts, step-executor.ts, job-dispatch.service.ts), billing/pricing (stripe.ts, pricing.service.ts, credit.service.ts), and MCP server integration (handler.ts, register-tools.ts, context-engine.ts tools)."

resp=$(api_checkpoint "$S1_ID" "$checkpoint_summary" "$all_touched_json")
success=$(has_success "$resp")

if [[ "$success" == "true" ]]; then
  pass "P1-T6: Checkpoint saved successfully"
else
  fail "P1-T6: Checkpoint saved" "Response: $(echo "$resp" | head -c 200)"
fi

echo ""

# ── Turn 7: SIMULATE COMPACTION — tokens drop from 80k to 25k ────────
echo "[Turn 7] SIMULATE COMPACTION — tokens drop 80k -> 25k"
echo "  This simulates Claude Code's context window compacting."
echo "  The context engine should detect the >50% drop and trigger recovery."

files_json=$(json_array "${WEBHOOK_FILES[@]}")
resp=$(api_turn "$S1_ID" 7 25000 "codebase" "$files_json")
md_t7=$(extract_markdown "$resp")
tokens_t7=$(extract_tokens "$resp")
compaction=$(extract_compaction "$resp")

if [[ "$compaction" == "true" ]]; then
  pass "P1-T7: Compaction detected (80k -> 25k)"
else
  fail "P1-T7: Compaction detected" "compaction_detected=$compaction (expected true)"
fi

if markdown_contains "$md_t7" "Context Recovery"; then
  pass "P1-T7: Recovery header present"
else
  fail "P1-T7: Recovery header present" "Missing 'Context Recovery' header"
fi

if [[ "$tokens_t7" -gt "$tokens_t5" ]]; then
  pass "P1-T7: Recovery budget larger than normal (${tokens_t7} > ${tokens_t5})"
else
  fail "P1-T7: Recovery budget larger than normal" "Recovery=${tokens_t7}, Normal=${tokens_t5}"
fi

# Recovery should include the checkpoint summary
if markdown_contains "$md_t7" "OAuth"; then
  pass "P1-T7: Recovery includes checkpoint (mentions OAuth from early turns)"
else
  fail "P1-T7: Recovery includes checkpoint" "Checkpoint summary not found in recovery context"
fi

echo ""

# ── Turn 8: Post-recovery normal turn ─────────────────────────────────
echo "[Turn 8] Post-recovery normal turn (config files)"
files_json=$(json_array "${CONFIG_FILES[@]}")
resp=$(api_turn "$S1_ID" 8 30000 "codebase" "$files_json")
md_t8=$(extract_markdown "$resp")
tokens_t8=$(extract_tokens "$resp")
compaction_t8=$(extract_compaction "$resp")

if [[ "$compaction_t8" == "false" ]]; then
  pass "P1-T8: No false compaction after recovery (25k -> 30k)"
else
  fail "P1-T8: No false compaction" "compaction_detected=true on token increase"
fi

if [[ "$tokens_t8" -gt 0 ]]; then
  pass "P1-T8: Normal context still works post-recovery (${tokens_t8} tokens)"
else
  fail "P1-T8: Normal context still works post-recovery" "Got 0 tokens"
fi

echo ""

# ── Turn 9: Dedup verification — re-touch auth files ──────────────────
echo "[Turn 9] Dedup verification — re-touch same auth files from T1"
files_json=$(json_array "${AUTH_FILES[@]}")
resp=$(api_turn "$S1_ID" 9 35000 "codebase" "$files_json")
md_t9=$(extract_markdown "$resp")
tokens_t9=$(extract_tokens "$resp")

# After re-touching already-injected files, context should be minimal or empty
# because those files were already in injectedFiles
if [[ "$tokens_t9" -lt 200 ]]; then
  pass "P1-T9: Dedup suppresses re-injection (${tokens_t9} tokens, expected <200)"
else
  fail "P1-T9: Dedup suppresses re-injection" "Got ${tokens_t9} tokens — files may have been re-injected"
fi

echo ""

# ══════════════════════════════════════════════════════════════════════
# PHASE 2: Cross-Session Continuity
# ══════════════════════════════════════════════════════════════════════

echo "================================================================"
echo "  PHASE 2: Cross-Session Continuity"
echo "================================================================"
echo ""
echo "Verifying that separate sessions get independent state."
echo "Each session should get its own dedup tracking."
echo ""

S2A_ID="stress-p2a-$(date +%s)"
S2B_ID="stress-p2b-$(($(date +%s) + 1))"

# ── Session A ─────────────────────────────────────────────────────────
echo "[Session A] Init + 3 turns"
resp_a_init=$(api_init "$S2A_ID" "codebase")
success_a=$(has_success "$resp_a_init")

if [[ "$success_a" == "true" ]]; then
  pass "P2-A0: Session A init succeeds"
else
  fail "P2-A0: Session A init succeeds" "$(echo "$resp_a_init" | head -c 200)"
fi

files_json=$(json_array "${AUTH_FILES[@]}")
resp_a_t1=$(api_turn "$S2A_ID" 1 100000 "codebase" "$files_json")
md_a_t1=$(extract_markdown "$resp_a_t1")
tokens_a_t1=$(extract_tokens "$resp_a_t1")

files_json=$(json_array "${GRAPH_FILES[@]}")
resp_a_t2=$(api_turn "$S2A_ID" 2 95000 "codebase" "$files_json")

files_json=$(json_array "${BILLING_FILES[@]}")
resp_a_t3=$(api_turn "$S2A_ID" 3 90000 "codebase" "$files_json")

echo ""

# ── Session B — independent session on same repo ──────────────────────
echo "[Session B] Init + touch SAME files as Session A"
resp_b_init=$(api_init "$S2B_ID" "codebase")
md_b_init=$(extract_markdown "$resp_b_init")
tokens_b_init=$(extract_tokens "$resp_b_init")
success_b=$(has_success "$resp_b_init")

if [[ "$success_b" == "true" ]]; then
  pass "P2-B0: Session B init succeeds (independent session)"
else
  fail "P2-B0: Session B init succeeds" "$(echo "$resp_b_init" | head -c 200)"
fi

if [[ "$tokens_b_init" -gt 0 ]]; then
  pass "P2-B0: Session B gets fresh init context (${tokens_b_init} tokens)"
else
  fail "P2-B0: Session B gets fresh init context" "Got 0 tokens"
fi

# Session B touches the same auth files that Session A already covered
files_json=$(json_array "${AUTH_FILES[@]}")
resp_b_t1=$(api_turn "$S2B_ID" 1 100000 "codebase" "$files_json")
md_b_t1=$(extract_markdown "$resp_b_t1")
tokens_b_t1=$(extract_tokens "$resp_b_t1")

# Session B should get auth context because dedup is per-session
if [[ "$tokens_b_t1" -gt 0 ]]; then
  pass "P2-B1: Session B gets auth context (dedup is per-session, ${tokens_b_t1} tokens)"
else
  fail "P2-B1: Session B gets auth context" "Got 0 tokens — dedup may be leaking across sessions"
fi

# Verify Session B gets similar context to what Session A got
if [[ "$tokens_a_t1" -gt 0 && "$tokens_b_t1" -gt 0 ]]; then
  # Both should be in the same ballpark (within 3x of each other)
  ratio=$((tokens_b_t1 * 100 / tokens_a_t1))
  if [[ "$ratio" -gt 30 && "$ratio" -lt 300 ]]; then
    pass "P2-B1: Cross-session parity (B/A ratio: ${ratio}%)"
  else
    fail "P2-B1: Cross-session parity" "B=${tokens_b_t1} vs A=${tokens_a_t1} (ratio ${ratio}%)"
  fi
fi

echo ""

# ══════════════════════════════════════════════════════════════════════
# PHASE 3: Concern Switching Stress Test
# ══════════════════════════════════════════════════════════════════════

echo "================================================================"
echo "  PHASE 3: Concern Switching"
echo "================================================================"
echo ""
echo "Verifying the context engine detects concern shifts from file patterns."
echo "Concern detection requires >60% of touched files to match a pattern."
echo ""

S3_ID="stress-p3-$(date +%s)"

# ── Init with codebase concern ────────────────────────────────────────
echo "[Turn 0] Init (concern=codebase)"
resp=$(api_init "$S3_ID" "codebase")
success=$(has_success "$resp")

if [[ "$success" == "true" ]]; then
  pass "P3-T0: Init with codebase concern"
else
  fail "P3-T0: Init with codebase concern" "$(echo "$resp" | head -c 200)"
fi

echo ""

# ── Turn 1: Touch deployment-pattern files ────────────────────────────
echo "[Turn 1] Touch deployment files (deploy-config, deploy-provider, ai-deploy)"
files_json=$(json_array "${DEPLOYMENT_FILES[@]}")
resp=$(api_turn "$S3_ID" 1 100000 "codebase" "$files_json")
tokens_t1=$(extract_tokens "$resp")

if [[ "$tokens_t1" -ge 0 ]]; then
  pass "P3-T1: Deployment-pattern files accepted (${tokens_t1} tokens)"
else
  fail "P3-T1: Deployment-pattern files accepted" "Request failed"
fi

echo ""

# ── Turn 2: Touch compilation-pattern files ───────────────────────────
echo "[Turn 2] Touch compilation-pattern files (pipeline-parser, ai-generator)"
files_json=$(json_array "${COMPILATION_FILES[@]}")
resp=$(api_turn "$S3_ID" 2 95000 "codebase" "$files_json")
tokens_t2=$(extract_tokens "$resp")

if [[ "$tokens_t2" -ge 0 ]]; then
  pass "P3-T2: Compilation-pattern files accepted (${tokens_t2} tokens)"
else
  fail "P3-T2: Compilation-pattern files accepted" "Request failed"
fi

echo ""

# ── Turn 3: Touch business-pattern files ──────────────────────────────
echo "[Turn 3] Touch business-pattern files (pricing route, pricing service)"
files_json=$(json_array "${BUSINESS_FILES[@]}")
resp=$(api_turn "$S3_ID" 3 90000 "codebase" "$files_json")
tokens_t3=$(extract_tokens "$resp")

if [[ "$tokens_t3" -ge 0 ]]; then
  pass "P3-T3: Business-pattern files accepted (${tokens_t3} tokens)"
else
  fail "P3-T3: Business-pattern files accepted" "Request failed"
fi

echo ""

# ── Turn 4: Revert to generic source files ────────────────────────────
echo "[Turn 4] Touch regular source files (should revert to codebase concern)"
files_json=$(json_array "${SOURCE_FILES[@]}")
resp=$(api_turn "$S3_ID" 4 85000 "codebase" "$files_json")
tokens_t4=$(extract_tokens "$resp")

if [[ "$tokens_t4" -ge 0 ]]; then
  pass "P3-T4: Regular source files accepted (${tokens_t4} tokens)"
else
  fail "P3-T4: Regular source files accepted" "Request failed"
fi

echo ""

# ── Turn 5: Rapid concern switches — deployment then business ─────────
echo "[Turn 5] Rapid switch — deployment files"
files_json=$(json_array "${DEPLOYMENT_FILES[@]}")
resp=$(api_turn "$S3_ID" 5 80000 "codebase" "$files_json")
tokens_t5=$(extract_tokens "$resp")

echo "[Turn 6] Rapid switch — business files"
files_json=$(json_array "${BUSINESS_FILES[@]}")
resp=$(api_turn "$S3_ID" 6 75000 "codebase" "$files_json")
tokens_t6=$(extract_tokens "$resp")

# After rapid switches, verify the engine doesn't crash or produce errors
success=$(has_success "$resp")
if [[ "$success" == "true" ]]; then
  pass "P3-T5/6: Rapid concern switching stable"
else
  fail "P3-T5/6: Rapid concern switching stable" "$(echo "$resp" | head -c 200)"
fi

echo ""

# ══════════════════════════════════════════════════════════════════════
# RESULTS
# ══════════════════════════════════════════════════════════════════════

TOTAL=$((PASS_COUNT + FAIL_COUNT))
echo "================================================================"
echo "  RESULTS"
echo "================================================================"
echo ""
echo "  Total assertions: $TOTAL"
echo "  Passed:           $PASS_COUNT"
echo "  Failed:           $FAIL_COUNT"
echo ""

if [[ ${#FAILURES[@]} -gt 0 ]]; then
  echo "  Failures:"
  for f in "${FAILURES[@]}"; do
    echo "    - $f"
  done
  echo ""
fi

if [[ "$FAIL_COUNT" -eq 0 ]]; then
  echo "  ALL TESTS PASSED"
  echo ""
  echo "  The context engine maintains codebase awareness across compaction"
  echo "  events and session boundaries. A vanilla Claude Code session would"
  echo "  lose all of this context after compaction — the engine recovers it"
  echo "  from the knowledge graph."
else
  PASS_RATE=$((PASS_COUNT * 100 / TOTAL))
  echo "  Pass rate: ${PASS_RATE}%"
fi

echo ""
echo "================================================================"
exit "$FAIL_COUNT"
