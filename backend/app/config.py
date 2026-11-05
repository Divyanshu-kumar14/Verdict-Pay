"""Application configuration.

All settings are environment-driven (see .env.example). Defaults are deliberately
safe for a local, keyless demo: simulator gateway, SQLite, template narrative.
"""

from __future__ import annotations

import hashlib
from decimal import Decimal
from functools import lru_cache
from pathlib import Path
from typing import Literal

from pydantic import field_validator, model_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

AppEnv = Literal["local", "test", "production"]
PayPalMode = Literal["simulator", "live"]
LlmMode = Literal["template", "openai"]

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
    paypal_mode: PayPalMode = "simulator"
    paypal_api_base: str = "https://api-m.sandbox.paypal.com"
    paypal_client_id: str = ""
    paypal_client_secret: str = ""
    paypal_webhook_id: str = ""
    paypal_timeout_seconds: float = 15.0

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

    @model_validator(mode="after")
    def _reject_dev_secrets_in_production(self) -> Settings:
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
            "database": self.database_url.split("://", 1)[0],
            "llm_mode": self.llm_mode,
            "demo_mode": self.demo_mode,
        }


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    return Settings()


settings = get_settings()
