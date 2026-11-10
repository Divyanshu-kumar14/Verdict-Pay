"""Application configuration.

All settings are environment-driven (see .env.example). Defaults are deliberately
safe for a local demo: PayPal Sandbox gateway, SQLite, template narrative.
"""

from __future__ import annotations

import hashlib
from decimal import Decimal
from enum import StrEnum
from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

AppEnv = Literal["local", "test", "production"]
LlmMode = Literal["template", "openai", "gemini"]

PAYPAL_SANDBOX_BASE = "https://api-m.sandbox.paypal.com"
PAYPAL_LIVE_BASE = "https://api-m.paypal.com"


class GatewayMode(StrEnum):
    """The two gateway modes the product exposes, in escalating trust order.

    ``PAYPAL_SANDBOX`` calls the real PayPal API against the free sandbox.
    ``PAYPAL_LIVE`` moves real money and therefore demands an explicit opt-in.
    """

    PAYPAL_SANDBOX = "PAYPAL_SANDBOX"
    PAYPAL_LIVE = "PAYPAL_LIVE"


_SandboxAliases = frozenset({"paypal_sandbox", "sandbox"})
_LiveAliases = frozenset({"paypal_live", "production"})
# Internal marker: the legacy "live" token, resolved against the API base.
_LEGACY_LIVE_MARKER = "__legacy_live__"


def _legacy_mode_for(base: str) -> GatewayMode:
    """Old-style ``live`` means production only if the base really is production.

    With no explicit base there is nothing saying "production", and the
    historical default was the sandbox, so an unset base stays on the sandbox.
    """
    if not base:
        return GatewayMode.PAYPAL_SANDBOX
    return GatewayMode.PAYPAL_SANDBOX if "sandbox" in base.lower() else GatewayMode.PAYPAL_LIVE


_BACKEND_DIR = Path(__file__).resolve().parents[1]
_REPO_DIR = _BACKEND_DIR.parent
_ENV_FILES = (str(_BACKEND_DIR / ".env"), str(_REPO_DIR / ".env"))
_DEV_SECRET_PREFIX = "dev-"


