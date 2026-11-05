import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";

import { GeistMono } from "geist/font/mono";
import { GeistSans } from "geist/font/sans";

import { AppShell } from "@/components/AppShell";

import "./globals.css";

export const metadata: Metadata = {
  title: {
    default: "VerdictPay — Merchant Command Center",
    template: "%s · VerdictPay",
  },
  description:
    "Pre-dispute telemetry, deterministic PayPal dispute EV triage and seller-protection evidence defense.",
  applicationName: "VerdictPay",
  icons: {
    icon: [{ url: "/favicon.svg", type: "image/svg+xml" }],
  },
};

export const viewport: Viewport = {
  themeColor: "#080b0f",
  colorScheme: "dark",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={`${GeistSans.variable} ${GeistMono.variable}`}>
      <body className="min-h-dvh bg-void text-ink antialiased">
        <AppShell>{children}</AppShell>
      </body>
    </html>
  );
}