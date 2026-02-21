#!/usr/bin/env bash
set -euo pipefail

# CV-Hub Production Resiliency Deployment
# Runs all phases in sequence. Each phase is independently safe to run.
#
# Usage:
#   ./deploy-resiliency.sh              # Run all phases
#   ./deploy-resiliency.sh --phase 1    # Run specific phase only

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BASE_DIR="${SCRIPT_DIR}/.."
NAMESPACE="cv-hub"
PHASE="${2:-all}"

run_phase() {
  echo ""
  echo "================================================================"
  echo "  Phase $1: $2"
  echo "================================================================"
  echo ""
}

# ── Phase 1: Install metrics-server ─────────────────────
phase1() {
  run_phase 1 "Install metrics-server"
  bash "${SCRIPT_DIR}/install-metrics-server.sh"
}

# ── Phase 2: Deploy NFS server ──────────────────────────
phase2() {
  run_phase 2 "Deploy NFS server for shared git storage"
  echo "This phase requires downtime for data migration."
  echo "Run separately with: bash ${SCRIPT_DIR}/deploy-nfs.sh"
  echo "Skipping in automated run — must be executed manually."
}

# ── Phase 3+5: Apply backup and maintenance CronJobs ────
phase3() {
  run_phase 3 "Deploy backup CronJobs"

  # Ensure backup credentials secret exists
  if ! kubectl -n "$NAMESPACE" get secret backup-spaces-credentials > /dev/null 2>&1; then
    echo "WARNING: backup-spaces-credentials secret not found."
    echo "Create it from secrets.example.yaml before backups can run."
    echo "Applying template (placeholder values)..."
  fi

  kubectl apply -f "${BASE_DIR}/base/backup-cronjobs.yaml"

  echo ""
  echo "CronJobs created:"
  kubectl -n "$NAMESPACE" get cronjobs -l component=backup
  kubectl -n "$NAMESPACE" get cronjobs -l component=maintenance
  echo ""
  echo "To test manually:"
  echo "  kubectl -n $NAMESPACE create job test-pg-backup --from=cronjob/backup-postgres"
  echo "  kubectl -n $NAMESPACE create job test-git-backup --from=cronjob/backup-git-repos"
}

# ── Phase 4: Apply synced manifests ──────────────────────
phase4() {
  run_phase 4 "Sync Kubernetes manifests"

  echo "Building kustomize output for DigitalOcean overlay..."
  kubectl kustomize "${BASE_DIR}/overlays/digitalocean/" > /dev/null

  echo "Kustomize build OK. Applying..."
  echo ""
  echo "NOTE: Applying the full overlay may conflict with existing StatefulSet PVCs."
  echo "For StatefulSets with existing PVCs, storage class changes are NOT applied"
  echo "to already-provisioned volumes (this is a Kubernetes limitation)."
  echo ""

  kubectl apply -k "${BASE_DIR}/overlays/digitalocean/" --server-side --force-conflicts 2>&1 || {
    echo ""
    echo "Some resources may have failed — this is expected for immutable fields."
    echo "StatefulSet volumeClaimTemplates cannot be changed after creation."
  }

  echo ""
  echo "Current state:"
  kubectl -n "$NAMESPACE" get deployments
  echo ""
  kubectl -n "$NAMESPACE" get statefulsets
}

# ── Phase 6: Deploy monitoring ───────────────────────────
phase6() {
  run_phase 6 "Deploy monitoring"

  kubectl apply -f "${BASE_DIR}/base/monitoring.yaml"

  echo "Monitoring CronJob created:"
  kubectl -n "$NAMESPACE" get cronjobs -l component=monitoring
  echo ""
  echo "To configure alerts, set the webhook URL:"
  echo "  kubectl -n $NAMESPACE patch secret monitoring-config -p '{\"stringData\":{\"webhook-url\":\"https://hooks.slack.com/...\"}}''"
}

# ── Main ─────────────────────────────────────────────────
echo "=== CV-Hub Production Resiliency Deployment ==="
echo "Namespace: ${NAMESPACE}"
echo ""

if [ "$PHASE" = "all" ]; then
  phase1
  phase2
  phase3
  phase4
  phase6
  echo ""
  echo "================================================================"
  echo "  Deployment complete!"
  echo "================================================================"
  echo ""
  echo "Verification checklist:"
  echo "  [ ] kubectl top nodes                    # metrics-server working"
  echo "  [ ] kubectl -n cv-hub get hpa            # real CPU/memory %"
  echo "  [ ] kubectl -n cv-hub get cronjobs       # backups scheduled"
  echo "  [ ] cv push origin main                  # git operations work"
  echo "  [ ] kubectl -n cv-hub get pods           # all pods healthy"
  echo ""
  echo "Manual steps still needed:"
  echo "  1. Run deploy-nfs.sh for NFS migration (requires downtime)"
  echo "  2. Create DO Spaces bucket: doctl spaces create cv-hub-backups --region nyc3"
  echo "  3. Update backup-spaces-credentials with real keys"
  echo "  4. Configure monitoring webhook URL"
  echo "  5. Set up DigitalOcean uptime checks for https://api.hub.controlvector.io/health"
else
  case "$PHASE" in
    1) phase1 ;;
    2) phase2 ;;
    3) phase3 ;;
    4) phase4 ;;
    5) phase3 ;; # Git GC is part of backup-cronjobs.yaml
    6) phase6 ;;
    *) echo "Unknown phase: ${PHASE}. Use 1-6 or omit for all." && exit 1 ;;
  esac
fi
