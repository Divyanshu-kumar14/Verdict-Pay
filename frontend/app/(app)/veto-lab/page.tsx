import type { Metadata } from "next";

import { VetoLabWorkspace } from "@/components/vetolab/VetoLabWorkspace";

export const metadata: Metadata = {
  title: "Veto Lab",
};

export default function VetoLabPage() {
  return <VetoLabWorkspace />;
}
