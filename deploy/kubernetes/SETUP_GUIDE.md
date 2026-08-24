# Deployment Pipeline Setup Guide

Quick start guide for setting up the automated Kubernetes deployment pipeline.

## Prerequisites

- GitHub repository with Actions enabled
- Kubernetes cluster (mainnet/production)
- kubectl installed locally
- Cluster admin access

## Step 1: Configure GitHub Secrets

### 1.1 Generate Kubeconfig Secret

```bash
# Get your kubeconfig (adjust path if needed)
cat ~/.kube/config | base64 -w 0

# Copy the output
```

### 1.2 Add Secrets to GitHub

1. Go to your repository on GitHub
2. Click `Settings` → `Secrets and variables` → `Actions`
3. Click `New repository secret`
4. Add the following secrets:

| Secret Name | Value | How to Get |
|-------------|-------|------------|
| `KUBE_CONFIG_MAINNET` | Base64-encoded kubeconfig | From step 1.1 above |
| `DOCKER_REGISTRY_TOKEN` | GitHub PAT with package write | Create at github.com/settings/tokens |

**For Docker Registry Token:**
```bash
# Go to: https://github.com/settings/tokens
# Click "Generate new token (classic)"
# Select scopes:
#   - write:packages
#   - read:packages
#   - delete:packages (optional)
# Generate token and copy it
```

## Step 2: Configure Kubernetes Cluster

### 2.1 Create Service Account (Recommended)

Instead of using admin kubeconfig, create a dedicated service account:

```bash
# Create service account
kubectl create serviceaccount github-deployer -n kube-system

# Create role with deploy permissions
cat <<EOF | kubectl apply -f -
apiVersion: rbac.authorization.k8s.io/v1
kind: ClusterRole
metadata:
  name: github-deployer
rules:
- apiGroups: ["", "apps", "batch", "networking.k8s.io"]
  resources: ["*"]
  verbs: ["get", "list", "watch", "create", "update", "patch", "delete"]
EOF

# Bind role to service account
kubectl create clusterrolebinding github-deployer \
  --clusterrole=github-deployer \
  --serviceaccount=kube-system:github-deployer

# Get service account token
kubectl create token github-deployer -n kube-system --duration=87600h
```

### 2.2 Create Kubeconfig for Service Account

```bash
# Get cluster info
CLUSTER_NAME=$(kubectl config current-context)
CLUSTER_SERVER=$(kubectl config view -o jsonpath="{.clusters[?(@.name=='$CLUSTER_NAME')].cluster.server}")
CLUSTER_CA=$(kubectl config view --raw -o jsonpath="{.clusters[?(@.name=='$CLUSTER_NAME')].cluster.certificate-authority-data}")

# Get service account token
SA_TOKEN=$(kubectl create token github-deployer -n kube-system --duration=87600h)

# Create kubeconfig
cat > github-deployer-kubeconfig.yaml <<EOF
apiVersion: v1
kind: Config
clusters:
- name: $CLUSTER_NAME
  cluster:
    server: $CLUSTER_SERVER
    certificate-authority-data: $CLUSTER_CA
contexts:
- name: github-deployer
  context:
    cluster: $CLUSTER_NAME
    user: github-deployer
current-context: github-deployer
users:
- name: github-deployer
  user:
    token: $SA_TOKEN
EOF

# Base64 encode for GitHub Secret
cat github-deployer-kubeconfig.yaml | base64 -w 0

# Clean up
rm github-deployer-kubeconfig.yaml
```

Add the output as `KUBE_CONFIG_MAINNET` secret.

## Step 3: Prepare Kubernetes Resources

### 3.1 Create Namespace

```bash
kubectl create namespace afropay
```

### 3.2 Create Secrets

**DO NOT commit actual secrets to git!**

```bash
# Generate encryption key
ENCRYPTION_KEY=$(openssl rand -hex 32)

# Generate JWT secret
JWT_SECRET=$(openssl rand -base64 32)

# Create secret
kubectl create secret generic afropay-secrets -n afropay \
  --from-literal=DATABASE_URL="postgresql://user:pass@host:5432/db" \
  --from-literal=REDIS_URL="redis://host:6379" \
  --from-literal=JWT_SECRET="$JWT_SECRET" \
  --from-literal=ENCRYPTION_KEY="$ENCRYPTION_KEY"
```

### 3.3 Apply ConfigMap

Edit `deploy/kubernetes/configmap.yaml` with your values, then:

```bash
kubectl apply -f deploy/kubernetes/configmap.yaml
```

### 3.4 Configure Ingress

Update `deploy/kubernetes/ingress.yaml` with your domain:

```yaml
spec:
  rules:
  - host: api.yourdomain.com  # Change this
    http:
      paths:
      - path: /
        pathType: Prefix
        backend:
          service:
            name: api-service
            port:
              number: 3001
```

## Step 4: Test Deployment Pipeline

### 4.1 Create Test Tag

```bash
# Create release candidate for testing
git tag v1.0.0-rc.1
git push origin v1.0.0-rc.1
```

### 4.2 Monitor Workflow

1. Go to GitHub → Actions tab
2. Watch "Deploy to Mainnet" workflow
3. Check logs for each step

### 4.3 Verify Deployment

