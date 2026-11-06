"use client";

/**
 * One polling primitive for every async surface.
 *
 * Guarantees: one request in flight at a time, the loop pauses while the tab is
 * hidden, a manual refresh aborts the previous request, and unmount aborts
 * everything. Pages choose their own interval (2s for live queues and cases).
 *
 * Rendering discipline: a background poll that returns byte-identical data does
 * NOT re-render the tree (the payload is deduped against the last one), and the
 * `refreshing` flag is reserved for manual refreshes only — otherwise a 2s poll
 * would flicker the refresh button spinner and force AG Grid to re-render its
 * rows twice a second.
 */

import { useCallback, useEffect, useRef, useState } from "react";

import { toApiError, type ApiError } from "../api";

export type PolledQuery<T> = {
  data: T | null;
  error: ApiError | null;
  loading: boolean;
  refreshing: boolean;
  updatedAt: number | null;
  refresh: () => void;
};

export type PolledQueryOptions = {
  intervalMs?: number;
  enabled?: boolean;
};

export function usePolledQuery<T>(
  key: string,
  fetcher: (signal: AbortSignal) => Promise<T>,
  options: PolledQueryOptions = {},
): PolledQuery<T> {
  const intervalMs = options.intervalMs ?? 0;
  const enabled = options.enabled ?? true;

  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const [updatedAt, setUpdatedAt] = useState<number | null>(null);
  const [refreshToken, setRefreshToken] = useState(0);
  const [manualRefreshing, setManualRefreshing] = useState(false);

  const fetcherRef = useRef(fetcher);
  const activeKeyRef = useRef<string | null>(null);
  const lastJsonRef = useRef<string | null>(null);
  const manualRef = useRef(false);

  useEffect(() => {
    fetcherRef.current = fetcher;
  }, [fetcher]);

  useEffect(() => {
    if (!enabled) return;

    if (activeKeyRef.current !== key) {
      activeKeyRef.current = key;
      lastJsonRef.current = null;
      setData(null);
      setError(null);
      setUpdatedAt(null);
    }

    let cancelled = false;
    let running = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const controller = new AbortController();

    const run = async (): Promise<void> => {
      if (cancelled || running) return;
      if (typeof document !== "undefined" && document.hidden) {
        schedule();
        return;
      }
      running = true;
      try {
        const result = await fetcherRef.current(controller.signal);
        if (cancelled) return;
        const json = JSON.stringify(result ?? null);
        if (json !== lastJsonRef.current) {
          lastJsonRef.current = json;
          setData(result);
        }
        setError(null);
        setUpdatedAt(Date.now());
      } catch (caught) {
        if (cancelled) return;
        const apiError = toApiError(caught);
        if (apiError.code !== "aborted") setError(apiError);
      } finally {
        running = false;
        if (!cancelled) {
          if (manualRef.current) {
            manualRef.current = false;
            setManualRefreshing(false);
          }
          schedule();
        }
      }
    };

    const schedule = (): void => {
      if (cancelled || intervalMs <= 0) return;
      timer = setTimeout(() => {
        void run();
      }, intervalMs);
    };

    const onVisibilityChange = (): void => {
      if (typeof document !== "undefined" && !document.hidden) {
        if (timer !== undefined) {
          clearTimeout(timer);
          timer = undefined;
        }
        void run();
      }
    };

    void run();
    if (typeof document !== "undefined") {
      document.addEventListener("visibilitychange", onVisibilityChange);
    }

    return () => {
      cancelled = true;
      controller.abort();
      if (timer !== undefined) clearTimeout(timer);
      if (typeof document !== "undefined") {
        document.removeEventListener("visibilitychange", onVisibilityChange);
      }
    };
  }, [key, enabled, intervalMs, refreshToken]);

  const refresh = useCallback(() => {
    manualRef.current = true;
    setManualRefreshing(true);
    setRefreshToken((token) => token + 1);
  }, []);

  return {
    data,
    error,
    loading: enabled && data === null && error === null,
    refreshing: manualRefreshing,
    updatedAt,
    refresh,
  };
}
