# CV-Hub Kubernetes Deployment

This directory contains Kubernetes manifests for deploying CV-Hub as a SaaS platform.

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Ingress (nginx)                         │
│         cv-hub.io    api.cv-hub.io    git.cv-hub.io            │
└────────────┬─────────────────┬────────────────┬────────────────┘
             │                 │                │
     ┌───────▼───────┐ ┌──────▼──────┐ ┌───────▼───────┐
     │   Web (SPA)   │ │    API      │ │   Git HTTP    │
     │   2 replicas  │ │  3+ pods    │ │   (same API)  │
     └───────────────┘ └──────┬──────┘ └───────────────┘
                              │
            ┌─────────────────┼─────────────────┐
            │                 │                 │
    ┌───────▼───────┐ ┌───────▼───────┐ ┌──────▼──────┐
    │ Graph Workers │ │     Redis     │ │  PostgreSQL │
    │   2+ pods     │ │   (sessions)  │ │   (primary) │
    └───────┬───────┘ └───────────────┘ └─────────────┘
            │
    ┌───────┼───────────────────┐
    │       │                   │
┌───▼───┐ ┌─▼─────────┐ ┌───────▼───────┐
│FalkorDB│ │  Qdrant   │ │  Git Storage  │
│(graph) │ │ (vectors) │ │ (PV or S3)    │
└────────┘ └───────────┘ └───────────────┘
```

## Prerequisites

1. Kubernetes cluster (1.25+)
2. kubectl configured
3. Kustomize or kubectl with kustomize support
4. Container registry access (GitHub Container Registry)
5. nginx-ingress controller
6. cert-manager (for TLS)

## Quick Start

### 1. Create namespace and secrets

```bash
# Create namespace
kubectl create namespace cv-hub

# Create secrets (edit with real values first!)
kubectl apply -f base/config.yaml
```

### 2. Generate secrets

```bash
# Generate secure secrets
SESSION_SECRET=$(openssl rand -base64 32)
JWT_SECRET=$(openssl rand -base64 32)
MFA_KEY=$(openssl rand -base64 32)
PG_PASSWORD=$(openssl rand -base64 24)

# Create secret
kubectl -n cv-hub create secret generic cv-hub-secrets \
  --from-literal=session-secret=$SESSION_SECRET \
  --from-literal=jwt-secret=$JWT_SECRET \
  --from-literal=mfa-encryption-key=$MFA_KEY \
  --from-literal=postgres-user=cvhub \
  --from-literal=postgres-password=$PG_PASSWORD \
  --from-literal=database-url="postgresql://cvhub:$PG_PASSWORD@postgres:5432/cvhub" \
  --from-literal=redis-url="redis://redis:6379" \
  --from-literal=openrouter-api-key="YOUR_KEY_HERE"
```

### 3. Deploy base infrastructure

```bash
# Deploy databases first
kubectl apply -f base/storage.yaml
kubectl apply -f base/databases.yaml

# Wait for databases to be ready
kubectl -n cv-hub wait --for=condition=ready pod -l app=postgres --timeout=120s
kubectl -n cv-hub wait --for=condition=ready pod -l app=redis --timeout=120s
kubectl -n cv-hub wait --for=condition=ready pod -l app=qdrant --timeout=120s
kubectl -n cv-hub wait --for=condition=ready pod -l app=falkordb --timeout=120s
```

### 4. Run database migrations

```bash
# Run migrations (from a job or locally)
kubectl -n cv-hub run migrations --rm -it --restart=Never \
  --image=ghcr.io/your-org/cv-hub/api:latest \
  --env="DATABASE_URL=postgresql://cvhub:PASSWORD@postgres:5432/cvhub" \
  -- npx drizzle-kit push
```

### 5. Deploy application

```bash
# Deploy everything with kustomize
kubectl apply -k overlays/production

# Or for development/staging
kubectl apply -k base
```

### 6. Verify deployment

```bash
kubectl -n cv-hub get pods
kubectl -n cv-hub get svc
kubectl -n cv-hub get ingress
```

## Scaling

### Horizontal Pod Autoscaler

The API and Worker deployments include HPA configs:

```bash
# View HPA status
kubectl -n cv-hub get hpa

