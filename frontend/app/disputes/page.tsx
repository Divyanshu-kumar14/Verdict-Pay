import type { Metadata } from "next";

import { DisputesWorkspace } from "@/components/disputes/DisputesWorkspace";

export const metadata: Metadata = {
  title: "Dispute exposure",
};

export default function DisputesPage() {
  return <DisputesWorkspace />;
}
