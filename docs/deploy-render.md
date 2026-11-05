# Deploying VerdictPay to Render

Two Docker web services from one blueprint: an API (FastAPI, simulator gateway by
default) and a web app (Next.js). No PayPal account, database, or object store is
required — the API seeds its own deterministic demo data on boot.

---

## Option A — Blueprint deploy (about 5 minutes, no CLI)

1. Push this repo to GitHub (**already done** — `main` is the deploy source).
2. Open <https://dashboard.render.com/blueprints> and click **New Blueprint Instance**.
3. Connect the repository `Divyanshu-kumar14/Verdict-Pay`.
   Render reads `render.yaml` from the repo root.
4. It will show two services and one env group. For each `sync: false` value Render
   prompts you inline — you only have to fill **one**:

   | Prompt | Service | What to put |
   |---|---|---|
   | `VERDICTPAY_API_KEY` | shared group | any random string, e.g. `openssl rand -hex 24`. Both services inherit it. |
   | `NEXT_PUBLIC_VERDICTPAY_API_KEY` | verdictpay-web | **the same string**, because the browser sends it as `X-API-Key` |
   | `PAYPAL_CLIENT_ID` / `SECRET` / `WEBHOOK_ID` | verdictpay-api | **leave empty.** They are optional; simulator mode is the default. |
   | `OPENAI_API_KEY` | verdictpay-api | leave empty. The narrative falls back to the deterministic template. |

   The two secrets that must match are the API key pair. The signing and webhook
   secrets are generated once by Render and shared automatically.

5. Click **Apply**. First build takes ~4-6 minutes per service.
6. When both are live, open `https://<your-web-service>.onrender.com`.

## Option B — CLI

```bash
npm i -g @renderinc/cli        # or: brew install render-oss/render/render
render login                   # opens a browser to authorise
render blueprint launch        # from the repo root; reads render.yaml
```

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
  -d '{"type":"web","name":"verdictpay-api","ownerId":"<id>","repo":"https://github.com/Divyanshu-kumar14/Verdict-Pay","branch":"main","autoDeploy":"yes","serviceDetails":{"env":"docker","plan":"free","region":"oregon","healthCheckPath":"/api/v1/health","dockerfilePath":"./backend/Dockerfile","dockerContext":"."}}'
```

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

Then put the web URL into [docs/submission.md](submission.md) as the hosted demo,
which closes one of the two remaining hackathon items.

## What is NOT deployed

- **The demo video** (< 3 min, required by the hackathon) does not exist yet.
- **Elastic, Supabase** — optional adapters, not wired into the demo path.
- **PayPal live mode** — the deploy defaults to `PAYPAL_MODE=simulator`. To use the
  sandbox, set the three `PAYPAL_*` values and change `PAYPAL_MODE` to `live`.