class Settings(BaseSettings):
    """Runtime configuration, loaded once and cached."""

    model_config = SettingsConfigDict(
        env_file=_ENV_FILES,
        env_file_encoding="utf-8",
        extra="ignore",
        case_sensitive=False,
    )

    # --- core -------------------------------------------------------------
    app_env: AppEnv = "local"
    demo_mode: bool = True
    app_name: str = "VerdictPay API"
    api_v1_prefix: str = "/api/v1"
    database_url: str = "sqlite+aiosqlite:///./verdictpay.db"
    allowed_origins: str = "http://localhost:3000,http://127.0.0.1:3000"

    # --- PayPal -----------------------------------------------------------
    # Accepted values (case-insensitive): PAYPAL_SANDBOX | PAYPAL_LIVE
    # plus the legacy alias "live".
    paypal_mode: str = "PAYPAL_SANDBOX"
    paypal_api_base: str = ""
    paypal_client_id: str = ""
    paypal_client_secret: str = ""
    paypal_webhook_id: str = ""
    # Per-mode overrides: when set, these win for that mode; otherwise the
    # base trio above is used (backward compat). Never commit real values.
    paypal_sandbox_client_id: str = ""
    paypal_sandbox_client_secret: str = ""
    paypal_sandbox_webhook_id: str = ""
    paypal_timeout_seconds: float = 15.0
    # PAYPAL_LIVE moves real money; this second switch stops a typo in
    # PAYPAL_MODE alone from turning the demo into a payment processor.
    allow_paypal_live: bool = False
    # Where PayPal sends the buyer after approval / cancellation.
    paypal_return_url: str = ""
    paypal_cancel_url: str = ""

    # --- secrets / auth ---------------------------------------------------
    verdictpay_api_key: str = "vp_demo_sk_local"
    verdictpay_signing_secret: str = "dev-signing-secret-change-me"
    verdictpay_webhook_secret: str = "dev-webhook-secret-change-me"
    webhook_tolerance_seconds: int = 300
    allow_unsigned_webhooks: bool = False
    require_signed_telemetry: bool = True

    # --- demo merchant ----------------------------------------------------
    demo_merchant_name: str = "Aurora Analytics"
    demo_payer_id: str = "YRZ829104KLA"
    demo_order_id: str = "5O190127TN364715T"
    demo_subscription_id: str = "I-BW452GLLEP1G"

    # --- narrative --------------------------------------------------------
    llm_mode: LlmMode = "template"
    openai_api_key: str = ""
    openai_model: str = "gpt-4o-mini"
    # Any OpenAI-compatible chat endpoint works, including a free local Ollama:
    #   LLM_BASE_URL=http://localhost:11434/v1  LLM_MODEL=llama3.2
    llm_base_url: str = ""
    llm_model: str = ""

    # --- Gemini AI layer ---------------------------------------------------
    # "AI explains and drafts; rules decide."  The Gemini model classifies the
    # buyer's claim text and drafts the evidence narrative; it NEVER sets a win
    # probability, EV figure or recommended action — those stay deterministic.
    gemini_api_key: str = ""
    gemini_model: str = "gemini-2.5-flash"
    ai_enabled: bool = True
    ai_timeout_ms: int = 12000
    ai_max_retries: int = 1

    # --- sponsor adapters (optional) --------------------------------------
    elastic_url: str = ""
    elastic_api_key: str = ""
    elastic_index_prefix: str = "verdictpay"

    # --- EV policy --------------------------------------------------------
    standard_fee_usd: Decimal = Decimal("15.00")
    high_volume_fee_usd: Decimal = Decimal("30.00")
    ratio_threshold: Decimal = Decimal("0.015")
    offer_ratio: Decimal = Decimal("0.30")
    high_volume_min_sales: int = 100

    # --- limits -----------------------------------------------------------
    artifacts_dir: str = "./artifacts"
    max_body_bytes: int = 262_144
    max_batch_events: int = 500
    rate_limit_per_minute: int = 600
    action_latency_budget_ms: int = 500

    # --- observability ----------------------------------------------------
    log_level: str = "INFO"
    request_id_header: str = "X-Request-Id"

    @field_validator("allowed_origins", mode="before")
    @classmethod
    def _normalise_origins(cls, value: object) -> object:
        if isinstance(value, (list, tuple)):
            return ",".join(str(item) for item in value)
        return value

    @field_validator("paypal_mode", mode="before")
    @classmethod
    def _normalise_paypal_mode(cls, value: object) -> object:
        """Accept the canonical two modes plus the legacy "live" alias.

        The legacy ``live`` token is kept as a marker here and resolved in the
        model validator below, where the configured API base is already known.
        """
        if value is None:
            return GatewayMode.PAYPAL_SANDBOX.value
        token = str(value).strip().lower().replace("-", "_").replace(" ", "_")
        if token == "live":
            return _LEGACY_LIVE_MARKER
        if token in _LiveAliases:
            return GatewayMode.PAYPAL_LIVE.value
        if token in _SandboxAliases:
            return GatewayMode.PAYPAL_SANDBOX.value
        raise ValueError(
            "paypal_mode must be one of PAYPAL_SANDBOX, PAYPAL_LIVE "
            f"(or legacy live); got {value!r}"
        )

    @model_validator(mode="after")
    def _resolve_gateway_mode(self) -> Settings:
        """Resolve the legacy marker against the API base, then pin the base.

        ``PAYPAL_MODE=live`` historically meant "call the real PayPal API", and
        the historical default base was the sandbox. Resolving the alias from the
        endpoint keeps old configs pointing at the sandbox while an explicitly
        production base still lands on PAYPAL_LIVE (and its double opt-in).
        """
        base = (self.paypal_api_base or "").strip().rstrip("/")
        mode = self.paypal_mode
        if mode == _LEGACY_LIVE_MARKER:
            object.__setattr__(self, "paypal_mode", _legacy_mode_for(base).value)
        if not base:
            resolved = self.gateway_mode
            base = PAYPAL_LIVE_BASE if resolved is GatewayMode.PAYPAL_LIVE else PAYPAL_SANDBOX_BASE
        object.__setattr__(self, "paypal_api_base", base)
        return self

    @model_validator(mode="after")
    def _reject_dev_secrets_in_production(self) -> Settings:
        if self.gateway_mode is GatewayMode.PAYPAL_LIVE and not self.allow_paypal_live:
            raise ValueError(
                "PAYPAL_MODE=PAYPAL_LIVE moves real money: set ALLOW_PAYPAL_LIVE=true to "
                "confirm you intend to process production payments."
            )
        if self.app_env != "production":
            return self
        insecure = [
            name
            for name, value in (
                ("verdictpay_api_key", self.verdictpay_api_key),
                ("verdictpay_signing_secret", self.verdictpay_signing_secret),
                ("verdictpay_webhook_secret", self.verdictpay_webhook_secret),
            )
            if not value or value.startswith(_DEV_SECRET_PREFIX)
        ]
        if insecure:
            raise ValueError(f"Refusing dev-default secrets in production: {', '.join(insecure)}")
        if self.allow_unsigned_webhooks:
            raise ValueError("allow_unsigned_webhooks must be false in production")
        if not self.require_signed_telemetry:
            raise ValueError("require_signed_telemetry must be true in production")
        return self

    # --- gateway helpers ---------------------------------------------------
    @property
    def gateway_mode(self) -> GatewayMode:
        """Canonical gateway mode (always one of the two enum members)."""
        return GatewayMode(self.paypal_mode)

    @property
    def provenance(self) -> str:
        """Provenance label stamped on every order and transaction row."""
        return {
            GatewayMode.PAYPAL_SANDBOX: "paypal_sandbox",
            GatewayMode.PAYPAL_LIVE: "paypal_live",
        }[self.gateway_mode]

    @property
    def uses_paypal_network(self) -> bool:
        return True

    @property
    def effective_paypal_client_id(self) -> str:
        """Mode-specific client ID: SANDBOX_* wins in sandbox, else base."""
        if self.gateway_mode is GatewayMode.PAYPAL_SANDBOX:
            specific = self.paypal_sandbox_client_id.strip()
            if specific:
                return specific
        return self.paypal_client_id.strip()

    @property
    def effective_paypal_client_secret(self) -> str:
        """Mode-specific secret: SANDBOX_* wins in sandbox, else base."""
        if self.gateway_mode is GatewayMode.PAYPAL_SANDBOX:
            specific = self.paypal_sandbox_client_secret.strip()
            if specific:
                return specific
        return self.paypal_client_secret.strip()

    @property
    def effective_paypal_webhook_id(self) -> str:
        """Mode-specific webhook ID: SANDBOX_* wins in sandbox, else base."""
        if self.gateway_mode is GatewayMode.PAYPAL_SANDBOX:
            specific = self.paypal_sandbox_webhook_id.strip()
            if specific:
                return specific
        return self.paypal_webhook_id.strip()

    @property
    def paypal_credentials_configured(self) -> bool:
        """True when both halves of an OAuth2 client-credentials pair exist."""
        return bool(self.effective_paypal_client_id and self.effective_paypal_client_secret)

    @property
    def gateway_blockers(self) -> list[str]:
        """Human-readable reasons the selected gateway mode cannot run yet."""
        blockers: list[str] = []
        mode = self.gateway_mode
        if mode is GatewayMode.PAYPAL_SANDBOX:
            if not self.effective_paypal_client_id:
                blockers.append(
                    "PAYPAL_SANDBOX_CLIENT_ID is not set "
                    "(set PAYPAL_SANDBOX_CLIENT_ID or PAYPAL_CLIENT_ID)"
                )
            if not self.effective_paypal_client_secret:
                blockers.append(
                    "PAYPAL_SANDBOX_CLIENT_SECRET is not set "
                    "(set PAYPAL_SANDBOX_CLIENT_SECRET or PAYPAL_CLIENT_SECRET)"
                )
        else:
            if not self.paypal_client_id.strip():
                blockers.append("PAYPAL_CLIENT_ID is not set")
            if not self.paypal_client_secret.strip():
                blockers.append("PAYPAL_CLIENT_SECRET is not set")
        if mode is GatewayMode.PAYPAL_LIVE and not self.allow_paypal_live:
            blockers.append("ALLOW_PAYPAL_LIVE is not true")
        return blockers

    @property
    def gateway_ready(self) -> bool:
        return not self.gateway_blockers

    @property
    def cors_origins(self) -> list[str]:
        return [origin.strip() for origin in self.allowed_origins.split(",") if origin.strip()]

    @property
    def is_production(self) -> bool:
        return self.app_env == "production"

    @property
    def demo_merchant_id(self) -> str:
        """Stable demo merchant id derived from the name (no persistence needed)."""
        digest = hashlib.sha256(self.demo_merchant_name.encode("utf-8")).hexdigest()
        return f"mch_{digest[:16]}"

    @property
    def api_key_hash(self) -> str:
        return hashlib.sha256(self.verdictpay_api_key.encode("utf-8")).hexdigest()

    def describe(self) -> dict[str, object]:
        """Safe, log-friendly view: never includes secrets."""
        return {
            "app_env": self.app_env,
            "paypal_mode": self.paypal_mode,
            "gateway_ready": self.gateway_ready,
            "gateway_blockers": self.gateway_blockers,
            "paypal_api_base": self.paypal_api_base,
            "database": self.database_url.split("://", 1)[0],
            "llm_mode": self.llm_mode,
            "ai_enabled": self.ai_enabled,
            "demo_mode": self.demo_mode,
        }


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
