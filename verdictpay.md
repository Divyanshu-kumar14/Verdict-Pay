# 🛡️ VerdictPay

> **Status note (2026-11-06): this file is the original concept brief, not the shipping README.**
> The project is implemented — see [README.md](./README.md) for what actually runs, and
> [docs/submission.md](./docs/submission.md) for the hackathon submission pack. Claims below that
> reference a hosted demo at `verdictpay.onrender.com` or proprietary Bryntum / AG Studio
> runtimes are aspirational and are **not** part of the submitted build. The demo runs locally
> with `make stack` and needs no PayPal credentials.

**The Open-Source Pre-Dispute Telemetry SDK (`@verdictpay/sdk`) & Autonomous PayPal Inquiry Deflection + Claim Defense Engine for SaaS, Digital Goods, and Metered AI Apps.**

[![License: MIT](https://img.shields.io/badge/License-MIT-emerald.svg)](./LICENSE)
[![PayPal API](https://img.shields.io/badge/PayPal-Disputes%20v1%20%7C%20Orders%20v2%20%7C%20Subscriptions%20v1-003087.svg)](https://developer.paypal.com)
[![AG Studio 3.0](https://img.shields.io/badge/UI-AG%20Grid%20%2B%20AG%20Studio%203.0-orange.svg)](https://www.ag-grid.com)
[![APIMatic](https://img.shields.io/badge/Context-APIMatic%20PayPal%20SDK-blue.svg)](https://www.apimatic.io)
[![Bryntum](https://img.shields.io/badge/SLA%20Timeline-Bryntum%20Scheduler-purple.svg)](https://bryntum.com)
[![Run in Postman](https://run.pstmn.io/button.svg)](./postman/verdictpay-paypal-disputes.postman_collection.json)

---

## ⚡ 60-Second Judge Quickstart (Zero Login Required)

We built VerdictPay so judges can test the entire real-time PayPal Sandbox lifecycle in under 60 seconds without creating an account or configuring API keys:

1. **Run it locally (no hosted demo in the submitted build):** `make install && make stack && make web` — opens **http://localhost:3000** in **Judge Sandbox Mode***
2. **Left Split-Screen (Mock AI SaaS Storefront):**
   - Click **`1. Checkout $99 Pro Plan (PayPal Sandbox)`** — executes a live PayPal Orders v2 / Subscriptions v1 sandbox checkout.
   - Click **`2. Simulate SaaS Usage & AI Token Drain`** — triggers `@verdictpay/sdk` to record SHA-256 hash-chained telemetry (IP address, device fingerprint, 15 dashboard logins, 42k LLM tokens consumed, and ZIP deliverable download receipt).
   - Click **`3. File Friendly-Fraud Dispute ("Item Not Received / SNAD")`** — uses PayPal's `PayPal-Auth-Assertion` buyer JWT to open a real Sandbox Dispute via `POST /v1/customer/disputes`.
3. **Right Split-Screen (VerdictPay Merchant Command Center):**
   - Watch VerdictPay intercept the dispute via webhook/polling, immediately **suspend the user's recurring PayPal subscription** (`POST /v1/billing/subscriptions/{id}/suspend`), run the **Deterministic Expected Value (EV) Math Engine**, correlate historical transactions in **Elastic**, compile a **Seller-Protection-Compliant PDF Dossier**, and upload it directly to PayPal via `multipart/related` (`POST /v1/customer/disputes/{id}/provide-evidence`).

---

## 🚨 The Problem Statement

Online SaaS founders, developer-tool creators, and metered AI platforms selling via PayPal face a brutal financial trap: **Friendly Fraud** (customers who purchase a subscription or digital product, consume the value or burn expensive LLM API tokens, and then file a dispute claiming *"Item Not Received"* or *"Significantly Not As Described"*).

### 1. The 2026 PayPal Seller Protection Loopholes for SaaS & Digital Goods
Under **PayPal’s Seller Protection Program (effective January 26, 2026)**, digital and intangible goods merchants face three structural blind spots:
* **100% Exclusion of `SNAD` Claims:** Seller Protection explicitly excludes *Significantly Not As Described (`MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED`)* claims. When a buyer claims a SaaS app "didn't work as advertised," a basic checkout receipt fails—the merchant loses automatically unless they prove sustained, itemized feature consumption after Terms of Service acceptance.
* **Strict "System of Record" Mandate for `INR` & `UA`:** To win an *Item Not Received* or *Unauthorized* claim on intangible goods, PayPal requires *"compelling evidence from a system of record"* proving when the item was electronically sent and accessed (including recipient IP, email, device metadata, and download timestamps).
* **Card-Funded External Chargebacks (`EXTERNAL` Channel):** When a buyer disputes a card-funded PayPal transaction directly with their issuing bank, internal Seller Protection rules often give way to **Visa Compelling Evidence 3.0 (CE 3.0)**, requiring proof of at least two prior undisputed transactions (120–365 days old) sharing the same IP or device fingerprint.

### 2. The $15 / $30 Dispute Fee Cliff & Negative Expected Value (EV)
* PayPal charges a **$15 Standard Dispute Fee** (refunded if the seller wins).
* However, if a merchant’s rolling dispute ratio reaches **1.5%** (with 100+ sales over 3 full months), PayPal enforces a **$30 High-Volume Dispute Fee** on every escalated claim—**which is NOT refunded even if the merchant wins the dispute.**
* **The Math Trap:** If a customer disputes a **$25/month SaaS plan** and a high-volume merchant blindly fights and **wins** the claim, the merchant pays a $30 non-refundable fee to recover $25—losing **-$5 net** while burning hours of engineering time.

---

## 🔍 Why Existing Solutions Fail Indie SaaS & AI Founders

| Capability / Constraint | **Chargeflow / Justt** | **Redo / ChargePay** | **Rebutiq (`@rebutiq/sdk`)** | **🛡️ VerdictPay (Ours)** |
| :--- | :--- | :--- | :--- | :--- |
| **Primary Target** | Enterprise E-Commerce ($50k+/mo) | Shopify Physical Stores | Stripe-Only SaaS Apps | **PayPal SaaS, Digital Goods & AI Apps** |
| **Pricing Model** | 20%–25% cut of gross recovered revenue | Paid Shopify App + % fee | Closed SaaS Subscription | **Open-Source (MIT) / 0% Success Fee** |
| **Pre-Dispute Telemetry SDK** | ❌ Wakes up *after* dispute is filed | ❌ Relies on UPS/FedEx tracking | ✅ Yes, but hardcoded to `stripeCustomerId` | ✅ **`@verdictpay/sdk` keyed to PayPal `payer_id` & `order_id`** |
| **PayPal Free `INQUIRY` Deflection** | ❌ Escalates to Claim (triggers $15/$30 fee) | ❌ Manual Resolution Center | ❌ No PayPal support | ✅ **Automated `$0-Fee` Inquiry Deflection (`send-message` / `make-offer`)** |
| **Expected Value (EV) Fee Math** | ❌ Fights low-ticket claims blindly | ❌ None | ❌ None | ✅ **Deterministic $15/$30 Fee-Cliff EV Calculator** |
| **Subscription Bleed Containment** | ❌ Leaves recurring billing active | ❌ None | ❌ Stripe-only | ✅ **Auto-Suspends PayPal Subscriptions (`/suspend`) in <1s** |

---

## 💡 The Solution: How VerdictPay Works

VerdictPay bridges the gap between pre-dispute product telemetry and PayPal’s Disputes, Subscriptions, and Reporting APIs through five tightly integrated modules:

```
┌──────────────────────────────────────────────────────────────────────────────┐
│ 1. PRE-DISPUTE: @verdictpay/sdk (Installed in Merchant Next.js / FastAPI App)│
│    • Captures ToS signature hash, login IPs, deliverable SHA-256 downloads,  │
│      and metered AI token consumption linked to PayPal order_id / payer_id.  │
└──────────────────────────────────────┬───────────────────────────────────────┘
                                       │ Signed Webhook Events (SHA-256 Chained)
                                       ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ 2. INGESTION & CONTAINMENT (FastAPI + Supabase + Elastic)                    │
│    • Catches PayPal Webhook `CUSTOMER.DISPUTE.CREATED` (or active API poll)  │
│    • CIRCUIT BREAKER: Immediately calls PayPal Subscriptions API             │
│      `POST /v1/billing/subscriptions/{id}/suspend` to stop next month's bill │
└──────────────────────────────────────┬───────────────────────────────────────┘
                                       │
                                       ▼
┌──────────────────────────────────────────────────────────────────────────────┐
│ 3. DETERMINISTIC HATEOAS & EXPECTED VALUE (EV) TRIAGE ENGINE                 │
│    • Inspects `dispute_life_cycle_stage` (INQUIRY vs CLAIM), `dispute_channel`│
│      (INTERNAL vs EXTERNAL), and HATEOAS `links[]`                           │
│    • Queries Elastic + PayPal `/v1/reporting/transactions` for Visa CE 3.0   │
│    • Computes EV_fight vs EV_offer vs EV_refund against $15/$30 Fee Cliff    │
└───────────┬──────────────────────────┬───────────────────────────┬───────────┘
            │                          │                           │
            ▼ (EV < 0 / Seller Fault)  ▼ (Stage == INQUIRY)        ▼ (Stage == CLAIM / EXTERNAL)
┌───────────────────────┐  ┌──────────────────────────┐  ┌─────────────────────────┐
│ PATH A: Zero-Fee      │  │ PATH B: Inquiry          │  │ PATH C: Air-Gapped PDF  │
│ Auto-Settlement       │  │ Deflection ($0 Fee)      │  │ Evidence Defense        │
│ • Calls `/accept-claim`│  │ • Calls `/send-message`  │  │ • Locks verified DB/IP  │
│   or `/make-offer`    │  │   presenting buyer with  │  │   tables (zero LLM      │
│   before claim fee    │  │   their own verified IP  │  │   hallucination risk)   │
│   is triggered.       │  │   & download timestamps. │  │ • Uploads PDF dossier   │
│                       │  │                          │  │   via `/provide-evidence`│
└───────────────────────┘  └──────────────────────────┘  └─────────────────────────┘
```

---

## ✨ Core Technical Features

### 1. `@verdictpay/sdk` — Tamper-Evident Digital Delivery Receipts
Instead of trying to query arbitrary merchant databases after a chargeback hits, merchants drop in our lightweight SDK (`@verdictpay/sdk`) to emit four signed lifecycle events:
* `tos.accepted`: Captures the exact SHA-256 hash of the Terms of Service and refund policy shown at PayPal checkout.
* `session.authenticated`: Logs client IP, ASN, user-agent, and device fingerprint mapped to the PayPal `payer_id`.
* `asset.delivered`: Logs digital file downloads, export hashes, and timestamps (satisfying PayPal’s Jan 2026 Intangible Goods delivery proof requirement).
* `usage.metered`: Tracks API calls or LLM tokens consumed so merchants can prove exact unit consumption during `SNAD` disputes.
Every event is stored in an append-only **SHA-256 hash chain** (`prev_hash + payload_hash`), providing cryptographic proof that logs were recorded in real time and not fabricated after the dispute was opened.

### 2. HATEOAS-Driven PayPal State Machine & Free `INQUIRY` Deflection
Most developers treat all PayPal disputes the same and immediately call `provide-evidence`—which throws `422 Unprocessable Entity` during early `INQUIRY` states or prematurely escalates an Inquiry into a fee-bearing Claim.
* VerdictPay parses the exact `dispute_life_cycle_stage` (`INQUIRY`, `CHARGEBACK`, `PRE_ARBITRATION`), `dispute_channel` (`INTERNAL`, `EXTERNAL`), and HATEOAS `links[]` array returned by `GET /v1/customer/disputes/{id}`.
* **Inquiry Deflection:** When a dispute is in `INQUIRY` (where PayPal charges **$0 dispute fee**), VerdictPay automatically sends an evidence-backed message to the buyer via `POST /v1/customer/disputes/{id}/send-message` showing their verified login dates, IP address, and downloaded assets, or offers a calculated partial credit via `POST /v1/customer/disputes/{id}/make-offer` conditioned on closing the dispute.

### 3. Deterministic Expected Value (EV) & Fee-Cliff Calculator
Before contesting any claim, VerdictPay runs a strict financial formula:

$$\text{EV}_{\text{fight}} = P(\text{win}) \times (-\text{Fee}_{\text{HV}}) + (1 - P(\text{win})) \times (-\text{Amount} - \text{Fee}_{\text{Std}} - \text{Fee}_{\text{HV}} - \text{Penalty}_{\text{Ratio}})$$

* Where $P(\text{win})$ is scored deterministically from telemetry completeness (IP match + ToS signature + download receipt + Visa CE 3.0 historical orders).
* If fighting a low-ticket claim has a worse Expected Value than settling in the Inquiry stage (or risks pushing the merchant over the **1.5% High-Volume Dispute Ratio cliff**), VerdictPay recommends or executes an immediate `accept-claim` / `make-offer` to save the $15–$30 fee.

### 4. Air-Gapped Legal PDF Compiler & `multipart/related` Uploader
**An LLM should never be trusted to invent timestamps or IP addresses in a legal bank filing.**
* VerdictPay enforces a strict **Architectural Air-Gap**: deterministic Python code extracts and locks the verified telemetry rows, SHA-256 chain hashes, and PayPal Transaction Search (`GET /v1/reporting/transactions`) matches into immutable tables.
* The AI model receives those locked facts and writes *only* the executive legal rebuttal narrative tailored to the exact PayPal `reason` code (`MERCHANDISE_OR_SERVICE_NOT_RECEIVED`, `MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED`, `UNAUTHORIZED`).
* **WeasyPrint / ReportLab** compiles the narrative, locked log tables, and ToS snapshots into a formatted PDF buffer, which FastAPI streams to `POST /v1/customer/disputes/{id}/provide-evidence` as a specification-compliant `multipart/related; boundary=...` payload (`application/json` metadata part + `application/pdf` binary attachment).

### 5. Instant Subscription Containment Circuit Breaker
When a customer files a chargeback on a monthly SaaS subscription, leaving their recurring billing active guarantees a second chargeback 30 days later. Within 500ms of receiving `CUSTOMER.DISPUTE.CREATED`, VerdictPay calls `POST /v1/billing/subscriptions/{id}/suspend` on PayPal and fires a webhook back to the merchant app to freeze the user's API key until the dispute resolves.

---

## 🏆 Sponsor Tools & Ecosystem Architecture

Every sponsor integration in VerdictPay solves a critical operational requirement:

| Tool / Platform | Role in VerdictPay Architecture |
| :--- | :--- |
| **PayPal Developer Platform** | **Core Engine:** Integrates **Disputes API v1** (`GET`, `send-message`, `make-offer`, `accept-claim`, `provide-evidence`, sandbox `require-evidence`), **Orders API v2**, **Subscriptions API v1** (`/suspend`), **Transaction Search API v1** (`/v1/reporting/transactions` for Visa CE 3.0 lookbacks), and **Webhook Signature Verification** (`/v1/notifications/verify-webhook-signature`). |
| **AG Grid + AG Studio 3.0** | **Merchant Command Center:** Uses **AG Grid** for the real-time Dispute Triage Queue (with custom cell renderers for EV calculations, HATEOAS action badges, and 1-click PDF previews) and **AG Studio 3.0 + Studio Agent Framework** for the self-serve Chargeback Exposure & Win-Rate Analytics Canvas. |
| **APIMatic** | **Spec-Grounded API Client:** Built and validated using `npx context-plugins install paypal` (APIMatic Context Plugin) to ensure 100% schema compliance on complex PayPal `multipart/related` evidence uploads, `PayPal-Auth-Assertion` buyer JWTs, and idempotency headers. |
| **Bryntum Scheduler** | **Statutory SLA Command Board:** Visualizes every open PayPal Inquiry and Claim on an interactive timeline against its strict `seller_response_due_date` expiration window, automated follow-up milestones, and subscription hold periods. |
| **Elastic** | **Sub-Second Visa CE 3.0 Correlation:** Indexes historical customer telemetry, IP addresses, device fingerprints, and past PayPal transactions to instantaneously prove 120–365 day historical footprint matches during fraud adjudication. |
| **Postman** | **Interactive API Verification:** Includes a public Postman Collection (`./postman/`) allowing judges and developers to simulate PayPal dispute webhooks, inspect `PayPal-Auth-Assertion` sandbox payloads, and test telemetry ingestion in 1 click. |
| **Render** | **Cloud Infrastructure:** Hosts the production Next.js frontend, FastAPI backend, and asynchronous PDF dossier worker via a declarative `render.yaml` Blueprint. |

---

## 💻 Code Walkthrough

### 1. Dropping `@verdictpay/sdk` into a Merchant SaaS App (TypeScript)

```typescript
import { VerdictPayClient } from '@verdictpay/sdk';

const verdict = new VerdictPayClient({
  apiKey: process.env.VERDICTPAY_API_KEY!,
  webhookSecret: process.env.VERDICTPAY_SIGNING_SECRET!,
});

// 1. At Checkout: Link PayPal Payer & Order to ToS Acceptance
await verdict.trackCheckout({
  paypalOrderId: '5O190127TN364715T',
  paypalSubscriptionId: 'I-BW452GLLEP1G',
  paypalPayerId: 'YRZ829104KLA',
  userEmail: 'alex@customer-startup.io',
  clientIp: req.headers['x-forwarded-for'],
  deviceFingerprint: 'fp_89a7c6d5e4f3',
  tosVersion: 'v2.4-2026-01',
  tosContentSha256: 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855',
});

// 2. Inside Product: Log Verifiable Feature & Deliverable Consumption
await verdict.trackDelivery({
  paypalPayerId: 'YRZ829104KLA',
  eventType: 'ASSET_DOWNLOADED',
  resourceId: 'export_q3_financial_model.xlsx',
  resourceSha256: '9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08',
  computeUnitsConsumed: 1450, // e.g., AI tokens or API credits consumed
  clientIp: req.headers['x-forwarded-for'],
});
```

### 2. Submitting `multipart/related` PDF Evidence to PayPal Disputes API (Python / FastAPI)

```python
import json
import httpx
from email.mime.multipart import MIMEMultipart
from email.mime.application import MIMEApplication
from email.mime.text import MIMEText

async def submit_paypal_dispute_evidence(
    dispute_id: str,
    access_token: str,
    evidence_type: str,
    rebuttal_notes: str,
    pdf_bytes: bytes,
) -> dict:
    """
    Constructs a spec-compliant multipart/related payload containing JSON metadata
    and the compiled SHA-256 verified PDF dossier for POST /v1/customer/disputes/{id}/provide-evidence.
    Grounded via APIMatic PayPal Context Plugin.
    """
    related = MIMEMultipart("related")

    # Part 1: JSON Evidence Metadata
    evidence_payload = {
        "evidences": [
            {
                "evidence_type": evidence_type,  # e.g., "PROOF_OF_FULFILLMENT" or "OTHER"
                "evidence_info": {
                    "notes": rebuttal_notes[:2000]  # PayPal max length constraint
                },
                "documents": [
                    {"name": f"VerdictPay_Dossier_{dispute_id}.pdf"}
                ],
            }
        ]
    }
    json_part = MIMEText(json.dumps(evidence_payload), _subtype="json", _charset="utf-8")
    json_part.add_header("Content-Disposition", 'form-data; name="input"; filename="evidence.json"')
    related.attach(json_part)

    # Part 2: Compiled PDF Evidence Dossier
    pdf_part = MIMEApplication(pdf_bytes, _subtype="pdf")
    pdf_part.add_header(
        "Content-Disposition",
        f'form-data; name="file1"; filename="VerdictPay_Dossier_{dispute_id}.pdf"',
    )
    related.attach(pdf_part)

    # Extract raw body and boundary header for httpx
    raw_bytes = related.as_bytes()
    header_end = raw_bytes.find(b"\n\n")
    body = raw_bytes[header_end + 2 :]
    boundary = related.get_boundary()

    headers = {
        "Authorization": f"Bearer {access_token}",
        "Content-Type": f'multipart/related; boundary="{boundary}"',
        "PayPal-Request-Id": f"verdictpay-ev-{dispute_id}",
    }

    async with httpx.AsyncClient(timeout=30.0) as client:
        response = await client.post(
            f"[https://api-m.sandbox.paypal.com/v1/customer/disputes/](https://api-m.sandbox.paypal.com/v1/customer/disputes/){dispute_id}/provide-evidence",
            headers=headers,
            content=body,
        )
        response.raise_for_status()
        return response.json()
```

---

## 🗄️ Database Schema (Supabase PostgreSQL)

```sql
-- 1. Append-Only Hash-Chained Telemetry Ledger (System of Record)
CREATE TABLE telemetry_ledger (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    merchant_id UUID NOT NULL,
    paypal_payer_id TEXT NOT NULL,
    paypal_order_id TEXT,
    paypal_subscription_id TEXT,
    event_type TEXT NOT NULL, -- 'TOS_ACCEPTED', 'SESSION_AUTH', 'ASSET_DELIVERED', 'AI_TOKENS_USED'
    client_ip INET NOT NULL,
    device_fingerprint TEXT NOT NULL,
    resource_hash TEXT,
    units_consumed INTEGER DEFAULT 0,
    metadata JSONB NOT NULL DEFAULT '{}',
    prev_hash TEXT NOT NULL,
    chain_hash TEXT NOT NULL, -- SHA-256(prev_hash || event_type || paypal_payer_id || created_at || metadata)
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- 2. Active Disputes & Deterministic EV Triage State
CREATE TABLE dispute_cases (
    dispute_id TEXT PRIMARY KEY, -- e.g., 'PP-D-40192'
    merchant_id UUID NOT NULL,
    paypal_order_id TEXT NOT NULL,
    paypal_subscription_id TEXT,
    paypal_payer_id TEXT NOT NULL,
    reason_code TEXT NOT NULL, -- 'MERCHANDISE_OR_SERVICE_NOT_RECEIVED', 'MERCHANDISE_OR_SERVICE_NOT_AS_DESCRIBED', 'UNAUTHORIZED'
    lifecycle_stage TEXT NOT NULL, -- 'INQUIRY', 'CHARGEBACK', 'PRE_ARBITRATION'
    dispute_channel TEXT NOT NULL, -- 'INTERNAL', 'EXTERNAL'
    status TEXT NOT NULL, -- 'OPEN', 'WAITING_FOR_SELLER_RESPONSE', 'UNDER_REVIEW', 'RESOLVED'
    amount_usd NUMERIC(10, 2) NOT NULL,
    win_probability NUMERIC(5, 2) NOT NULL,
    ev_fight_usd NUMERIC(10, 2) NOT NULL,
    ev_settle_usd NUMERIC(10, 2) NOT NULL,
    recommended_action TEXT NOT NULL, -- 'DEFLECT_INQUIRY', 'MAKE_OFFER', 'ACCEPT_CLAIM', 'PROVIDE_EVIDENCE'
    subscription_suspended BOOLEAN DEFAULT FALSE,
    dossier_pdf_url TEXT,
    seller_response_due_date TIMESTAMPTZ,
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
```

---

## 🚀 Local Setup & One-Command Installation

### Prerequisites
* Docker & Docker Compose (or Node.js 20+ and Python 3.12+)
* PayPal Developer Sandbox Account (`PAYPAL_CLIENT_ID` and `PAYPAL_CLIENT_SECRET`)

### Option A: One-Command Docker Start (Recommended for Judges)
```bash
git clone [https://github.com/divyanshukumar0014/verdictpay.git](https://github.com/divyanshukumar0014/verdictpay.git)
cd verdictpay
cp .env.example .env
# Add your PayPal Sandbox Client ID, Secret, and LLM API Key to .env
docker compose up --build
```
* **Frontend & Judge Sandbox Storefront:** `http://localhost:3000`
* **FastAPI Swagger / OpenAPI Docs:** `http://localhost:8000/docs`

### Option B: Manual Local Development
```bash
# 1. Start FastAPI Backend
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000

# 2. Start Next.js Frontend (AG Grid + AG Studio 3.0 + Bryntum)
cd ../frontend
npm install
npm run dev
```

---

## 🧪 Testing the Sandbox Dispute Simulator

Because PayPal Sandbox does not offer a 1-click UI button for buyers to file `SNAD` or `INR` disputes with pre-populated telemetry, VerdictPay includes an automated **Sandbox Dispute Generator** (`/api/v1/sandbox/simulate-dispute`) that executes the 3-step PayPal Sandbox testing flow automatically:
1. Generates an unsigned base64url `PayPal-Auth-Assertion` JWT header identifying the Sandbox Buyer (`payer_id`).
2. Calls `POST /v1/customer/disputes` on behalf of the buyer to open a live Sandbox Dispute.
3. Calls `POST /v1/customer/disputes/{id}/require-evidence` (`{"action": "SELLER_EVIDENCE"}`) when testing full Claim escalation so judges can immediately watch the `multipart/related` PDF evidence upload succeed in real time.

---

## 📄 License

Distributed under the **MIT License**. See [`LICENSE`](./LICENSE) in the root of this repository for full text.