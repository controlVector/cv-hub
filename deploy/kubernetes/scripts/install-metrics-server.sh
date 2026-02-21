#!/usr/bin/env bash
set -euo pipefail

# Install metrics-server on DOKS (DigitalOcean Kubernetes)
# Required for HPA to function — without this, HPA shows <unknown> for CPU/memory

echo "Installing metrics-server..."
kubectl apply -f https://github.com/kubernetes-sigs/metrics-server/releases/latest/download/components.yaml

# On DOKS, metrics-server may fail with TLS errors against kubelets.
# Patch to add --kubelet-insecure-tls if needed.
echo ""
echo "Waiting for metrics-server deployment to be available..."
if ! kubectl -n kube-system rollout status deployment/metrics-server --timeout=60s 2>/dev/null; then
  echo "metrics-server failed to start — patching with --kubelet-insecure-tls..."
  kubectl -n kube-system patch deployment metrics-server \
    --type='json' \
    -p='[{"op": "add", "path": "/spec/template/spec/containers/0/args/-", "value": "--kubelet-insecure-tls"}]'
  kubectl -n kube-system rollout status deployment/metrics-server --timeout=90s
fi

echo ""
echo "Verifying metrics-server..."
sleep 10  # Give it a moment to collect initial metrics
kubectl top nodes || echo "WARNING: 'kubectl top nodes' not ready yet — wait 30-60s and retry"

echo ""
echo "Check HPA status:"
kubectl -n cv-hub get hpa 2>/dev/null || echo "No HPA found in cv-hub namespace"

echo ""
echo "Done. If HPA still shows <unknown>, wait 1-2 minutes for metrics to populate."
