"use client";

import { useEffect, useState } from "react";

/**
 * Re-renders relative deadlines while the page is open. Returns null until the
 * component mounts, which keeps server and client markup identical.
 */
export function useNow(intervalMs = 30000): number | null {
  const [now, setNow] = useState<number | null>(null);

  useEffect(() => {
    setNow(Date.now());
    const timer = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(timer);
  }, [intervalMs]);

  return now;
}
