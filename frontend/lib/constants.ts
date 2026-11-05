/** Demo constants shared by the storefront, shell and settings. */

export const APP_VERSION = "0.1.0";
export const DEMO_MERCHANT_NAME = "Aurora Analytics";
export const DEMO_BUYER_EMAIL = "demo.buyer@aurora.test";
export const DEMO_BUYER_NAME = "Demo buyer";

export const DEMO_PLAN = {
  product: "Aurora Analytics",
  name: "Pro",
  priceUsd: 99,
  cadence: "per month",
  currency: "USD",
  features: [
    "10M events / month across 12 workspaces",
    "42k metered AI tokens included",
    "SHA-256 signed ZIP exports",
    "Priority support with 4h response",
  ],
} as const;
