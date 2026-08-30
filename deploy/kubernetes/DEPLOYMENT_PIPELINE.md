# Kubernetes Mainnet Deployment Pipeline

## Overview

Automated deployment pipeline that promotes releases from testnet to mainnet with built-in health checks and automatic rollback on failure. The pipeline is triggered by semantic version tags and ensures zero-downtime deployments with comprehensive validation.

## Architecture

```
┌─────────────────┐
│  Git Tag Push   │
│   (v1.2.3)      │
└────────┬────────┘
         │
         ▼
┌─────────────────────────────────────────────────┐
│         Pre-Deployment Validation               │
│  • Semver tag validation                        │
│  • Required secrets check                       │
│  • Kubernetes manifest validation               │
│  • Environment determination (prod/staging)     │
└────────┬────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────┐
│       Build & Push Docker Images (Parallel)     │
│  • API (NestJS)                                 │
│  • Frontend (Next.js)                           │
│  • Rust Worker                                  │
│  • Python Analytics                             │
│  • Generate SBOMs for each image                │
└────────┬────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────┐
│         Deploy to Mainnet Cluster               │
│  1. Apply ConfigMaps and Secrets                │
│  2. Run database migrations                     │
│  3. Deploy services with RollingUpdate          │
│  4. Apply Ingress rules                         │
└────────┬────────────────────────────────────────┘
         │
         ▼
┌─────────────────────────────────────────────────┐
│      Health Check Gate (5 minutes)              │
│  • Monitor readiness probes every 10s           │
│  • Verify all replicas are ready                │
│  • Check API /health endpoint                   │
│  • Validate pod status                          │
└────────┬────────────────────────────────────────┘
         │
         ├─ SUCCESS ──────────────────────────────┐
         │                                         │
         │                                         ▼
         │                              ┌──────────────────┐
         │                              │ Create Deployment│
         │                              │     Record       │
         │                              └──────────────────┘
         │
         └─ FAILURE ──────────────────────────────┐
                                                   │
                                                   ▼
                                        ┌──────────────────┐
                                        │  Automatic       │
                                        │   Rollback       │
                                        │  (kubectl undo)  │
                                        └──────────────────┘
```

## Trigger Mechanism

### Production Deployments
```bash
git tag v1.2.3
git push origin v1.2.3
```

Triggers deployment to **mainnet** (production environment).

### Staging Deployments (Release Candidates)
```bash
git tag v1.2.3-rc.1
git push origin v1.2.3-rc.1
```

Triggers deployment to **testnet/staging** environment.

### Tag Format Requirements

**Valid tags:**
- `v1.0.0` - Production release
- `v2.5.10` - Production release
- `v1.0.0-rc.1` - Release candidate (staging)
- `v1.0.0-rc.12` - Release candidate (staging)

**Invalid tags:**
- `1.0.0` - Missing 'v' prefix
- `v1.0` - Missing patch version
- `release-1.0.0` - Wrong format
- `v1.0.0-beta` - Must be -rc.N for pre-releases

## Required GitHub Secrets

Configure these secrets in your GitHub repository (`Settings` → `Secrets and variables` → `Actions`):

| Secret Name | Description | Example Value | Required |
|-------------|-------------|---------------|----------|
| `KUBE_CONFIG_MAINNET` | Base64-encoded kubeconfig for mainnet cluster | `<base64 kubeconfig>` | ✅ Yes |
| `KUBE_CONFIG_STAGING` | Base64-encoded kubeconfig for staging cluster | `<base64 kubeconfig>` | ⚠️ If using staging |
| `DOCKER_REGISTRY_TOKEN` | GitHub Container Registry token | `ghp_xxxxx` | ✅ Yes |

### Generating Kubeconfig Secret

```bash
# Encode your kubeconfig
cat ~/.kube/config | base64 -w 0

# Add to GitHub Secrets as KUBE_CONFIG_MAINNET
```

**Security Note**: Use a dedicated service account with minimal permissions (deploy, get, list, watch on deployments, pods, services).

## Pipeline Stages

### 1. Pre-Deployment Validation

**Purpose**: Catch configuration errors before building images.

**Checks:**
- ✅ Tag follows semantic versioning (`v1.2.3` or `v1.2.3-rc.N`)
- ✅ All required secrets are configured
- ✅ Kubernetes manifest YAML syntax is valid
- ✅ Environment is correctly determined (production vs staging)

**Failure Impact**: Entire workflow fails immediately, no images built.

### 2. Build & Push Docker Images

**Purpose**: Create versioned container images for all services.

