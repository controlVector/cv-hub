# CV-Hub AWS Deployment Plan

> Deployment target: AWS us-west-2

## Architecture Overview

```
Internet → CloudFront → ALB → EKS Cluster
                              ├── cv-hub-api (3 replicas)
                              ├── cv-hub-web (2 replicas)
                              ├── cv-hub-worker (1-4 replicas)
                              └── FalkorDB + Qdrant (StatefulSets)
                                     ↓
                        RDS PostgreSQL + ElastiCache Redis
```

---

## Phase 1: Foundation Infrastructure

| Component | AWS Service | Configuration |
|-----------|-------------|---------------|
| Container Registry | ECR | 3 repos: api, web, worker |
| Kubernetes | EKS | 1.29+, 3x t3.large nodes |
| VPC | VPC | 3 AZs, public/private subnets |
| Load Balancer | ALB | Via AWS Load Balancer Controller |
| DNS | Route 53 | cv-hub.io, api.cv-hub.io, git.cv-hub.io |
| TLS | ACM | Wildcard cert *.cv-hub.io |

### VPC Design

- **CIDR**: 10.0.0.0/16
- **Public Subnets**: 10.0.1.0/24, 10.0.2.0/24, 10.0.3.0/24 (NAT Gateway, ALB)
- **Private Subnets**: 10.0.10.0/24, 10.0.20.0/24, 10.0.30.0/24 (EKS nodes, RDS)
- **Database Subnets**: 10.0.100.0/24, 10.0.110.0/24, 10.0.120.0/24 (RDS, ElastiCache)

### EKS Cluster

- **Version**: 1.29+
- **Node Group**: 3x t3.large (2 vCPU, 8GB RAM)
- **Add-ons**: CoreDNS, kube-proxy, VPC CNI, EBS CSI Driver
- **Controllers**: AWS Load Balancer Controller, cert-manager

---

## Phase 2: Data Layer

| Component | AWS Service | Spec |
|-----------|-------------|------|
| PostgreSQL | RDS | db.t3.medium, 100GB gp3, Multi-AZ |
| Redis | ElastiCache | cache.t3.small, single-node |
| FalkorDB | EKS StatefulSet | 50GB EBS gp3 |
| Qdrant | EKS StatefulSet | 100GB EBS gp3 |
| Git Storage | EBS | 200GB gp3 (or S3 for scale) |

### RDS PostgreSQL Configuration

- **Engine**: PostgreSQL 16
- **Instance**: db.t3.medium (2 vCPU, 4GB RAM)
- **Storage**: 100GB gp3, auto-scaling up to 500GB
- **Multi-AZ**: Enabled for production
- **Backup**: 7-day automated backups
- **Encryption**: At-rest encryption enabled

### ElastiCache Redis Configuration

- **Engine**: Redis 7.x
- **Node Type**: cache.t3.small
- **Purpose**: Session storage, caching, BullMQ job queue

### Self-Hosted Databases (EKS StatefulSets)

#### FalkorDB
- **Purpose**: Knowledge graph storage
- **Storage**: 50GB EBS gp3
- **Port**: 6379 (Redis-compatible)

#### Qdrant
- **Purpose**: Vector embeddings for semantic search
- **Storage**: 100GB EBS gp3
- **Ports**: 6333 (HTTP), 6334 (gRPC)

---

## Phase 3: Security & Secrets

### AWS Secrets Manager

Store the following secrets:

| Secret Name | Description |
|-------------|-------------|
| `cv-hub/jwt-access-secret` | JWT signing key (min 32 chars) |
| `cv-hub/jwt-refresh-secret` | JWT refresh signing key (min 32 chars) |
| `cv-hub/csrf-secret` | CSRF protection key (min 32 chars) |
| `cv-hub/mfa-encryption-key` | MFA TOTP encryption key |
| `cv-hub/database-url` | PostgreSQL connection string |
| `cv-hub/redis-url` | ElastiCache Redis connection string |
| `cv-hub/openrouter-api-key` | OpenRouter API key for AI features |
| `cv-hub/smtp-credentials` | SMTP credentials (optional) |
| `cv-hub/github-oauth` | GitHub OAuth client ID/secret (optional) |

