#!/bin/bash
# DigitalOcean Kubernetes Setup Script for CV-Hub
# Prerequisites: doctl CLI installed and authenticated

set -e

# Configuration
CLUSTER_NAME="cv-hub-cluster"
REGION="nyc1"  # Change to your preferred region
NODE_SIZE="s-2vcpu-4gb"  # $24/month per node
NODE_COUNT=3

echo "=== CV-Hub DigitalOcean Kubernetes Setup ==="
echo ""
echo "This script will create:"
echo "  - DOKS cluster: $CLUSTER_NAME"
echo "  - Region: $REGION"
echo "  - Nodes: $NODE_COUNT x $NODE_SIZE (~\$${NODE_COUNT}x24/month)"
echo ""
echo "Estimated monthly cost breakdown:"
echo "  - Nodes ($NODE_COUNT x $NODE_SIZE): \$$((NODE_COUNT * 24))"
echo "  - Load Balancer: \$12"
echo "  - Block Storage (~100GB): \$10"
echo "  - Total: ~\$$((NODE_COUNT * 24 + 22))/month"
echo ""
read -p "Continue? (y/n) " -n 1 -r
echo
if [[ ! $REPLY =~ ^[Yy]$ ]]; then
    exit 1
fi

# Step 1: Create Kubernetes cluster
echo ""
echo "=== Step 1: Creating Kubernetes cluster ==="
doctl kubernetes cluster create $CLUSTER_NAME \
    --region $REGION \
    --size $NODE_SIZE \
    --count $NODE_COUNT \
    --tag cv-hub \
    --auto-upgrade \
    --surge-upgrade

# Step 2: Get cluster credentials
echo ""
echo "=== Step 2: Configuring kubectl ==="
doctl kubernetes cluster kubeconfig save $CLUSTER_NAME

# Step 3: Install nginx-ingress controller
echo ""
echo "=== Step 3: Installing nginx-ingress controller ==="
helm repo add ingress-nginx https://kubernetes.github.io/ingress-nginx
helm repo update

helm install nginx-ingress ingress-nginx/ingress-nginx \
    -f kubernetes/overlays/digitalocean/nginx-ingress-values.yaml \
    -n ingress-nginx \
    --create-namespace \
    --wait

# Step 4: Get Load Balancer IP
echo ""
echo "=== Step 4: Waiting for Load Balancer IP ==="
echo "This may take 2-3 minutes..."
sleep 30

LB_IP=""
while [ -z "$LB_IP" ]; do
    LB_IP=$(kubectl -n ingress-nginx get svc nginx-ingress-ingress-nginx-controller -o jsonpath='{.status.loadBalancer.ingress[0].ip}' 2>/dev/null || true)
    if [ -z "$LB_IP" ]; then
        echo "Waiting for Load Balancer IP..."
        sleep 10
    fi
done

echo ""
echo "=== Load Balancer IP: $LB_IP ==="
echo ""
echo "Add these DNS records in Cloudflare:"
echo "  Type: A    Name: hub               Content: $LB_IP    Proxy: ON"
echo "  Type: A    Name: api.hub           Content: $LB_IP    Proxy: ON"
echo "  Type: A    Name: git.hub           Content: $LB_IP    Proxy: OFF (for git operations)"
echo ""

# Step 5: Install cert-manager
echo ""
echo "=== Step 5: Installing cert-manager ==="
helm repo add jetstack https://charts.jetstack.io
helm repo update

helm install cert-manager jetstack/cert-manager \
    --namespace cert-manager \
    --create-namespace \
    --set installCRDs=true \
    --wait

# Step 6: Create namespace
echo ""
echo "=== Step 6: Creating cv-hub namespace ==="
kubectl create namespace cv-hub || true

# Step 7: Create ClusterIssuer for Let's Encrypt
echo ""
echo "=== Step 7: Creating Let's Encrypt ClusterIssuer ==="
cat <<EOF | kubectl apply -f -
apiVersion: cert-manager.io/v1
kind: ClusterIssuer
metadata:
  name: letsencrypt-prod
spec:
  acme:
    server: https://acme-v02.api.letsencrypt.org/directory
    email: admin@hub.controlvector.io
    privateKeySecretRef:
      name: letsencrypt-prod
    solvers:
      - http01:
          ingress:
            class: nginx
EOF

echo ""
echo "=== Setup Complete! ==="
echo ""
echo "Next steps:"
echo "1. Add DNS records in Cloudflare (see above)"
echo "2. Generate secrets:"
echo "   ./generate-secrets.sh"
echo "3. Deploy CV-Hub:"
echo "   kubectl apply -k kubernetes/overlays/digitalocean"
echo ""
echo "Useful commands:"
echo "  kubectl -n cv-hub get pods"
echo "  kubectl -n cv-hub logs -f deployment/cv-hub-api"
echo "  doctl kubernetes cluster delete $CLUSTER_NAME  # To tear down"
