# AfroPay-Stellar Kubernetes Deployment Scaffolding

This directory contains the Kubernetes manifests required to deploy the AfroPay-Stellar stack in a cloud-native environment.

## Directory Structure

*   [namespace.yaml](file:///c:/Users/USER/OneDrive/Documents/GitHub/AfroPay-Stellar/deploy/kubernetes/namespace.yaml) — Defines the `afropay` namespace.
*   [configmap.yaml](file:///c:/Users/USER/OneDrive/Documents/GitHub/AfroPay-Stellar/deploy/kubernetes/configmap.yaml) — Holds non-sensitive environment configuration.
*   [secrets.yaml](file:///c:/Users/USER/OneDrive/Documents/GitHub/AfroPay-Stellar/deploy/kubernetes/secrets.yaml) — Template for sensitive credentials and system keys.
*   [postgres.yaml](file:///c:/Users/USER/OneDrive/Documents/GitHub/AfroPay-Stellar/deploy/kubernetes/postgres.yaml) — StatefulSet and services for local/fallback PostgreSQL.
*   [redis.yaml](file:///c:/Users/USER/OneDrive/Documents/GitHub/AfroPay-Stellar/deploy/kubernetes/redis.yaml) — StatefulSet and services for local/fallback Redis.
*   [api.yaml](file:///c:/Users/USER/OneDrive/Documents/GitHub/AfroPay-Stellar/deploy/kubernetes/api.yaml) — Deployment and Service for the NestJS API.
*   [frontend.yaml](file:///c:/Users/USER/OneDrive/Documents/GitHub/AfroPay-Stellar/deploy/kubernetes/frontend.yaml) — Deployment and Service for the Next.js Frontend.
*   [rust-worker.yaml](file:///c:/Users/USER/OneDrive/Documents/GitHub/AfroPay-Stellar/deploy/kubernetes/rust-worker.yaml) — Deployment and Service for the transaction submission worker.
*   [python-analytics.yaml](file:///c:/Users/USER/OneDrive/Documents/GitHub/AfroPay-Stellar/deploy/kubernetes/python-analytics.yaml) — Deployment and Service for the fraud detection service.
*   [ingress.yaml](file:///c:/Users/USER/OneDrive/Documents/GitHub/AfroPay-Stellar/deploy/kubernetes/ingress.yaml) — Nginx-based Ingress configuration for public-facing route routing.
*   [migration-job.yaml](file:///c:/Users/USER/OneDrive/Documents/GitHub/AfroPay-Stellar/deploy/kubernetes/migration-job.yaml) — One-off database migration execution job.

---

## Required Stack Components for Production

| Component | Required | Production Recommendation | Description |
| :--- | :--- | :--- | :--- |
| **API** | Yes | Multiple replicas behind Load Balancer | Serves client routes, wallet operations, and transaction processing. |
| **Frontend** | Yes | CDN + Multiple replicas | Next.js server rendering and client interactions. |
| **Rust Worker** | Yes | 1-2 replicas scaled by queue load | Processes off-chain queue events and submits Stellar transactions. |
| **PostgreSQL** | Yes | Managed Service (e.g. AWS RDS PostgreSQL 16) | Persistent relational datastore. |
| **Redis** | Yes | Managed Service (e.g. AWS ElastiCache Redis 7) | Event queues, pub/sub, caching. |
| **Python Analytics** | Optional | Replicated only if fraud check is synchronous | Analyzes transactions for suspicious activity. |

---

## Persistent Storage Configuration

The manifests configure local persistent storage for database backups and cache/queue files using standard `volumeClaimTemplates` inside StatefulSets.

1.  **PostgreSQL Data (`postgres-db-data`)**:
    *   **Volume Type**: PersistentVolumeClaim (PVC).
    *   **Size**: Defaults to `20Gi` (increase for production based on transactional volume).
    *   **Access Mode**: `ReadWriteOnce` (RWO).
    *   **StorageClass**: Cloud-native defaults. In production, configure an SSD-backed StorageClass with encryption at rest enabled (e.g. `gp3` on AWS, `premium-rwo` on GCP).
2.  **Redis Data (`redis-data`)**:
    *   **Volume Type**: PersistentVolumeClaim (PVC).
    *   **Size**: Defaults to `10Gi`.
    *   **Access Mode**: `ReadWriteOnce` (RWO).
    *   **Configuration**: Redis is started with the `--appendonly yes` argument to ensure transaction and worker queues in Redis recover gracefully if a container restarts.

### Production Storage Policy

> [!WARNING]
> While StatefulSets with PVCs are provided in `postgres.yaml` and `redis.yaml` for testing/fallback environments, **never deploy stateful relational databases or critical Redis caches directly in Kubernetes for enterprise production** unless you have highly experienced database operators.
>
> **Production Best Practices:**
> *   Decommission the `postgres` and `redis` StatefulSets.
> *   Provision cloud-managed database instances (e.g. AWS RDS PostgreSQL with multi-AZ replication, AWS ElastiCache for Redis).
> *   Point the API and Rust worker to the managed services by updating the connections inside `secrets.yaml`.

---

## Production-Ready Assumptions

1.  **Secrets Management**:
    *   Inject secrets using `afropay-secrets`. Do not commit actual passwords or keys to git.
    *   For production, integrate an external secrets provider like **HashiCorp Vault**, **AWS Secrets Manager**, or **SealedSecrets** using an agent injector or `ExternalSecrets` controller.
2.  **Encryption Key**:
    *   The `ENCRYPTION_KEY` secret is critical. It must be exactly 32 random bytes encoded as 64 hex characters (generated using `openssl rand -hex 32`). Back up this key securely. Re-generating it will break access to all existing encrypted user wallet data.
3.  **High Availability**:
    *   Replicas for `api`, `frontend`, and `python-analytics` are set to `2` by default.
    *   `RollingUpdate` strategy ensures zero downtime during application upgrades.
4.  **Database Migration**:
    *   Do not run migrations within the API container startup hook.
    *   Run migrations as a separate job (`migration-job.yaml`) prior to updating the API/worker deployment image tag.
5.  **Health Probes**:
    *   Probes use HTTP `/health` checks where possible. If `/health` endpoints are not fully implemented or require special access tokens, fallback to `tcpSocket` probes targeting the listen ports.
6.  **TLS Termination**:
    *   The Ingress resource assumes an external Ingress controller (e.g., NGINX Ingress) is running, and targets a secret named `afropay-tls` for SSL/TLS certificates.

---

## Deploying the Stack

To deploy the manifests to your cluster:

```bash
# 1. Create the namespace
kubectl apply -f namespace.yaml

# 2. Configure environment and secret templates (Update actual values first!)
kubectl apply -f configmap.yaml
kubectl apply -f secrets.yaml

# 3. Deploy databases (optional, or use managed equivalents)
kubectl apply -f postgres.yaml
kubectl apply -f redis.yaml

# 4. Run database migrations
kubectl apply -f migration-job.yaml

# 5. Deploy application components
kubectl apply -f api.yaml
kubectl apply -f frontend.yaml
kubectl apply -f rust-worker.yaml
kubectl apply -f python-analytics.yaml

# 6. Apply Ingress routing rules
kubectl apply -f ingress.yaml
```
