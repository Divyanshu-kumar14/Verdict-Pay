"use client";

import dynamic from "next/dynamic";

import { Skeleton } from "@/components/ui/Skeleton";
import type { DisputesGridProps } from "./DisputesGrid";

const Grid = dynamic(() => import("./DisputesGrid").then((module) => module.DisputesGrid), {
  ssr: false,
  loading: () => (
    <div className="space-y-2 p-3" aria-busy="true" aria-label="Loading dispute grid">
      <Skeleton className="h-8 w-full" />
      {Array.from({ length: 7 }, (_, index) => (
        <Skeleton key={index} className="h-10 w-full" />
      ))}
    </div>
  ),
});

/** Client-only gateway to AG Grid (the grid needs a real DOM). */
export function DisputesGridLoader(props: DisputesGridProps) {
  return <Grid {...props} />;
}
