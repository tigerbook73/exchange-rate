"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { HISTORY_LOOKBACK_DAYS } from "./api-cache";
import type { HistoryResponse, TodayResponse } from "./api-types";
import { addDays, getBeijingDateString } from "./date";
import {
  getAllRates,
  getEarliestDate,
  getLatestDate,
  openRatesDb,
  type RateRecord,
} from "./rates-db";
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
  const isRefreshingRef = useRef(false);

  const refresh = useCallback(async () => {
    // Mobile wake-up can emit visibilitychange, pageshow and focus together.
    // Keep a single sync in flight, including the initial/manual refresh.
    if (isRefreshingRef.current) return;
    isRefreshingRef.current = true;
    setIsSyncing(true);
    try {
      const db = await openRatesDb();
      const [latestLocalDate, earliestLocalDate] = await Promise.all([
        getLatestDate(db),
        getEarliestDate(db),
      ]);
      const beijingToday = getBeijingDateString();
      // Local history might exist but not go back far enough yet — e.g. a
      // device that only ever ran an older build that capped it at ~28 days.
      // In that case a plain incremental fetch would never backfill the
      // missing older days, so fall back to a full re-backfill instead.
      const backfillBoundary = addDays(beijingToday, -HISTORY_LOOKBACK_DAYS);
      const needsBackfill =
        !earliestLocalDate || earliestLocalDate > backfillBoundary;
      // The local record for `latestLocalDate` may only be a same-day
      // /api/today snapshot (grabbed before that day's rate was finalized),
      // not yet confirmed against /api/history — so re-request that date
      // too (`datefrom = latestLocalDate`, not `+ 1`) rather than treating
      // it as settled just because we have *some* value for it. Once
      // history returns a row for that date it overwrites the /api/today-
      // sourced one (see toRateRecords), correcting it if needed.
      // Only skip entirely once local history is caught up to today itself
      // — today's row always comes from /api/today, never /api/history (see
      // toRateRecords), so a history call at that point has nothing to add.
      const upToDate = !needsBackfill && latestLocalDate === beijingToday;
      const historyUrl =
        latestLocalDate && !needsBackfill
          ? `/api/history?datefrom=${latestLocalDate}`
          : "/api/history";
      const [today, history] = await Promise.all([
        fetchJson<TodayResponse>("/api/today").catch(() => null),
        upToDate
          ? Promise.resolve<HistoryResponse>({
              currency: "aud",
              bank: "icbc",
              field: "huiSell",
              series: [],
            })
          : fetchJson<HistoryResponse>(historyUrl),
      ]);
      await syncRates(db, today, history);
      setRecords(await getAllRates(db));
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : "同步失败");
    } finally {
      isRefreshingRef.current = false;
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

  useEffect(() => {
    // A resumed PWA may keep the component mounted. Always try to sync
    // when it becomes visible; shared API caching still protects the source.
    function refreshWhenVisible() {
      if (document.visibilityState !== "visible") return;
      void refresh();
    }

    function handlePageShow(event: PageTransitionEvent) {
      // Initial navigation is already handled by loadThenSync. A bfcache
      // restore does not remount React, so it needs an explicit refresh.
      if (event.persisted) refreshWhenVisible();
    }

    document.addEventListener("visibilitychange", refreshWhenVisible);
    window.addEventListener("pageshow", handlePageShow);
    window.addEventListener("focus", refreshWhenVisible);
    return () => {
      document.removeEventListener("visibilitychange", refreshWhenVisible);
      window.removeEventListener("pageshow", handlePageShow);
      window.removeEventListener("focus", refreshWhenVisible);
    };
  }, [refresh]);

  return { records, isLoading, isSyncing, error, refresh };
}