```bash
# Check deployments
kubectl get deployments -n afropay

# Check pods
kubectl get pods -n afropay

# Check services
kubectl get services -n afropay

# Test API health
kubectl port-forward -n afropay svc/api-service 3001:3001
curl http://localhost:3001/health
```

## Step 5: Production Deployment

Once staging/RC deployment succeeds:

```bash
# Create production release
git tag v1.0.0
git push origin v1.0.0

# Monitor deployment (will deploy to mainnet)
```

## Troubleshooting

### Secret Validation Failed

**Error**: "Missing required secrets: KUBE_CONFIG_MAINNET"

**Solution**:
1. Verify secret name exactly matches `KUBE_CONFIG_MAINNET`
2. Check secret exists in `Settings` → `Secrets and variables` → `Actions`
3. Ensure secret has a value (not empty)

### Image Push Failed

**Error**: "denied: permission_denied: write_package"

**Solution**:
1. Verify `DOCKER_REGISTRY_TOKEN` has `write:packages` scope
2. Check token hasn't expired
3. Verify repository name in workflow matches actual repository

### Kubeconfig Invalid

**Error**: "unable to read client-cert" or "connection refused"

**Solution**:
```bash
# Test kubeconfig locally first
echo "$KUBE_CONFIG_BASE64" | base64 -d > test-kubeconfig.yaml
export KUBECONFIG=test-kubeconfig.yaml
kubectl get nodes

# If works locally, re-encode and update secret
cat test-kubeconfig.yaml | base64 -w 0
```

### Health Check Timeout

**Error**: "Health check timeout reached (300 seconds)"

**Solution**:
1. Check pod logs: `kubectl logs -l app=api -n afropay`
2. Check pod events: `kubectl describe pod -l app=api -n afropay`
3. Verify readiness probe path exists: `/health`
4. Check database connectivity from pod

### Migration Failed

**Error**: "Migration job failed or timed out"

**Solution**:
```bash
# Check migration job logs
kubectl logs -l job-name=migration-job -n afropay

# Common causes:
# - Database URL incorrect
# - Network policy blocking database access
# - Migration SQL error

# Delete failed job
kubectl delete job migration-job -n afropay

# Fix issue and retry deployment
```

## Security Best Practices

### 1. Secrets Management

**Current** (acceptable for MVP):
- Secrets stored in Kubernetes Secrets
- Base64 encoded (not encrypted)

**Recommended** (for production):
- External Secrets Operator with AWS Secrets Manager/Vault
- Secrets encrypted at rest in etcd
- Regular secret rotation (quarterly)

Example with AWS Secrets Manager:
```yaml
apiVersion: external-secrets.io/v1beta1
kind: ExternalSecret
metadata:
  name: afropay-secrets
spec:
  refreshInterval: 1h
  secretStoreRef:
    name: aws-secrets-manager
    kind: SecretStore
  target:
    name: afropay-secrets
  data:
  - secretKey: DATABASE_URL
    remoteRef:
      key: afropay/mainnet/database-url
```

### 2. RBAC

Limit service account permissions:

```yaml
apiVersion: rbac.authorization.k8s.io/v1
kind: Role
metadata:
  name: github-deployer
  namespace: afropay
rules:
- apiGroups: ["apps"]
  resources: ["deployments", "replicasets"]
  verbs: ["get", "list", "watch", "update", "patch"]
- apiGroups: [""]
  resources: ["pods", "services", "configmaps"]
  verbs: ["get", "list"]
- apiGroups: ["batch"]
  resources: ["jobs"]
  verbs: ["get", "create", "delete"]
```

### 3. Network Policies

Restrict pod-to-pod communication:

```yaml
apiVersion: networking.k8s.io/v1
kind: NetworkPolicy
metadata:
  name: api-network-policy
  namespace: afropay
spec:
  podSelector:
    matchLabels:
      app: api
  policyTypes:
  - Ingress
  - Egress
  ingress:
  - from:
    - podSelector:
        matchLabels:
          app: frontend
    ports:
    - protocol: TCP
      port: 3001
  egress:
  - to:
    - podSelector:
        matchLabels:
          app: postgres
    ports:
    - protocol: TCP
      port: 5432
```

## Maintenance

### Monthly Tasks

- [ ] Review deployment logs for patterns/failures
- [ ] Check SBOM reports for vulnerabilities
- [ ] Verify backup/restore procedures
- [ ] Test rollback procedure

### Quarterly Tasks

- [ ] Rotate secrets (JWT_SECRET, ENCRYPTION_KEY)
- [ ] Update service account tokens
- [ ] Review and prune old Docker images
- [ ] Update Kubernetes manifests for new best practices

### Annual Tasks

- [ ] Disaster recovery drill
- [ ] Security audit of deployment pipeline
- [ ] Review and update RBAC policies
- [ ] Kubernetes version upgrade

## Next Steps

After successful setup:

1. ✅ Test deployment pipeline with RC tag
2. ✅ Verify automatic rollback (intentionally deploy broken code)
3. ✅ Document runbook for common issues
4. ✅ Set up monitoring/alerting
5. ✅ Configure log aggregation
6. ✅ Implement backup strategy

## Support

- **Documentation**: [DEPLOYMENT_PIPELINE.md](./DEPLOYMENT_PIPELINE.md)
- **Troubleshooting**: See "Troubleshooting" section above
- **Issue Tracker**: GitHub Issues

---

**Setup completed?** Tag your first release and watch the magic happen! 🚀
