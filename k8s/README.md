# KWA Pipeline Works — Kubernetes manifests

Plain manifests to run the API on a cluster. They assume a **managed/external
Postgres+PostGIS** (recommended for government data) reached via the Secret;
the app connects as the non-superuser `kwa_app` role so RLS binds.

## Files

| File | What |
|---|---|
| `config.yaml` | Non-secret runtime config (ConfigMap) |
| `secret.example.yaml` | Shape of the Secret — **create the real one out-of-band** |
| `deployment.yaml` | API Deployment (2 replicas), liveness/readiness probes, resources |
| `service.yaml` | ClusterIP Service (:80 → :3000) |
| `ingress.yaml` | nginx Ingress (set your host + TLS) |
| `hpa.yaml` | HorizontalPodAutoscaler (CPU 70%, 2–6 pods) |
| `uploads-pvc.yaml` | PVC for local-disk uploads (prefer S3 in prod) |
| `migrate-job.yaml` | One-off Job applying migrations as `kwa_app` |

## Prerequisites (one-time, by a DBA)

The migrations run as `kwa_app`, so the role, database, and extensions must
exist first — the same bootstrap as local Docker's `db/init/00_init.sh`:

```sql
CREATE ROLE kwa_app LOGIN PASSWORD '****';
CREATE DATABASE kwa OWNER kwa_app;
\connect kwa
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
```

## Deploy

```bash
# 1. real secret (never commit it)
kubectl create secret generic kwa-secrets \
  --from-literal=DATABASE_URL='postgres://kwa_app:****@db-host:5432/kwa' \
  --from-literal=JWT_SECRET="$(openssl rand -hex 32)" \
  --from-literal=SMS_GATEWAY_URL='https://sms.gateway.gov.in/send' \
  --from-literal=SMS_GATEWAY_API_KEY='****'

# 2. config
kubectl apply -f config.yaml

# 3. migrations as a ConfigMap (re-create whenever migrations change)
kubectl create configmap kwa-migrations --from-file=../migrations/ \
  -o yaml --dry-run=client | kubectl apply -f -
kubectl apply -f migrate-job.yaml
kubectl wait --for=condition=complete job/kwa-migrate --timeout=120s

# 4. app
kubectl apply -f uploads-pvc.yaml -f deployment.yaml -f service.yaml -f hpa.yaml -f ingress.yaml
```

The migrate Job applies `001/002/004/005` and **skips `003_seed_demo`** (demo
data only). Build and push the API image first (tag it; don't ship `:latest`):

```bash
docker build -t <registry>/kwa-backend:<tag> backend
docker push <registry>/kwa-backend:<tag>
# then set that image in deployment.yaml
```

## Probes

`deployment.yaml` points the **liveness** probe at `/health` and the
**readiness** probe at `/health/ready` (which checks the DB), so a pod is only
sent traffic once its database connection is live, and rolling deploys drain via
the app's SIGTERM shutdown hook.

## Production notes

- Swap the uploads PVC for S3-compatible object storage (the upload controller
  is isolated for this).
- Use a sealed-secrets / external-secrets operator rather than raw Secrets.
- Set `SMS_PROVIDER=http` (already in `config.yaml`) and keep `OTP_DEV_ECHO=false`.
- Pin the image to an immutable tag/digest.