### IAM Configuration

#### IRSA (IAM Roles for Service Accounts)

Create IAM roles for Kubernetes service accounts:

| Service Account | Permissions |
|-----------------|-------------|
| `cv-hub-api` | Secrets Manager read, S3 read/write (if using S3 storage) |
| `cv-hub-worker` | Secrets Manager read, S3 read/write |
| `ebs-csi-controller` | EBS volume management |

### Security Groups

| Security Group | Inbound Rules |
|----------------|---------------|
| ALB | 80, 443 from 0.0.0.0/0 |
| EKS Nodes | All from ALB SG, All from self |
| RDS | 5432 from EKS Nodes SG |
| ElastiCache | 6379 from EKS Nodes SG |

---

## Phase 4: CI/CD Pipeline

### Option A: Extend GitHub Actions (Recommended)

Update `.github/workflows/deploy.yml` to:

1. Build and push images to ECR
2. Update Kubernetes manifests
3. Deploy to EKS via `kubectl` or ArgoCD

```yaml
# Add to existing deploy.yml
- name: Configure AWS credentials
  uses: aws-actions/configure-aws-credentials@v4
  with:
    role-to-assume: arn:aws:iam::ACCOUNT_ID:role/github-actions-deploy
    aws-region: us-west-2

- name: Login to Amazon ECR
  uses: aws-actions/amazon-ecr-login@v2

- name: Build and push to ECR
  run: |
    docker build -f Dockerfile.api -t $ECR_REGISTRY/cv-hub-api:$SHA .
    docker push $ECR_REGISTRY/cv-hub-api:$SHA

- name: Deploy to EKS
  run: |
    aws eks update-kubeconfig --name cv-hub-cluster --region us-west-2
    kubectl set image deployment/cv-hub-api api=$ECR_REGISTRY/cv-hub-api:$SHA
```

### Option B: AWS CodePipeline

- **Source**: GitHub (via CodeStar Connection)
- **Build**: CodeBuild (build Docker images, push to ECR)
- **Deploy**: CodeDeploy to EKS or direct kubectl apply

---

## Phase 5: Monitoring & Observability

### CloudWatch

| Metric | Alarm Threshold |
|--------|-----------------|
| API CPU | > 80% for 5 min |
| API Memory | > 85% for 5 min |
| RDS CPU | > 80% for 5 min |
| RDS Connections | > 80% of max |
| ALB 5xx errors | > 10/min |
| ALB latency | p99 > 2s |

### Container Insights

Enable EKS Container Insights for:
- Pod-level CPU/memory metrics
- Container logs aggregation
- Kubernetes control plane logs

### Log Groups

| Log Group | Source |
|-----------|--------|
| `/aws/eks/cv-hub/cluster` | EKS control plane |
| `/aws/containerinsights/cv-hub/application` | Application logs |
| `/aws/rds/cv-hub-postgres` | RDS logs |

---

## Estimated Monthly Cost

| Component | Specification | Cost (USD) |
|-----------|---------------|------------|
| EKS Control Plane | 1 cluster | $73 |
| EC2 Node Group | 3x t3.large | $180 |
| RDS PostgreSQL | db.t3.medium, Multi-AZ | $140 |
| ElastiCache Redis | cache.t3.small | $25 |
| Application Load Balancer | 1 ALB | $20 |
| EBS Storage | 400GB gp3 | $40 |
| NAT Gateway | 1 per AZ (3 total) | $100 |
| Data Transfer | ~100GB/month | $10 |
| Secrets Manager | 10 secrets | $5 |
| CloudWatch | Logs + metrics | $20 |
| **Total (Production)** | | **~$615/month** |

### Cost Optimization Options

- Use single NAT Gateway: Save ~$65/month
- Use RDS Single-AZ for dev: Save ~$70/month
- Use Spot Instances for workers: Save ~30% on compute
- Reserved Instances (1-year): Save ~30% on RDS/EC2

---

