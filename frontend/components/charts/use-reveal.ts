"use client";

/**
 * One-shot reveal gate for the hand-built chart kit.
 *
 * Returns ready=false on first paint so bars, arcs and lines can transition
 * from their zero state exactly once. Under prefers-reduced-motion the charts
 * render their final geometry immediately with no transition.
 */

import { useEffect, useState } from "react";

export function useReveal(): { ready: boolean; reduce: boolean } {
  const [ready, setReady] = useState(false);
  const [reduce, setReduce] = useState(false);

  useEffect(() => {
    const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    setReduce(reduced);
    if (reduced) {
      setReady(true);
      return;
    }
    let second = 0;
    const first = requestAnimationFrame(() => {
      second = requestAnimationFrame(() => setReady(true));
    });
    return () => {
      cancelAnimationFrame(first);
      if (second !== 0) cancelAnimationFrame(second);
    };
  }, []);

  return { ready, reduce };
}