**Process:**
1. Build images in parallel (4 concurrent jobs)
2. Tag with multiple formats:
   - Semantic version: `v1.2.3`
   - Major.Minor: `v1.2`
   - Major: `v1`
   - Git SHA: `main-abc1234`
   - Latest: `latest` (production only)
3. Push to GitHub Container Registry (`ghcr.io`)
4. Generate SBOM (Software Bill of Materials) for each image

**Caching Strategy:**
- Uses GitHub Actions cache for Docker layers
- Reduces build time from ~5min to ~1min on cache hit

**Image Naming:**
```
ghcr.io/your-org/afropay-stellar-api:v1.2.3
ghcr.io/your-org/afropay-stellar-frontend:v1.2.3
ghcr.io/your-org/afropay-stellar-rust-worker:v1.2.3
ghcr.io/your-org/afropay-stellar-python-analytics:v1.2.3
```

### 3. Deploy to Mainnet Cluster

**Purpose**: Apply updated manifests to Kubernetes cluster.

#### 3.1 Apply ConfigMaps and Secrets
```bash
kubectl apply -f deploy/kubernetes/configmap.yaml
kubectl apply -f deploy/kubernetes/secrets.yaml
```

**Note**: Secrets should be managed externally (HashiCorp Vault, AWS Secrets Manager) in production.

#### 3.2 Run Database Migrations
```bash
# Update migration job with new image
kubectl apply -f deploy/kubernetes/migration-job.yaml

# Wait for completion (5-minute timeout)
kubectl wait --for=condition=complete --timeout=300s job/migration-job
```

**Migration Failure**: Entire deployment aborts, no service updates applied.

#### 3.3 Deploy Services
Services are deployed sequentially with image tag replacement:

```bash
# API
sed -i "s|image:.*|image: ghcr.io/.../api:v1.2.3|g" api.yaml
kubectl apply -f api.yaml

# Frontend
sed -i "s|image:.*|image: ghcr.io/.../frontend:v1.2.3|g" frontend.yaml
kubectl apply -f frontend.yaml

# Rust Worker
sed -i "s|image:.*|image: ghcr.io/.../rust-worker:v1.2.3|g" rust-worker.yaml
kubectl apply -f rust-worker.yaml

# Python Analytics
sed -i "s|image:.*|image: ghcr.io/.../python-analytics:v1.2.3|g" python-analytics.yaml
kubectl apply -f python-analytics.yaml
```

**Rollout Strategy**: `RollingUpdate` with `maxUnavailable: 0` ensures zero downtime.

#### 3.4 Apply Ingress Rules
```bash
kubectl apply -f deploy/kubernetes/ingress.yaml
```

### 4. Health Check Gate (5 Minutes)

**Purpose**: Ensure new deployment is healthy before considering success.

**Monitoring Logic:**
```bash
TIMEOUT=300  # 5 minutes
CHECK_INTERVAL=10  # every 10 seconds

for service in api frontend rust-worker python-analytics; do
  # Check readiness replicas
  DESIRED=$(kubectl get deployment $service -o jsonpath='{.spec.replicas}')
  READY=$(kubectl get deployment $service -o jsonpath='{.status.readyReplicas}')
  
  if [ "$READY" -eq "$DESIRED" ]; then
    echo "✅ $service: healthy"
  else
    echo "⏳ $service: $READY/$DESIRED ready"
    ALL_HEALTHY=false
  fi
done
```

**Success Criteria:**
- All deployments have `readyReplicas == replicas`
- All deployments have `availableReplicas == replicas`
- API `/health` endpoint returns 200 OK
- No pods in Failed/CrashLoopBackOff state

**Failure Criteria:**
- Any service fails readiness check after 5 minutes
- API health endpoint unreachable after 5 minutes
- Any pod crashes during monitoring period

### 5. Automatic Rollback

**Trigger**: Any failure in health check gate.

**Process:**
```bash
for service in api frontend rust-worker python-analytics; do
  kubectl rollout undo deployment/$service -n afropay
  kubectl rollout status deployment/$service --timeout=180s
done
```

**Rollback Strategy:**
- Uses Kubernetes native `rollout undo` (reverts to previous ReplicaSet)
- Rolls back all services simultaneously
- Waits for rollback completion (3-minute timeout per service)
- Workflow fails with clear error message

**Post-Rollback State:**
- All services running previous version
- Deployment record indicates failure
- GitHub Actions logs contain rollback details

## Zero-Downtime Guarantee

### RollingUpdate Configuration
```yaml
strategy:
  type: RollingUpdate
  rollingUpdate:
    maxSurge: 1        # 1 extra pod during update
    maxUnavailable: 0  # No pods terminated until new ones ready
```

