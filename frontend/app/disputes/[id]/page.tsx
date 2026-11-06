import type { Metadata } from "next";

import { CaseRoom } from "@/components/disputes/CaseRoom";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ id: string }>;
}): Promise<Metadata> {
  const { id } = await params;
  return { title: "Case room: " + id };
}

export default async function CaseRoomPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  return <CaseRoom key={id} caseId={id} />;
}
