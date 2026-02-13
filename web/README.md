# Leaderboard Web Skeleton

This scaffold uses:
- `web/frontend` -> static site for GitHub Pages
- `web/worker` -> Cloudflare Worker API + D1 database
- `post_process_and_benchmark/publish_daily_cases.py` -> publishes hidden answers + public case data

## 1) Create Cloudflare D1 and deploy Worker

From `web/worker`:

```bash
cd web/worker
npm i -g wrangler
wrangler login
wrangler d1 create leaderboard
```

Copy the generated `database_id` into `web/worker/wrangler.toml`.

Run schema migration:

```bash
wrangler d1 execute leaderboard --remote --file=schema.sql
```

Set admin token secret:

```bash
wrangler secret put ADMIN_TOKEN
```

Set CORS origin in `wrangler.toml`:
- `CORS_ORIGIN = "https://<your-user>.github.io"`

Deploy API:

```bash
wrangler deploy
```

You will get a worker URL like `https://leaderboard-api.<subdomain>.workers.dev`.

## 2) Configure frontend API URL

Edit `web/frontend/config.js`:

```js
window.API_BASE_URL = "https://leaderboard-api.<subdomain>.workers.dev/api";
```

## 3) Deploy frontend to GitHub Pages

Push to `main`. Workflow `.github/workflows/deploy_pages.yml` publishes `web/frontend`.

In GitHub repo settings:
- Pages -> Source: `GitHub Actions`

## 4) Publish daily cases (hidden CL/CD kept server-side)

After running `driver.py` and producing a CSV:

```bash
python post_process_and_benchmark/publish_daily_cases.py \
  --csv data/daily_cases.csv \
  --api-base https://leaderboard-api.<subdomain>.workers.dev \
  --admin-token <ADMIN_TOKEN> \
  --date 2026-02-12
```

This writes all cases into D1 including hidden `cl/cd`.
The public site only receives non-secret fields via `/api/cases/today`.

## 5) Daily automation

Workflow `.github/workflows/daily_publish_cases.yml` is included.
It expects a self-hosted runner with ADflow installed (`runs-on: [self-hosted, adflow]`).

Set repository secrets:
- `LEADERBOARD_API_BASE` = `https://leaderboard-api.<subdomain>.workers.dev`
- `LEADERBOARD_ADMIN_TOKEN` = same token used for `ADMIN_TOKEN`

## API Endpoints

- `GET /api/health`
- `GET /api/cases/today?date=YYYY-MM-DD`
- `POST /api/submissions`
- `GET /api/leaderboard?date=YYYY-MM-DD&limit=20`
- `POST /api/admin/publish` (Bearer token required)

## Submission Rules in this skeleton

- Name and email required
- One submission per email per day
- Score per case: `max(0, 100 - 50*(CL_rel_err + CD_rel_err))`
- Correct case: `CL_rel_err <= 0.03` and `CD_rel_err <= 0.05`

You can tune this directly in `web/worker/src/index.js`.

## Daily Automation (Challenge + End-of-Day Snapshot)

Two scripts are now available:

1. `post_process_and_benchmark/create_daily_challenge.py`
- Runs random simulations using `driver.py`
- Publishes the day challenge to API (`/api/admin/publish`)
- Archives results under `data/daily_challenges/<YYYY-MM-DD>/`

2. `post_process_and_benchmark/fetch_leaderboard_snapshot.py`
- Fetches leaderboard (`/api/leaderboard`)
- Saves JSON+CSV snapshot under `data/leaderboard_snapshots/<YYYY-MM-DD>/`

### Manual run commands

```bash
# Morning challenge generation + publish
python post_process_and_benchmark/create_daily_challenge.py \
  --api-base "$LEADERBOARD_API_BASE" \
  --admin-token "$LEADERBOARD_ADMIN_TOKEN" \
  --date "$(date -u +%F)" \
  --num-cases 10 \
  --batch-size 10

# End-of-day leaderboard snapshot
python post_process_and_benchmark/fetch_leaderboard_snapshot.py \
  --api-base "$LEADERBOARD_API_BASE" \
  --date "$(date -u +%F)" \
  --out-dir data/leaderboard_snapshots
```

### What must be configured

- Repository secrets for workflow mode:
  - `LEADERBOARD_API_BASE`
  - `LEADERBOARD_ADMIN_TOKEN`
- A self-hosted GitHub runner with label `adflow` must be online.
- `driver.py` and simulation assets (`GRID`, `simulation`, etc.) must be available on the runner checkout path.

If you intentionally keep simulation assets untracked in Git, run the above scripts via local cron/systemd on your machine instead of GitHub-hosted checkout.

### Optional repository variables (for untracked local simulation assets)

If `driver.py`, `GRID`, and `simulation` are not committed to GitHub,
set these **Repository Variables** (`Settings -> Secrets and variables -> Actions -> Variables`):

- `LEADERBOARD_LOCAL_REPO_ROOT`
  - Absolute path on runner machine containing your full local assets.
  - Example: `/home/rohit/Desktop/leaderboard_ml`
- `LEADERBOARD_SNAPSHOT_DIR` (optional)
  - Absolute path for end-of-day snapshots.
  - Example: `/home/rohit/Desktop/leaderboard_ml/data/leaderboard_snapshots`

### Local cron alternative (no GitHub runner needed)

If your PC stays on 24/7, you can schedule both jobs directly via `crontab -e`:

```cron
# Daily challenge generation/publish at 13:07 UTC
7 13 * * * cd /home/rohit/Desktop/leaderboard_ml && LEADERBOARD_ADMIN_TOKEN="<TOKEN>" python post_process_and_benchmark/create_daily_challenge.py --api-base "https://leaderboard-api.airfoil-leaderboard.workers.dev" --date "$(date -u +\%F)" --repo-root /home/rohit/Desktop/leaderboard_ml >> data/cron_create.log 2>&1

# End-of-day leaderboard snapshot at 23:59 UTC
59 23 * * * cd /home/rohit/Desktop/leaderboard_ml && python post_process_and_benchmark/fetch_leaderboard_snapshot.py --api-base "https://leaderboard-api.airfoil-leaderboard.workers.dev" --date "$(date -u +\%F)" --out-dir /home/rohit/Desktop/leaderboard_ml/data/leaderboard_snapshots >> data/cron_snapshot.log 2>&1
```