# Manually scale if needed
kubectl -n cv-hub scale deployment cv-hub-api --replicas=10
```

### Database Scaling

For production, replace StatefulSets with:

- **PostgreSQL**: Use CloudNativePG operator or managed (RDS, Cloud SQL)
- **Redis**: Use Redis Cluster or managed (ElastiCache, Memorystore)
- **Qdrant**: Use Qdrant Cloud or scale the StatefulSet
- **FalkorDB**: Scale vertically or use Redis Cluster mode

## Git Storage Options

### Option 1: Shared PVC (NFS)
```yaml
# Default - uses ReadWriteMany PVC
# Good for: Small to medium deployments
# Cons: NFS performance, single point of failure
```

### Option 2: Object Storage (S3/GCS)
```yaml
# Store bare repos in object storage
# Good for: Large scale, multi-region
# Requires: Custom git backend implementation
```

### Option 3: Per-organization volumes
```yaml
# Create PVC per organization
# Good for: Isolation, easier backup
# Cons: Management overhead
```

## Monitoring

Add Prometheus monitoring:

```bash
# Add ServiceMonitor for API
kubectl apply -f - <<EOF
apiVersion: monitoring.coreos.com/v1
kind: ServiceMonitor
metadata:
  name: cv-hub-api
  namespace: cv-hub
spec:
  selector:
    matchLabels:
      app: cv-hub-api
  endpoints:
    - port: http
      path: /metrics
      interval: 30s
EOF
```

## Backup Strategy

### PostgreSQL
```bash
# CronJob for daily backups
kubectl apply -f - <<EOF
apiVersion: batch/v1
kind: CronJob
metadata:
  name: postgres-backup
  namespace: cv-hub
spec:
  schedule: "0 2 * * *"
  jobTemplate:
    spec:
      template:
        spec:
          containers:
            - name: backup
              image: postgres:16-alpine
              command: ["/bin/sh", "-c"]
              args:
                - pg_dump -h postgres -U cvhub cvhub | gzip > /backup/cvhub-$(date +%Y%m%d).sql.gz
              volumeMounts:
                - name: backup
                  mountPath: /backup
          restartPolicy: OnFailure
          volumes:
            - name: backup
              persistentVolumeClaim:
                claimName: backup-pvc
EOF
```

### Git Repositories
```bash
# Use velero for PV backups or sync to object storage
velero backup create git-repos --include-namespaces cv-hub \
  --selector app=cv-hub-api
```

## Troubleshooting

### Check logs
```bash
kubectl -n cv-hub logs -f deployment/cv-hub-api
kubectl -n cv-hub logs -f deployment/cv-hub-worker
```

### Debug pod
```bash
kubectl -n cv-hub exec -it deployment/cv-hub-api -- /bin/sh
```

### Check database connectivity
```bash
kubectl -n cv-hub exec -it deployment/cv-hub-api -- \
  node -e "require('./dist/db').db.execute('SELECT 1')"
```

## Security Considerations

1. **Secrets**: Use External Secrets Operator or Sealed Secrets
2. **Network Policies**: Enabled by default to restrict database access
3. **RBAC**: Service accounts with minimal permissions
4. **Pod Security**: Run as non-root, read-only filesystem where possible
5. **Image Scanning**: Scan images with Trivy/Snyk in CI

## Cost Estimation (AWS EKS)

| Resource | Size | Monthly Cost (approx) |
|----------|------|----------------------|
| EKS Cluster | 1 | $73 |
| API nodes (m5.large x3) | 3 | $210 |
| Worker nodes (m5.xlarge x2) | 2 | $280 |
| RDS PostgreSQL (db.r5.large) | 1 | $175 |
| ElastiCache Redis (cache.m5.large) | 1 | $110 |
| EBS Storage (500GB gp3) | 1 | $40 |
| Load Balancer | 1 | $20 |
| **Total** | | **~$900/month** |

*Scale up/down based on actual usage*
