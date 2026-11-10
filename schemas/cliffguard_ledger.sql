-- CliffGuard CQRS ledger contract (SQLite / Postgres).
-- Money is INTEGER minor units; ratios are INTEGER ppm. No REAL / FLOAT anywhere.
-- source_plane separates live PayPal sandbox rows from the simulated card-network feed.

CREATE TABLE IF NOT EXISTS orders_cqrs (
    order_id                TEXT PRIMARY KEY,
    capture_id              TEXT UNIQUE,
    payment_rail            TEXT NOT NULL CHECK (payment_rail IN ('PAYPAL_WALLET', 'UNBRANDED_CARD')),
    payment_credential_hash TEXT NOT NULL,
    account_login_id_hash   TEXT,
    shipping_address_hash   TEXT,
    ip_hash                 TEXT,
    device_id_hash          TEXT,
    card_network            TEXT CHECK (card_network IN ('VISA', 'MASTERCARD', 'PAYPAL_WALLET', 'AMEX', 'OTHER')),
    currency                TEXT NOT NULL,
    amount_minor            INTEGER NOT NULL CHECK (amount_minor > 0),
    settled_at_epoch        INTEGER NOT NULL,
    status                  TEXT NOT NULL CHECK (status IN ('COMPLETED', 'CAPTURED', 'REFUNDED', 'PENDING')),
    tracking_number         TEXT,
    carrier_name            TEXT,
    refund_id               TEXT,
    source_plane            TEXT NOT NULL CHECK (source_plane IN ('LIVE_PAYPAL_SANDBOX', 'REPORTING_RECONCILED', 'SEED_HISTORICAL', 'SIMULATED_CARD_NETWORK_FEED')),
    reconciled_reporting_v1 INTEGER NOT NULL DEFAULT 0 CHECK (reconciled_reporting_v1 IN (0, 1))
);

CREATE TABLE IF NOT EXISTS fraud_dispute_events (
    event_key             TEXT PRIMARY KEY,
    order_id              TEXT NOT NULL REFERENCES orders_cqrs (order_id),
    dispute_id            TEXT,
    payment_rail          TEXT NOT NULL CHECK (payment_rail IN ('PAYPAL_WALLET', 'UNBRANDED_CARD')),
    event_kind            TEXT NOT NULL CHECK (event_kind IN ('PAYPAL_DISPUTE', 'VISA_TC40', 'VISA_TC15', 'MC_CHARGEBACK', 'INQUIRY_AMICABLE_WAIVED')),
    dispute_reason        TEXT NOT NULL,
    lifecycle_stage       TEXT CHECK (lifecycle_stage IN ('INQUIRY', 'CHARGEBACK', 'PRE_ARBITRATION', 'ARBITRATION', 'RESOLVED', 'CLOSED')),
    external_reason_code  TEXT,
    dispute_amount_minor  INTEGER NOT NULL CHECK (dispute_amount_minor > 0),
    is_hvd_countable      INTEGER NOT NULL CHECK (is_hvd_countable IN (0, 1)),
    created_at_epoch      INTEGER NOT NULL,
    seller_response_due_epoch INTEGER,
    source_plane          TEXT NOT NULL CHECK (source_plane IN ('LIVE_PAYPAL_SANDBOX', 'SIMULATED_CARD_NETWORK_FEED', 'INTERNAL_TEST_EVENT'))
);

CREATE TABLE IF NOT EXISTS verdict_audit_log (
    audit_id            TEXT PRIMARY KEY,
    proposal_id         TEXT NOT NULL,
    dispute_id          TEXT NOT NULL,
    candidate_mode      TEXT NOT NULL CHECK (candidate_mode IN ('NAIVE', 'HARDENED', 'LLM_UNGUARDED')),
    proposed_action     TEXT NOT NULL,
    verdict             TEXT NOT NULL CHECK (verdict IN ('ALLOW', 'VETO')),
    exit_code           INTEGER NOT NULL CHECK (exit_code IN (0, 2)),
    veto_codes_json     TEXT NOT NULL,
    manifest_sha256     TEXT NOT NULL,
    ce3_manifest_sha256 TEXT,
    paypal_http_status  INTEGER,
    paypal_debug_id     TEXT,
    created_at_epoch    INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS webhook_events (
    webhook_event_id    TEXT PRIMARY KEY,
    event_type          TEXT NOT NULL,
    dispute_id          TEXT,
    verification_status TEXT NOT NULL,
    raw_json            TEXT NOT NULL,
    received_at_epoch   INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_orders_credential ON orders_cqrs (payment_credential_hash, settled_at_epoch);
CREATE INDEX IF NOT EXISTS idx_events_order ON fraud_dispute_events (order_id, event_kind);
