# CV-Hub DigitalOcean Deployment Guide

Deploy CV-Hub to DigitalOcean Kubernetes with Cloudflare DNS/CDN.

## Cost Summary

### Recommended Setup (~$170/month)

| Resource | Spec | Cost |
|----------|------|------|
| DOKS Cluster | Free control plane | $0 |
| Node Pool | 3x s-2vcpu-4gb | $72 |
| Block Storage | ~100GB for DBs | $10 |
| Load Balancer | 1x | $12 |
| **Total Infrastructure** | | **$94/month** |

Plus self-hosted databases in K8s:
- PostgreSQL (in cluster)
- Redis (in cluster)
- FalkorDB (in cluster)
- Qdrant (in cluster)

### Alternative: Managed Databases (~$280/month)

| Resource | Spec | Cost |
|----------|------|------|
| DOKS + Nodes + LB | (above) | $84 |
| Managed PostgreSQL | Basic 1GB | $15 |
| Managed Redis | Basic 1GB | $15 |
| Additional node for DBs | s-4vcpu-8gb | $48 |
| Block Storage | 50GB | $5 |
| **Total** | | **$167/month** |

*Note: FalkorDB and Qdrant still need to run in K8s as DO doesn't offer managed versions*

### Cloudflare (Free)
- DNS management
- CDN & caching
- SSL/TLS certificates
- DDoS protection
- Web Application Firewall (basic)

## Prerequisites

1. **DigitalOcean Account** with API token
2. **doctl CLI** installed and authenticated:
   ```bash
   # Install doctl
   brew install doctl  # macOS
   # or snap install doctl  # Linux

   # Authenticate
   doctl auth init
   ```

3. **kubectl** installed
4. **Helm** installed:
   ```bash
   brew install helm  # macOS
   # or snap install helm  # Linux
   ```

5. **Cloudflare Account** with controlvector.io domain

## Quick Start

### Step 1: Create the Cluster

```bash
cd deploy

# Run the automated setup script
./digitalocean-setup.sh
```

This creates:
- 3-node Kubernetes cluster
- nginx-ingress controller with DO Load Balancer
- cert-manager for SSL certificates
- cv-hub namespace

### Step 2: Configure Cloudflare DNS

After the script completes, you'll see the Load Balancer IP. Add these records in Cloudflare:

| Type | Name | Content | Proxy |
|------|------|---------|-------|
| A | @ | `<LB_IP>` | Proxied (orange) |
| A | api | `<LB_IP>` | Proxied (orange) |
| A | git | `<LB_IP>` | DNS only (gray) |

**Important**: Keep `git` as DNS-only for git clone/push operations.

### Step 3: Configure Cloudflare SSL/TLS

In Cloudflare dashboard → SSL/TLS:
1. Set encryption mode to **Full (strict)**
2. Enable **Always Use HTTPS**
3. Enable **Automatic HTTPS Rewrites**

### Step 4: Generate Secrets

```bash
./generate-secrets.sh
```

This prompts for:
- OpenRouter API key (for AI features)
- GitHub OAuth credentials (optional)

### Step 5: Deploy CV-Hub

```bash
# Deploy all components
kubectl apply -k kubernetes/overlays/digitalocean

# Watch deployment progress
kubectl -n cv-hub get pods -w
```

### Step 6: Run Database Migrations

```bash
# Get the database password from secrets
DB_PASS=$(kubectl -n cv-hub get secret cv-hub-secrets -o jsonpath='{.data.postgres-password}' | base64 -d)

# Run migrations
kubectl -n cv-hub run migrations --rm -it --restart=Never \
  --image=ghcr.io/your-org/cv-hub/api:latest \
  --env="DATABASE_URL=postgresql://cvhub:$DB_PASS@postgres:5432/cvhub" \
  -- npx drizzle-kit push
```

### Step 7: Verify Deployment

```bash
# Check all pods are running
kubectl -n cv-hub get pods

# Check services
kubectl -n cv-hub get svc

# Check ingress
kubectl -n cv-hub get ingress

# Test endpoints
curl https://api.hub.controlvector.io/health
curl https://hub.controlvector.io
```

## Architecture

