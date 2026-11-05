import type { Metadata } from "next";

import { AnalyticsWorkspace } from "@/components/analytics/AnalyticsWorkspace";

export const metadata: Metadata = {
  title: "Exposure canvas",
};

export default function AnalyticsPage() {
  return <AnalyticsWorkspace />;
}