**Process:**
1. New pod starts
2. Passes `livenessProbe` (pod is alive)
3. Passes `readinessProbe` (pod can serve traffic)
4. Service routes traffic to new pod
5. Old pod terminates
6. Repeat for remaining replicas

### Health Probe Configuration
```yaml
readinessProbe:
  httpGet:
    path: /health
    port: 3001
  initialDelaySeconds: 15
  timeoutSeconds: 5
  periodSeconds: 15
```

**Behavior:**
- Pod not added to Service endpoints until passing readiness check
- Failed readiness check removes pod from load balancer
- Liveness check restarts pod if health deteriorates

## Deployment Checklist

### Before Creating Release Tag

- [ ] All tests passing in CI (`.github/workflows/ci.yml`)
- [ ] Code reviewed and approved
- [ ] Database migrations tested on staging
- [ ] CHANGELOG.md updated with release notes
- [ ] Version bumped in `package.json`, `Cargo.toml`
- [ ] Secrets synchronized in Kubernetes cluster

### Creating Release Tag

```bash
# Update version
git checkout main
git pull origin main

# Create and push tag
git tag -a v1.2.3 -m "Release v1.2.3: Add KYC document upload"
git push origin v1.2.3
```

### Monitoring Deployment

1. **GitHub Actions**: `https://github.com/your-org/AfroPay-Stellar/actions`
   - Watch workflow progress in real-time
   - View logs for each job

2. **Kubernetes Dashboard** (if enabled):
   ```bash
   kubectl -n afropay get deployments
   kubectl -n afropay get pods
   ```

3. **Application Logs**:
   ```bash
   kubectl -n afropay logs -f deployment/api
   kubectl -n afropay logs -f deployment/frontend
   ```

4. **Health Endpoint**:
   ```bash
   curl https://api.afropay.io/health
   ```

### Post-Deployment Verification

- [ ] Verify version endpoint: `GET https://api.afropay.io/version`
- [ ] Run smoke tests against production API
- [ ] Check error rates in monitoring (Datadog, New Relic, etc.)
- [ ] Verify database migrations applied: Check `prisma_migrations` table
- [ ] Test critical user flows (login, transaction, KYC)

## Rollback Procedures

### Automatic Rollback (Preferred)

Rollback is **automatic** if health checks fail. No manual intervention required.

**Trigger Conditions:**
- Readiness probes fail for 5 minutes
- Pod crashes during deployment
- Migration job fails

**Result**: All services reverted to previous version.

### Manual Rollback

If you need to rollback a successful deployment:

```bash
# Configure kubectl
export KUBECONFIG=~/.kube/config

# Rollback individual service
kubectl rollout undo deployment/api -n afropay
kubectl rollout status deployment/api -n afropay

# Rollback all services
for service in api frontend rust-worker python-analytics; do
  kubectl rollout undo deployment/$service -n afropay
done
```

### Rollback to Specific Version

```bash
# View rollout history
kubectl rollout history deployment/api -n afropay

# Rollback to revision 3
kubectl rollout undo deployment/api -n afropay --to-revision=3
```

## Troubleshooting

### Deployment Fails at Pre-Checks

**Symptom**: Workflow fails before building images.

