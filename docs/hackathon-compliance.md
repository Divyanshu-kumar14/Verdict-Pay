# Hackathon compliance audit — PayPal AI Hackathon

Audited on **2026-11-06** against the public hackathon page and the repository at
`main`.

**Sources**
- https://paypalaihackathon.devpost.com/ — read via a reader proxy because Devpost serves a
  Cloudflare challenge to automated clients. Main-page requirements below are quoted from that read.
- https://paypalaihackathon.devpost.com/rules — **not verifiable**: returns HTTP 403 (Cloudflare
  "Enable JavaScript and cookies"). Eligibility, team size, regional exclusions and IP terms live
  there and must be confirmed by a human in a browser before submitting.
- Submission window: **Oct 01 – Nov 12, 2026** (the page reported "7 days left" on 2026-11-06).

---

## 1. What the hackathon requires (verified)

> "Your project must meaningfully use both PayPal and AI."
> "Meaningfully integrate at least one PayPal technology, API, SDK, product, or developer
> capability … meaningfully incorporate AI into the experience or functionality … demonstrate a
> working prototype … be sufficiently documented … comply with the Official Rules."
> "Projects can be built individually or as a team. They can be new or existing projects, as long
> as you make meaningful progress on the project during the course of the hackathon."

Submission package:

1. Project entry.
2. Text description.
3. Functional demo — judges must be able to run/interact. Either complete setup instructions in
   the repo **or** a hosted URL. A mockup/non-functional demo does not count.
4. **Tools** — identify which models/AI services were used and how.
5. **Public** GitHub/GitLab/Bitbucket repo containing all source, assets and instructions, open
   source, **license visible at the top of the repo (About section)**.
6. **Demo video under 3 minutes**, showing the project functioning, public on YouTube, no
   third-party trademarks or copyrighted music without permission.

Judging: Technological Implementation · Design · Potential Impact · Innovation/Idea · Presentation.

---

## 2. Requirement-by-requirement status

| # | Requirement | Status | Evidence | Action |
|---|---|---|---|---|
| 1 | PayPal integration is central | **PASS** | Real clients for Disputes v1 (get/list/send-message/make-offer/accept-claim/provide-evidence/require-evidence), Orders v2 create/get/capture, Subscriptions v1 suspend, Reporting v1 transaction search, webhook signature verification — `backend/app/integrations/paypal/live.py`. `LOCAL_SIMULATOR` satisfies the same `PayPalGateway` protocol. A live sandbox OAuth2 token and a real order (`0BN11980TR384063M`) are proven in `artifacts/paypal-sandbox-proof.json`. | Run `backend/scripts/verify_paypal_sandbox.py --wait-for-approval 120` before recording to complete the capture by hand. |
| 2 | AI is meaningful | **PASS** | Gemini (`GEMINI_MODEL`, default `gemini-2.5-flash`) classifies the buyer claim and drafts the rebuttal from a locked fact pack; a deterministic validator rejects any invented number or date; failures degrade to a keyword classifier and template with `degraded=true` plus a reason. Dossier footer stamps `Narrative source: ai:<model>` or `template`. See [ai-disclosure.md](ai-disclosure.md). | **Record the video with `GEMINI_API_KEY` set** so step 6 shows the live model path. |
| 3 | Working prototype | **PASS** | `make test` runs the backend pytest, frontend vitest and SDK suites; `make demo` asserts the full judge flow end to end; every UI route renders real API data. Run them for current counts rather than quoting a fixed number. | — |
| 4 | Documented | **PASS** | README, architecture, ADRs, API surface, demo script. | — |
| 5 | Judges can run it | **PASS** | `make stack` (no keys) or `docker compose up --build`; both verified in this repo. | — |
| 6 | Public repo + license in About | **PASS** | GitHub API reports `visibility: public`, `license: MIT`; `LICENSE` at the root. | Repository description/topics set for clarity. |
| 7 | Text description | **READY** | `docs/submission.md` (copy-paste). | Paste into the Devpost form. |
| 8 | Tools field | **READY** | `docs/submission.md` lists runtime AI tools and development tools. | Paste; keep the AI-assistance disclosure line. |
| 9 | Functional demo | **PASS** | Local run instructions are complete and tested (`make stack` + `make web`, or `docker compose up --build`). A hosted fallback at <https://verdictpay-web.onrender.com> is documented in the README; it sleeps on the free tier, so warm `/api/v1/health` first. | — |
| 10 | Demo video < 3 min, YouTube | **MISSING** | Shot-by-shot script exists in `docs/demo.md` and `docs/submission.md`. | **Record and upload before Nov 12.** |
| 11 | New work / meaningful progress in window | **PASS** | All implementation commits are dated 2026-11-05/06, inside Oct 01 – Nov 12. The concept brief predates; the code does not. | — |
| 12 | Official Rules (eligibility, regions, team, IP) | **UNVERIFIED** | Rules page is Cloudflare-gated. | Confirm in a browser: 18+, excluded regions, team size, IP/publicity terms. |

