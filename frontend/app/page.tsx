import type { Metadata } from "next";

import { SandboxWorkspace } from "@/components/sandbox/SandboxWorkspace";

export const metadata: Metadata = {
  title: "Judge sandbox",
};

export default function SandboxPage() {
  return <SandboxWorkspace />;
}