**Causes:**
- Invalid tag format (doesn't match semver)
- Missing GitHub secrets
- Invalid Kubernetes YAML syntax

**Solution:**
```bash
# Verify tag format
echo "v1.2.3" | grep -E '^v[0-9]+\.[0-9]+\.[0-9]+(-rc\.[0-9]+)?$'

# Validate manifests locally
kubectl apply --dry-run=client -f deploy/kubernetes/*.yaml
```

### Image Build Fails

**Symptom**: Docker build fails during image creation.

**Causes:**
- Dockerfile syntax error
- Missing dependencies
- Build context too large

**Solution:**
- Check Dockerfile for errors
- Review build logs in GitHub Actions
- Test build locally:
  ```bash
  docker build -t test-api -f apps/api/Dockerfile apps/api
  ```

### Migration Job Fails

**Symptom**: Deployment stops after "Running database migrations" step.

**Causes:**
- Migration SQL error
- Database connection issue
- Timeout (>5 minutes)

**Solution:**
```bash
# Check migration job logs
kubectl logs -l job-name=migration-job -n afropay

# Test migrations locally
cd apps/api
DATABASE_URL="postgresql://..." npx prisma migrate deploy
```

### Health Check Timeout

**Symptom**: Deployment fails with "Health check timeout reached (300 seconds)".

**Causes:**
- New code has startup errors
- Readiness probe misconfigured
- Database connection pool exhausted

**Solution:**
```bash
# Check pod logs
kubectl logs -l app=api -n afropay --tail=100

# Check pod status
kubectl describe pod -l app=api -n afropay

# Test health endpoint manually
API_POD=$(kubectl get pod -l app=api -n afropay -o jsonpath='{.items[0].metadata.name}')
kubectl exec -n afropay $API_POD -- curl -v http://localhost:3001/health
```

### Rollback Fails

**Symptom**: Automatic rollback times out or fails.

**Causes:**
- Previous version also has errors
- Insufficient resources in cluster
- Network policy blocking rollback

**Solution:**
```bash
# Check rollout status
kubectl rollout status deployment/api -n afropay

# Force rollback to specific revision
kubectl rollout undo deployment/api -n afropay --to-revision=2

# Emergency: scale down and redeploy
kubectl scale deployment api --replicas=0 -n afropay
kubectl apply -f deploy/kubernetes/api.yaml
kubectl scale deployment api --replicas=2 -n afropay
```

## Security Considerations

### Image Security

- **SBOM Generation**: Every image has a Software Bill of Materials
- **Vulnerability Scanning**: Use tools like Trivy, Snyk, or GitHub's Dependabot
- **Base Images**: Use official, minimal base images (Alpine, Distroless)
- **No Root**: Run containers as non-root user

### Secrets Management

- **Never commit secrets**: Use `.gitignore` for `secrets.yaml`
- **External Secrets**: Integrate HashiCorp Vault or AWS Secrets Manager
- **Rotation**: Rotate secrets quarterly (ENCRYPTION_KEY, JWT_SECRET, etc.)
- **Access Control**: Limit who can read secrets in GitHub/Kubernetes

### Network Security

- **Ingress TLS**: Terminate TLS at Ingress with valid certificates
- **Network Policies**: Restrict pod-to-pod communication
- **Service Mesh**: Consider Istio/Linkerd for mTLS between services

## Performance Optimization

### Build Cache

- **Layer Caching**: Order Dockerfile commands from least to most frequently changed
- **Multi-Stage Builds**: Reduce final image size
- **GitHub Actions Cache**: Persist Docker build cache between runs

### Deployment Speed

- **Parallel Builds**: Build all 4 services simultaneously
- **Pre-Pulled Images**: Use `imagePullPolicy: IfNotPresent` for faster startups
- **Readiness Probe**: Tune `initialDelaySeconds` to match actual startup time

### Resource Allocation

```yaml
resources:
  requests:
    cpu: "250m"      # Minimum guaranteed CPU
    memory: "512Mi"  # Minimum guaranteed memory
  limits:
    cpu: "1"         # Maximum CPU (throttled if exceeded)
    memory: "1Gi"    # Maximum memory (OOMKilled if exceeded)
```

**Tuning Guidelines:**
- Set `requests` to typical usage
- Set `limits` to 2-3x requests
- Monitor actual usage with `kubectl top pods`

## Monitoring and Observability

### Deployment Metrics

Track these metrics for each deployment:

- **Deployment Duration**: Time from tag push to health check pass
- **Rollback Rate**: Percentage of deployments that rollback
- **Image Build Time**: Time to build and push all images
- **Migration Time**: Database migration execution time

### Application Metrics

Monitor after each deployment:

- **Error Rate**: 5xx responses per minute
- **Latency**: p50, p95, p99 response times
- **Throughput**: Requests per second
- **Pod Restarts**: Kubernetes pod crash count

### Alerting

Set up alerts for:

- ⚠️ Deployment failure (rollback triggered)
- ⚠️ Health check timeout
- ⚠️ Migration job failure
- ⚠️ Pod crash loop
- ⚠️ High error rate post-deployment

## Future Enhancements

### Phase 2 (Planned)
- [ ] Canary deployments (10% traffic to new version)
- [ ] Blue-Green deployment strategy
- [ ] Multi-region failover
- [ ] Automated performance testing gate

### Phase 3 (Roadmap)
- [ ] GitOps with ArgoCD/Flux
- [ ] Progressive delivery with Flagger
- [ ] Chaos engineering tests (kill pods during deploy)
- [ ] Cost optimization (spot instances for workers)

## References

- **Kubernetes Deployments**: https://kubernetes.io/docs/concepts/workloads/controllers/deployment/
- **Rolling Updates**: https://kubernetes.io/docs/tutorials/kubernetes-basics/update/update-intro/
- **Health Probes**: https://kubernetes.io/docs/tasks/configure-pod-container/configure-liveness-readiness-startup-probes/
- **GitHub Actions**: https://docs.github.com/en/actions
- **Semantic Versioning**: https://semver.org/

---

**Document Version**: 1.0  
**Last Updated**: August 2026  
**Maintained By**: DevOps Team
