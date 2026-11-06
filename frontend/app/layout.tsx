import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import { AppShell } from "@/components/AppShell";

import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "VerdictPay — Merchant Command Centre",
    template: "%s · VerdictPay",
  },
  description:
    "Pre-dispute telemetry, deterministic PayPal dispute EV triage and seller-protection evidence defence.",
  applicationName: "VerdictPay",
  icons: {
    icon: [{ url: "/favicon.svg", type: "image/svg+xml" }],
  },
};

export const viewport: Viewport = {
  themeColor: "#171719",
  colorScheme: "dark",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body className="min-h-dvh bg-ground text-ink antialiased">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}
