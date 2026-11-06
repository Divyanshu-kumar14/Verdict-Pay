"use client";

import dynamic from "next/dynamic";

import { Skeleton } from "@/components/ui/Skeleton";
import type { DisputesGridProps } from "./DisputesGrid";

const Grid = dynamic(() => import("./DisputesGrid").then((module) => module.DisputesGrid), {
  ssr: false,
  loading: () => (
    <div className="space-y-2.5 p-4" aria-busy="true" aria-label="Loading dispute grid">
      <Skeleton className="h-9 w-full" />
      {Array.from({ length: 8 }, (_, index) => (
        <Skeleton key={index} className="h-row w-full" />
      ))}
    </div>
  ),
});

/** Client-only gateway to AG Grid (the grid needs a real DOM). */
export function DisputesGridLoader(props: DisputesGridProps) {
  return <Grid {...props} />;
}
