import type { Metadata } from "next";

import { SiteNav } from "@/components/marketing";
import { Comparison } from "@/components/marketing/Comparison";
import { CtaBand } from "@/components/marketing/CtaBand";
import { EvidenceChain } from "@/components/marketing/EvidenceChain";
import { Footer } from "@/components/marketing/Footer";
import { HowItWorks } from "@/components/marketing/HowItWorks";
import { LandingHero } from "@/components/marketing/LandingHero";
import { ProductSection } from "@/components/marketing/ProductSection";

export const metadata: Metadata = {
  title: "Win the disputes you would normally eat",
  description:
    "VerdictPay captures pre-dispute telemetry, scores every PayPal dispute by deterministic expected value, and defends it with SHA-256-signed seller-protection evidence.",
};

export default function LandingPage() {
  return (
    <>
      <SiteNav />
      <main>
        <LandingHero />
        <ProductSection />
        <HowItWorks />
        <EvidenceChain />
        <Comparison />
        <CtaBand />
      </main>
      <Footer />
    </>
  );
}
