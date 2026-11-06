import type { Metadata, Viewport } from "next";
import type { ReactNode } from "react";
import { Inter, JetBrains_Mono } from "next/font/google";

import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
  display: "swap",
});

const jetbrains = JetBrains_Mono({
  subsets: ["latin"],
  variable: "--font-jetbrains",
  display: "swap",
});

export const metadata: Metadata = {
  metadataBase: new URL("https://verdictpay-web.onrender.com"),
  title: {
    default: "VerdictPay — Win the disputes you would normally eat",
    template: "%s · VerdictPay",
  },
  description:
    "Pre-dispute telemetry, deterministic PayPal dispute EV triage and SHA-256-signed seller-protection evidence defence. Price every friendly-fraud inquiry before you answer it.",
  applicationName: "VerdictPay",
  keywords: [
    "PayPal disputes",
    "friendly fraud",
    "chargeback management",
    "seller protection",
    "dispute EV",
  ],
  openGraph: {
    title: "VerdictPay — Win the disputes you would normally eat",
    description:
      "Deterministic PayPal dispute EV triage and signed evidence defence for merchants.",
    url: "https://verdictpay-web.onrender.com",
    siteName: "VerdictPay",
    type: "website",
    images: [{ url: "/og-image.svg", width: 1200, height: 630, alt: "VerdictPay" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "VerdictPay — Win the disputes you would normally eat",
    description: "Deterministic PayPal dispute EV triage and signed evidence defence.",
  },
  icons: {
    icon: [{ url: "/favicon.svg", type: "image/svg+xml" }],
  },
};

export const viewport: Viewport = {
  themeColor: "#0b0b0d",
  colorScheme: "dark",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" className={inter.variable + " " + jetbrains.variable}>
      <body className="min-h-dvh bg-ground font-sans text-ink antialiased">{children}</body>
    </html>
  );
}
