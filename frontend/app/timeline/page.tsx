import type { Metadata } from "next";

import { TimelineBoard } from "@/components/timeline/TimelineBoard";

export const metadata: Metadata = {
  title: "SLA command board",
};

export default function TimelinePage() {
  return <TimelineBoard />;
}