---

## 3. Contradictions found and fixed in this pass

| Was | Risk | Fix |
|---|---|---|
| The original concept brief (an internal document, no longer published) advertised a hosted demo at `verdictpay.onrender.com` that does not exist, plus Bryntum/AG Studio runtimes that are not bundled. | A judge clicking the link finds nothing; credibility damage against "working prototype" and "presentation". | The concept brief is no longer published; the public README is the single source of truth and documents `make install && make stack && make web`. |
| AI was real but invisible: the default path uses the deterministic template and the model only runs with a key. | Could be judged as "no AI". | Added first-class local AI (`LLM_BASE_URL`/`LLM_MODEL`, Ollama, no key), AI provenance stamped in the dossier footer, and an explicit README section describing what the AI does and does not own. |
| README claimed Elastic mirrors documents and that ingestion is rate-limited; neither was wired. | Overclaiming in a judged deliverable. | Rate limiting is now implemented and tested; the Elastic claim is corrected to "optional adapter, not on the demo path". |
| `YYYY-MM-DD`-style claims about the EV cliff did not match the seeded data (no recent sales → no $30 fee). | Demo numbers would not show the differentiator. | Seed now creates 200 trailing-90-day sales; the third dispute genuinely crosses 1.5% and the UI shows the $30 fee with a $90 penalty. |
| No AI provenance meant a template draft and a model draft looked identical. | Judges cannot tell whether a model was involved. | Dossier footer now says `Narrative source: template` or `Narrative source: ai:<model>`, and states that facts were locked before generation. |

---

## 4. Honest gaps (must be done by a human)

- [ ] **Record the demo video (< 3:00), upload to YouTube public, add the link to the form.**
      Use `docs/submission.md` shot list. Show the AI narrative being generated (local Ollama or a key)
      so requirement 2 is visibly satisfied.
- [ ] **Read the Official Rules in a browser** and confirm age, country/region eligibility, team
      size, and IP/publicity terms. Devpost's standard rules exclude some regions and require 18+.
- [ ] **Run `make verify-live`** with real PayPal sandbox credentials and keep the output as
      evidence that the live integration works (the repo ships a simulator by default).
- [ ] **Paste `docs/submission.md`** into the Devpost form (project name, tagline, built-with,
      description, tools, video link, repo link).
- [ ] Confirm the video contains **no third-party logos or music**. The repo itself ships no PayPal
      marks; the UI renders the word "PayPal" as text only.

## 5. Evidence commands

```bash
make verify        # ruff + pytest + eslint + tsc + next build + vitest + SDK build + scripted demo
make demo          # the judge flow alone, green/red
make stack         # seed + API + UI, zero keys
make verify-live   # real PayPal sandbox check (requires PAYPAL_MODE=PAYPAL_SANDBOX + credentials)
docker compose up --build   # full stack, verified in this repo
```
