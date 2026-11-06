import type { Metadata } from "next";

import { SiteNav } from "@/components/marketing";
import { SandboxWorkspace } from "@/components/sandbox/SandboxWorkspace";

export const metadata: Metadata = {
  title: "Live demo",
  description:
    "Run the three-step simulation: checkout, usage telemetry and a friendly-fraud dispute, priced and defended by VerdictPay in real time.",
};

export default function DemoPage() {
  return (
    <>
      <SiteNav />
      <main className="mx-auto w-full max-w-[1120px] px-6 pt-10 pb-16 sm:pt-14 sm:pb-20">
        <SandboxWorkspace />
      </main>
    </>
  );
}
