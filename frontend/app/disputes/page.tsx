import type { Metadata } from "next";

import { DisputesWorkspace } from "@/components/disputes/DisputesWorkspace";

export const metadata: Metadata = {
  title: "Triage queue",
};

export default function DisputesPage() {
  return <DisputesWorkspace />;
}