```
                    Cloudflare (CDN + WAF + SSL)
                              │
                    ┌─────────┴─────────┐
                    │   DO Load Balancer │
                    │      ($12/mo)      │
                    └─────────┬─────────┘
                              │
              ┌───────────────┼───────────────┐
              │               │               │
     hub.controlvector.io  api.hub.controlvector.io  git.hub.controlvector.io
              │               │               │
        ┌─────▼─────┐   ┌─────▼─────┐   ┌─────▼─────┐
        │  Web SPA  │   │    API    │   │  Git HTTP │
        │ 2 replicas│   │ 2-6 pods  │   │ (same API)│
        └───────────┘   └─────┬─────┘   └───────────┘
                              │
           ┌──────────────────┼──────────────────┐
           │                  │                  │
     ┌─────▼─────┐     ┌──────▼──────┐    ┌──────▼──────┐
     │  Workers  │     │  PostgreSQL │    │    Redis    │
     │ 1-4 pods  │     │   (1 pod)   │    │   (1 pod)   │
     └─────┬─────┘     └─────────────┘    └─────────────┘
           │
     ┌─────┴─────┬─────────────┐
     │           │             │
┌────▼────┐ ┌────▼────┐ ┌──────▼──────┐
│ FalkorDB│ │  Qdrant │ │ Git Storage │
│ (graph) │ │(vectors)│ │  (Block PV) │
└─────────┘ └─────────┘ └─────────────┘
```

## Scaling

### Manual Scaling

```bash
# Scale API pods
kubectl -n cv-hub scale deployment cv-hub-api --replicas=4

# Scale workers
kubectl -n cv-hub scale deployment cv-hub-worker --replicas=3
```

### Auto-scaling

HPA is configured to scale automatically based on CPU:

```bash
# View HPA status
kubectl -n cv-hub get hpa

# API: 2-6 replicas (scales at 70% CPU)
# Workers: 1-4 replicas (scales at 80% CPU)
```

### Adding Nodes

```bash
# Add nodes to the cluster
doctl kubernetes cluster node-pool update cv-hub-cluster main --count 5
```

## Monitoring & Logs

### View Logs

```bash
# API logs
kubectl -n cv-hub logs -f deployment/cv-hub-api

# Worker logs
kubectl -n cv-hub logs -f deployment/cv-hub-worker

# All pods
kubectl -n cv-hub logs -f -l app.kubernetes.io/part-of=cv-hub
```

### Debug Access

```bash
# Shell into API pod
kubectl -n cv-hub exec -it deployment/cv-hub-api -- /bin/sh

# Database access
kubectl -n cv-hub exec -it statefulset/postgres -- psql -U cvhub
```

### Resource Usage

```bash
# Node resources
kubectl top nodes

# Pod resources
kubectl -n cv-hub top pods
```

## Backup & Recovery

### PostgreSQL Backup

```bash
# Manual backup
kubectl -n cv-hub exec statefulset/postgres -- \
  pg_dump -U cvhub cvhub | gzip > backup-$(date +%Y%m%d).sql.gz

# Restore
gunzip -c backup-20240101.sql.gz | \
  kubectl -n cv-hub exec -i statefulset/postgres -- psql -U cvhub cvhub
```

### Git Repositories

Git repos are stored on DigitalOcean Block Storage. Enable DO Snapshots for backup:

```bash
# List volumes
doctl compute volume list

# Create snapshot
doctl compute volume-action snapshot <volume-id> --snapshot-name cv-hub-git-backup
```

## Troubleshooting

### Pods not starting

```bash
# Check events
kubectl -n cv-hub get events --sort-by='.lastTimestamp'

# Describe problematic pod
kubectl -n cv-hub describe pod <pod-name>
```

### Database connection issues

```bash
# Test PostgreSQL connection
kubectl -n cv-hub run pg-test --rm -it --restart=Never \
  --image=postgres:16-alpine -- \
  psql postgresql://cvhub:$(kubectl -n cv-hub get secret cv-hub-secrets -o jsonpath='{.data.postgres-password}' | base64 -d)@postgres:5432/cvhub -c "SELECT 1"
```

### SSL Certificate issues

```bash
# Check cert-manager
kubectl -n cert-manager get pods
kubectl -n cert-manager logs -l app=cert-manager

# Check certificate status
kubectl -n cv-hub get certificate
kubectl -n cv-hub describe certificate controlvector-tls
```

### Load Balancer not getting IP

```bash
# Check ingress controller
kubectl -n ingress-nginx get svc
kubectl -n ingress-nginx get pods

# Check DO Load Balancer in console or:
doctl compute load-balancer list
```

## Teardown

```bash
# Delete application
kubectl delete -k kubernetes/overlays/digitalocean

# Delete cluster (removes all resources)
doctl kubernetes cluster delete cv-hub-cluster

# Note: Block storage volumes may need manual deletion
doctl compute volume list
```

## CI/CD Integration

The GitHub Actions workflow can deploy to DigitalOcean:

1. Add secrets to GitHub repository:
   - `DIGITALOCEAN_ACCESS_TOKEN` - DO API token
   - `KUBECONFIG` - Base64 encoded kubeconfig

2. Get kubeconfig:
   ```bash
   doctl kubernetes cluster kubeconfig show cv-hub-cluster | base64
   ```

3. Push to main branch or create a tag to trigger deployment.
