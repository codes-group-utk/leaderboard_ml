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
