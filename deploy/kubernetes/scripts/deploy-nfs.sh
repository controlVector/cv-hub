#!/usr/bin/env bash
set -euo pipefail

# Deploy NFS server and migrate git storage from RWO to NFS (RWX)
#
# This script:
#   1. Deploys the NFS server pod + service + PV
#   2. Scales down API/worker
#   3. Renames old PVC, runs data migration job
#   4. Updates deployments to use NFS PVC
#   5. Scales back up with 2 API replicas
#
# Prerequisites:
#   - kubectl configured for the cluster
#   - NFS server manifest exists at deploy/kubernetes/base/nfs-server.yaml
#   - Sufficient storage quota for a new 100Gi volume

NAMESPACE="cv-hub"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"

echo "=== Phase 2: Deploy NFS Server for Shared Git Storage ==="
echo ""

# Step 1: Deploy NFS server infrastructure
echo "Step 1: Deploying NFS server..."
kubectl apply -f "${SCRIPT_DIR}/../base/nfs-server.yaml"

echo "Waiting for NFS backing PVC to be bound..."
kubectl -n "$NAMESPACE" wait --for=jsonpath='{.status.phase}'=Bound pvc/nfs-backing-pvc --timeout=120s

echo "Waiting for NFS server pod to be ready..."
kubectl -n "$NAMESPACE" rollout status deployment/nfs-server --timeout=120s

echo "NFS server is running. Verifying service..."
kubectl -n "$NAMESPACE" get svc nfs-server
echo ""

# Step 2: Scale down workloads that use git storage
echo "Step 2: Scaling down API and worker..."
kubectl -n "$NAMESPACE" scale deploy cv-hub-api --replicas=0
kubectl -n "$NAMESPACE" scale deploy cv-hub-worker --replicas=0

echo "Waiting for pods to terminate..."
kubectl -n "$NAMESPACE" wait --for=delete pod -l app=cv-hub-api --timeout=120s 2>/dev/null || true
kubectl -n "$NAMESPACE" wait --for=delete pod -l app=cv-hub-worker --timeout=120s 2>/dev/null || true
echo ""

# Step 3: Rename old PVC and run migration
echo "Step 3: Migrating git data to NFS..."
echo "  NOTE: Kubernetes doesn't support PVC rename directly."
echo "  The migration job mounts NFS directly (not via PVC) to copy data."
echo ""

kubectl apply -f "${SCRIPT_DIR}/migrate-git-to-nfs.yaml"

echo "Waiting for migration job to complete (this may take a while)..."
kubectl -n "$NAMESPACE" wait --for=condition=complete job/migrate-git-to-nfs --timeout=600s

echo "Migration job logs:"
kubectl -n "$NAMESPACE" logs job/migrate-git-to-nfs
echo ""

# Step 4: Now the NFS PV/PVC from nfs-server.yaml replaces the old git-repos-pvc
# The nfs-server.yaml defines a git-repos-pvc with ReadWriteMany that binds to the NFS PV.
# Since the old git-repos-pvc is still in use, we need to delete deployments referencing it first,
# then delete the old PVC, then apply the new NFS-backed PVC.
echo "Step 4: Switching git-repos-pvc to NFS-backed storage..."
echo "  Deleting old RWO git-repos-pvc..."
kubectl -n "$NAMESPACE" delete pvc git-repos-pvc --wait=true

echo "  Applying NFS PV and PVC..."
# The nfs-server.yaml already defines git-repos-nfs-pv and git-repos-pvc (RWX)
# Re-apply to create the NFS-backed PVC
kubectl apply -f "${SCRIPT_DIR}/../base/nfs-server.yaml"

echo "  Waiting for NFS PVC to be bound..."
kubectl -n "$NAMESPACE" wait --for=jsonpath='{.status.phase}'=Bound pvc/git-repos-pvc --timeout=60s
echo ""

# Step 5: Scale back up
echo "Step 5: Scaling up with NFS storage..."
kubectl -n "$NAMESPACE" scale deploy cv-hub-api --replicas=2
kubectl -n "$NAMESPACE" scale deploy cv-hub-worker --replicas=1

echo "Waiting for pods to be ready..."
kubectl -n "$NAMESPACE" rollout status deployment/cv-hub-api --timeout=120s
kubectl -n "$NAMESPACE" rollout status deployment/cv-hub-worker --timeout=120s
echo ""

# Step 6: Verify
echo "Step 6: Verification..."
echo ""
echo "Pods:"
kubectl -n "$NAMESPACE" get pods -l 'app in (cv-hub-api, cv-hub-worker)'
echo ""
echo "PVCs:"
kubectl -n "$NAMESPACE" get pvc git-repos-pvc nfs-backing-pvc
echo ""
echo "HPA:"
kubectl -n "$NAMESPACE" get hpa

echo ""
echo "=== NFS deployment complete ==="
echo ""
echo "Next steps:"
echo "  1. Test git operations: cv push origin main"
echo "  2. Test cloning: cv clone <repo-url>"
echo "  3. Verify both API pods can read/write git data"
echo "  4. Once stable, clean up migration job: kubectl -n $NAMESPACE delete job migrate-git-to-nfs"
echo "  5. Delete old backing volume from DigitalOcean console (if no longer needed)"
