"use client";

import { useCallback, useEffect, useState } from "react";
import type { HistoryResponse, TodayResponse } from "./api-types";
import { getAllRates, openRatesDb, type RateRecord } from "./rates-db";
import { syncRates } from "./rates-sync";

export interface UseRateDataResult {
  records: RateRecord[];
  /** True only for the very first load, before any local data is on screen. */
  isLoading: boolean;
  /** True while a background sync (initial load or manual refresh) is in flight. */
  isSyncing: boolean;
  error: string | null;
  refresh: () => Promise<void>;
}

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`${url} responded with ${response.status}`);
  }
  return (await response.json()) as T;
}

/**
 * Loads cached rates from IndexedDB immediately, then syncs with
 * /api/today + /api/history in the background (on mount and on demand).
 * IndexedDB access only exists client-side, hence "use client".
 */
export function useRateData(): UseRateDataResult {
  const [records, setRecords] = useState<RateRecord[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setIsSyncing(true);
    try {
      const db = await openRatesDb();
      const [today, history] = await Promise.all([
        fetchJson<TodayResponse>("/api/today").catch(() => null),
        fetchJson<HistoryResponse>("/api/history"),
      ]);
      await syncRates(db, today, history);
      setRecords(await getAllRates(db));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "同步失败");
    } finally {
      setIsSyncing(false);
      setIsLoading(false);
    }
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadThenSync() {
      const db = await openRatesDb();
      const cached = await getAllRates(db);
      if (!cancelled && cached.length > 0) {
        setRecords(cached);
        setIsLoading(false);
      }
      await refresh();
    }

    void loadThenSync();
    return () => {
      cancelled = true;
    };
    // `refresh` is stable (useCallback with no deps); only run on mount.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return { records, isLoading, isSyncing, error, refresh };
}