## Implementation Checklist

### Infrastructure Setup

- [ ] Create VPC with public/private subnets
- [ ] Provision EKS cluster
- [ ] Install EBS CSI Driver add-on
- [ ] Install AWS Load Balancer Controller
- [ ] Install cert-manager
- [ ] Create ECR repositories (api, web, worker)
- [ ] Provision RDS PostgreSQL instance
- [ ] Provision ElastiCache Redis cluster
- [ ] Create Secrets Manager secrets
- [ ] Configure IAM roles (IRSA)
- [ ] Set up Route 53 hosted zone
- [ ] Request ACM certificate

### Application Deployment

- [ ] Build and push Docker images to ECR
- [ ] Create Kubernetes namespace `cv-hub`
- [ ] Deploy ConfigMaps and Secrets
- [ ] Deploy FalkorDB StatefulSet
- [ ] Deploy Qdrant StatefulSet
- [ ] Run database migrations
- [ ] Deploy cv-hub-api
- [ ] Deploy cv-hub-worker
- [ ] Deploy cv-hub-web
- [ ] Configure Ingress with ALB
- [ ] Verify health checks
- [ ] Configure DNS records

### Post-Deployment

- [ ] Set up CloudWatch dashboards
- [ ] Configure CloudWatch alarms
- [ ] Enable Container Insights
- [ ] Test backup/restore procedures
- [ ] Document runbooks
- [ ] Set up on-call rotation

---

## Environment Variables

The following environment variables must be configured:

```bash
# Core
NODE_ENV=production
PORT=3000
APP_URL=https://cv-hub.io
API_URL=https://api.cv-hub.io

# Database
DATABASE_URL=postgresql://user:pass@cv-hub-postgres.xxxxx.us-west-2.rds.amazonaws.com:5432/cvhub

# Redis
REDIS_URL=redis://cv-hub-redis.xxxxx.cache.amazonaws.com:6379

# JWT (from Secrets Manager)
JWT_ACCESS_SECRET=<from-secrets-manager>
JWT_REFRESH_SECRET=<from-secrets-manager>
JWT_ACCESS_EXPIRY=15m
JWT_REFRESH_EXPIRY=7d

# Security
CSRF_SECRET=<from-secrets-manager>
MFA_ENCRYPTION_KEY=<from-secrets-manager>

# Graph & Vector DBs
FALKORDB_URL=redis://falkordb.cv-hub.svc.cluster.local:6379
QDRANT_URL=http://qdrant.cv-hub.svc.cluster.local:6333

# AI Services
OPENROUTER_API_KEY=<from-secrets-manager>
EMBEDDING_MODEL=openai/text-embedding-3-small

# Storage
STORAGE_TYPE=local
GIT_STORAGE_PATH=/data/git
```

---

## Kubernetes Manifest Modifications

The existing manifests in `/deploy/kubernetes/base/` need the following updates for AWS:

### StorageClass

```yaml
apiVersion: storage.k8s.io/v1
kind: StorageClass
metadata:
  name: fast-ssd
provisioner: ebs.csi.aws.com
parameters:
  type: gp3
  iops: "3000"
  throughput: "125"
volumeBindingMode: WaitForFirstConsumer
```

### Ingress (ALB)

```yaml
apiVersion: networking.k8s.io/v1
kind: Ingress
metadata:
  name: cv-hub-ingress
  annotations:
    kubernetes.io/ingress.class: alb
    alb.ingress.kubernetes.io/scheme: internet-facing
    alb.ingress.kubernetes.io/target-type: ip
    alb.ingress.kubernetes.io/certificate-arn: arn:aws:acm:us-west-2:ACCOUNT:certificate/CERT_ID
    alb.ingress.kubernetes.io/listen-ports: '[{"HTTPS":443}]'
    alb.ingress.kubernetes.io/ssl-redirect: '443'
```

---

## Support & Contacts

- **Infrastructure Issues**: [Your Team Contact]
- **Application Issues**: [Your Team Contact]
- **AWS Support**: [AWS Support Plan Level]

---

*Generated: January 2026*
