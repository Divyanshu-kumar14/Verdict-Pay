import type { ReactNode } from "react";

import { PageTransition } from "@/components/ui/PageTransition";

/**
 * Shared-layout transitions (Part 3): the template remounts on every navigation
 * while the AppShell (sidebar + top bar) rendered by layout.tsx stays mounted.
 * Each route change therefore replays the single 220ms content entrance rather
 * than reloading the navigation structure.
 */
export default function Template({ children }: { children: ReactNode }) {
  return <PageTransition>{children}</PageTransition>;
}
