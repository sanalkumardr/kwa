# Deploying KWA Pipeline Works

End-to-end runbook: local first (to prove it on your machine), then production on
Kubernetes. Commands assume you're at the repo root. Many are wrapped in the
`Makefile` — `make help` lists them.

The one invariant across every environment: **the app connects as the
non-superuser `kwa_app` role.** Superusers bypass row-level security even when
forced, so connecting as anything else silently defeats the whole access model.

---

## 0. First push to a repo

Run these from the project root (`cd` into it first), one line at a time.
Replace the example URL with your real repo URL — do **not** keep the angle
brackets, `< >` are shell redirection operators and will error in zsh/bash.

```bash
cd ~/Claude/Projects/kwa      # the project folder, not your home dir
git init
git add .
git commit -m "KWA Pipeline Works — initial commit"
git branch -M main
git remote add origin https://github.com/yourname/kwa.git   # your real URL
git push -u origin main
```

`.gitignore` already excludes `node_modules`, `dist`, `.env`, and Flutter build
output (tracked footprint is ~1.2 MB). On push, GitHub Actions runs the full test
suite against a PostgreSQL + PostGIS service — that's your first real end-to-end
validation.

---

## 1. Local (Docker) — prove it works

```bash
make up            # db (Postgres+PostGIS) + migrate + api on :3000
```

This provisions `kwa_app` + the `kwa`/`kwa_test` databases, applies migrations
001–005 (skipping the demo seed in prod, applying it locally), and starts the
API. Then:

```bash
make token                              # mint a dev JWT (EE Menon)
curl -s localhost:3000/health/ready     # {"status":"ready","db":"up"}
curl -s localhost:3000/projects -H "Authorization: Bearer $(make -s token)" | jq
```

Run the integration tests against the containerized DB:

```bash
make test          # uses kwa_test; RLS/immutability/money-chain/chainage specs
```

Tear down (add `-v` to wipe data): `make down` / `make reset`.

---

## 2. Load real baseline data

Replace the samples with a real KWA SOR export and route KML, then:

```bash
DATABASE_URL=postgres://kwa_app:****@localhost:5432/kwa \
  node backend/scripts/seed/seed.js path/to/your-manifest.json
```

See `backend/scripts/seed/README.md` for the manifest + file formats. Org units,
users, and projects must exist first (migrations / your bootstrap).

---

## 3. Production (Kubernetes)

Full detail in `k8s/README.md`; the shape:

**a. Provision the database** (managed Postgres+PostGIS recommended). A DBA
creates the role/db/extensions once:

```sql
CREATE ROLE kwa_app LOGIN PASSWORD '****';   -- NOT a superuser
CREATE DATABASE kwa OWNER kwa_app;
\connect kwa
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pgcrypto;
```

**b. Build & push the image** (pin a tag; don't ship `:latest`):

```bash
docker build -t <registry>/kwa-backend:<tag> backend
docker push <registry>/kwa-backend:<tag>
# set that image in k8s/deployment.yaml
```

**c. Create the real secret** (never commit it):

```bash
kubectl create secret generic kwa-secrets \
  --from-literal=DATABASE_URL='postgres://kwa_app:****@db-host:5432/kwa' \
  --from-literal=JWT_SECRET="$(openssl rand -hex 32)" \
  --from-literal=SMS_GATEWAY_URL='https://sms.gateway.gov.in/send' \
  --from-literal=SMS_GATEWAY_API_KEY='****' \
  --from-literal=S3_ACCESS_KEY_ID='****' \
  --from-literal=S3_SECRET_ACCESS_KEY='****'
```

**d. Apply config + run migrations** (the Job skips the demo seed):

```bash
kubectl apply -f k8s/config.yaml
kubectl create configmap kwa-migrations --from-file=migrations/ \
  -o yaml --dry-run=client | kubectl apply -f -
kubectl apply -f k8s/migrate-job.yaml
kubectl wait --for=condition=complete job/kwa-migrate --timeout=120s
```

**e. Deploy the app**:

```bash
kubectl apply -f k8s/deployment.yaml -f k8s/service.yaml -f k8s/hpa.yaml -f k8s/ingress.yaml
# With S3 (config default) that's all. For STORAGE_PROVIDER=local instead:
# apply uploads-pvc.yaml, uncomment the uploads volume/mount in deployment.yaml,
# and set replicas: 1 (the PVC is ReadWriteOnce).
```

**f. Smoke test**:

```bash
kubectl rollout status deploy/kwa-api
kubectl port-forward svc/kwa-api 8080:80 &
curl -s localhost:8080/health/ready     # readiness gates traffic on DB reachability
```

---

## 4. Mobile app

```bash
cd mobile
flutter pub get
flutter build apk --dart-define=KWA_API_BASE_URL=https://api.kwa.example.gov.in
```

Distribute the APK (Play Console / MDM). Add the platform permissions noted in
`mobile/README.md` (location + camera).

---

## 5. Config reference

| Where | Key | Notes |
|---|---|---|
| Secret | `DATABASE_URL` | `kwa_app` role, never a superuser |
| Secret | `JWT_SECRET` | 32+ random bytes |
| Secret | `SMS_GATEWAY_*` | OTP + milestone alerts |
| Secret | `S3_*` | omit to use an instance role / IRSA |
| Config | `STORAGE_PROVIDER` | `s3` (prod) or `local` |
| Config | `SMS_PROVIDER` | `http` (prod) or `log` |
| Config | `OTP_DEV_ECHO` | must be `false` in prod |
| Config | `SYSTEM_USER_ID` | admin w/ authority-wide scope, for the daily alert cron |

---

## 6. Rollback

- **App:** `kubectl rollout undo deploy/kwa-api` (image is the only moving part).
- **Migrations:** forward-only. To reverse a bad migration, ship a new one that
  compensates — never edit an applied file. Data is soft-deleted, never lost.
- **Graceful drain:** the app closes its DB pool on SIGTERM, so rolling deploys
  don't drop in-flight requests.
