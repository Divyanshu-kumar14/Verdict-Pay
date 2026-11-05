import type { Metadata } from "next";

import { CaseRoom } from "@/components/disputes/CaseRoom";

export const metadata: Metadata = {
  title: "Case room",
};

export default async function CaseRoomPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CaseRoom key={id} caseId={id} />;
}
