# Deploying VerdictPay to Render

Two Docker web services from one blueprint: an API (FastAPI, `PAYPAL_SANDBOX` by
default; requires PayPal sandbox credentials) and a web app (Next.js). A PayPal sandbox app is
required; no database or object store is. The API seeds its own demo data on boot once credentials are set.

## Live deployment (this repository)

Both services are deployed and verified on Render's free plan:

| Service | URL | Health check |
|---|---|---|
| API | <https://verdictpay-api.onrender.com> | `/api/v1/health` |
| Web | <https://verdictpay-web.onrender.com> | `/` |

Auto-deploy is on for `main`, so a push redeploys both. The environment (API key,
signing secret, webhook secret) lives in Render, not in the repo.

**Cold start:** the free plan sleeps after ~15 minutes idle. Warm the API first
(<https://verdictpay-api.onrender.com/api/v1/health>), then open the web app.

---

## Option A — Blueprint deploy (about 5 minutes, no CLI)

1. Push this repo to GitHub (**already done** — `main` is the deploy source).
2. Open <https://dashboard.render.com/blueprints> and click **New Blueprint Instance**.
3. Connect the repository `Divyanshu-kumar14/Verdict-Pay`.
   Render reads `render.yaml` from the repo root.
4. It will show two services and one env group. For each `sync: false` value Render
   prompts you inline:

   | Prompt | Service | What to put |
   |---|---|---|
   | `VERDICTPAY_API_KEY` | shared group | any random string, e.g. `openssl rand -hex 24`. Both services inherit it. |
   | `NEXT_PUBLIC_VERDICTPAY_API_KEY` | verdictpay-web | **the same string**, because the browser sends it as `X-API-Key` |
   | `PAYPAL_SANDBOX_CLIENT_ID` / `PAYPAL_SANDBOX_CLIENT_SECRET` (or `PAYPAL_CLIENT_ID` / `PAYPAL_CLIENT_SECRET`) | verdictpay-api | **required.** Your PayPal sandbox app's REST credentials. Without them the API boots with an `UnconfiguredGateway`: `/health` reports `unconfigured` with named blockers and payment calls return 502. |
   | `PAYPAL_SANDBOX_WEBHOOK_ID` (or `PAYPAL_WEBHOOK_ID`) | verdictpay-api | the id of a sandbox webhook pointing at `https://verdictpay-api.onrender.com/api/v1/webhooks/paypal`. Needed to receive real dispute webhooks; without it incoming PayPal webhooks are rejected. |
   | `GEMINI_API_KEY` | verdictpay-api | optional. Without it the dispute AI runs a labelled deterministic fallback. |
   | `OPENAI_API_KEY` | verdictpay-api | leave empty. The narrative falls back to the deterministic template. |

   The two secrets that must match are the API key pair. The signing and webhook
   secrets are generated once by Render and shared automatically.
   `PAYPAL_MODE` is fixed to `PAYPAL_SANDBOX` by `render.yaml`. Do not set it to
   `LOCAL_SIMULATOR` in the dashboard: that mode no longer exists and fails config
   validation, so the API would crash on boot.

5. Click **Apply**. First build takes ~4-6 minutes per service.
6. When both are live, open `https://<your-web-service>.onrender.com`.

## Option B — CLI

```bash
npm i -g @renderinc/cli        # or: brew install render-oss/render/render
render login                   # opens a browser to authorise
render workspace set <team-id>
render services create --name verdictpay-api --type web_service \
  --repo https://github.com/Divyanshu-kumar14/Verdict-Pay --branch main \
  --runtime docker --plan free --region oregon \
  --health-check-path /api/v1/health --confirm
```

`render blueprint launch` does **not** exist in CLI v2.35.0 — the blueprint command
group only ships `validate`. Creating the two services individually (CLI or API)
and letting `render.yaml` document the intended shape is the supported path.

## Option C — API (if you want me to drive it)

Render's REST API can do the whole deploy. Give me a token and I will create the
services, set the env, trigger the first deploy and report the URLs:

1. <https://dashboard.render.com/u/settings#api-keys> -> **Create API Key**
2. Paste it here and I will run the calls with `curl`.

Minimum viable calls (for reference — `ownerId` is your Render workspace id):

```bash
curl -s https://api.render.com/v1/owners -H "Authorization: Bearer $RENDER_API_KEY"
curl -s -X POST https://api.render.com/v1/services \
  -H "Authorization: Bearer $RENDER_API_KEY" -H "Content-Type: application/json" \
  -d '{"type":"web_service","name":"verdictpay-api","ownerId":"<id>","repo":"https://github.com/Divyanshu-kumar14/Verdict-Pay","branch":"main","autoDeploy":"yes","serviceDetails":{"env":"docker","plan":"free","region":"oregon","healthCheckPath":"/api/v1/health","envSpecificDetails":{"dockerfilePath":"./backend/Dockerfile","dockerContext":"."}}}'
```

Two shapes that are easy to get wrong:

- The runtime goes in `serviceDetails.env` (**not** a top-level `runtime` or `env`).
  A top-level key is ignored and the call fails with
  `invalid runtime: . valid runtimes are: [docker, elixir, go, node, python, ruby, rust, image]`.
- `PUT /v1/services/{id}/env-vars` takes a **raw JSON array** of `{"key","value"}`.
  Wrapping it as `{"envVars":[...]}` returns `{"message":"invalid JSON"}`.

Do not put shell wrappers in Render's Docker **command** override: Render passes the
string through unparsed, so `sh -c "a; b"` runs as one not-found word and the
container exits 127. The seed-and-serve command belongs in the image's own `CMD`
(see `backend/Dockerfile`), which keeps `docker run`, Compose and Render identical.

A token is a full-account credential: scoped access is better than a broad key.

---

## The one thing that can bite you

`NEXT_PUBLIC_*` is baked into the browser bundle **at build time**, so the web
service cannot discover the API URL at runtime. The blueprint assumes the default
service names, giving `https://verdictpay-api.onrender.com`.

**If Render tells you either name is already taken**, it appends a suffix (for
example `verdictpay-api-a1b2`). Then:

1. Edit the API's `NEXT_PUBLIC_API_BASE_URL` and `VERDICTPAY_API_BASE_URL` in
   `render.yaml` (or the dashboard) to the API's real URL.
2. **Redeploy** the web service — a plain restart will not rebuild the bundle.

`ALLOWED_ORIGINS` does not have this problem: it reads the web service's own
`RENDER_EXTERNAL_URL`, so CORS self-configures whatever suffix you get.

## Storage behaviour

The free plan has no persistent disk, so the SQLite file lives on the container
and **resets on every deploy or restart**. That is deliberate: each visit starts
from a freshly seeded, deterministic dataset, which is what a judge demo wants.

For durable data either attach a paid disk mounted at `/app/data`, or move to
Postgres — which needs `asyncpg` added to `backend/pyproject.toml` first, since it
is not currently a dependency.

## Free-plan behaviour to expect

- Services **sleep after ~15 minutes idle**. The first request after that takes
  30-60 seconds while the container starts. Open the API health URL first to warm
  it, then the web app.
- 512 MB RAM each. The images are small; the frontend build is the memory-hungry
  step and it runs on Render's builders, not the runtime instance.

## After it is live

```bash
# API is up and seeded
curl -s https://<api>.onrender.com/api/v1/health
curl -s -H "X-API-Key: <your key>" https://<api>.onrender.com/api/v1/disputes | head -c 300

# the UI
open https://<web>.onrender.com
```

The web URL is recorded in the README as the hosted demo.

## What is NOT deployed

- **Elastic, Supabase** — optional adapters, not wired into the demo path.
- **PayPal Live** — the only modes are `PAYPAL_SANDBOX` (the default locally and in
  `render.yaml`) and `PAYPAL_LIVE`. The deploy talks to the real PayPal sandbox once
  `PAYPAL_SANDBOX_CLIENT_ID` / `PAYPAL_SANDBOX_CLIENT_SECRET` (or `PAYPAL_CLIENT_ID` /
  `PAYPAL_CLIENT_SECRET`) are set; without them the API boots as `UnconfiguredGateway`
  (health names blockers, payment calls 502). `PAYPAL_LIVE` additionally requires
  `ALLOW_PAYPAL_LIVE=true` and is not used by this deployment.
