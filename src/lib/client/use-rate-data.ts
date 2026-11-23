"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { applyServerSync, readClientCache } from "./client-sync";
import { openRatesDb } from "./rates-db";
import type { SyncResponse } from "../contracts/server-types";
import { SYNC_SCHEMA } from "../contracts/server-types";
import {
  ApiUpgradeRequired,
  clearOldApiResponses,
  isSchemaVersion,
  needsCacheReset,
  prepareApiUpgrade,
  readUpgradeTicket,
  UPGRADE_KEY,
} from "./api-upgrade";

type Cache = Awaited<ReturnType<typeof readClientCache>>;

export function useRateData() {
  const [cache, setCache] = useState<Cache>({
    records: [],
    points: [],
    server: null,
  });
  const [isLoading, setIsLoading] = useState(true);
  const [isSyncing, setIsSyncing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [online, setOnline] = useState(true);
  const [now, setNow] = useState(Date.now);
  const refreshing = useRef(false);
  const mounted = useRef(false);
  const activeRequest = useRef<AbortController | null>(null);

  const refresh = useCallback(async () => {
    if (refreshing.current) return;
    if (!navigator.onLine) {
      setOnline(false);
      setIsLoading(false);
      return;
    }
    refreshing.current = true;
    setIsSyncing(true);
    const abort = new AbortController();
    activeRequest.current = abort;
    const timeout = setTimeout(() => abort.abort(), 20_000);
    try {
      const db = await openRatesDb();
      const previous = await db.get("server", "current");
      let ticket = null;
      try {
        ticket = readUpgradeTicket(sessionStorage);
      } catch {
        /* Storage may be unavailable; normal data sync still works. */
      }
      let resetLocalCache = needsCacheReset(previous);
      const bootstrapUrl = `/api/sync?schema=${SYNC_SCHEMA}`;
      let response = await fetch(
        previous && !resetLocalCache
          ? `${bootstrapUrl}&cursor=${encodeURIComponent(previous.cursor)}`
          : bootstrapUrl,
        { signal: abort.signal },
      );
      if (response.status === 409)
        response = await fetch(bootstrapUrl, { signal: abort.signal });
      if (response.status === 426) {
        const value: { error?: string; schema?: unknown } =
          await response.json();
        if (
          value.error === "client_upgrade_required" &&
          isSchemaVersion(value.schema)
        )
          throw new ApiUpgradeRequired(value.schema);
      }
      if (!response.ok)
        throw new Error(
          response.status === 503
            ? "服务端数据尚未就绪"
            : `同步失败（${response.status}）`,
        );
      const data: SyncResponse = await response.json();
      if (isSchemaVersion(data.schema) && data.schema !== SYNC_SCHEMA)
        throw new ApiUpgradeRequired(data.schema);
      resetLocalCache ||= Boolean(
        previous &&
        data.mode === "snapshot" &&
        previous.datasetId !== data.datasetId,
      );
      await applyServerSync(db, data, resetLocalCache);
      if (resetLocalCache || ticket?.targetSchema === SYNC_SCHEMA) {
        try {
          await clearOldApiResponses();
          sessionStorage.removeItem(UPGRADE_KEY);
        } catch {
          /* IndexedDB is already safely committed; cleanup is best effort. */
        }
      }
      const updated = await readClientCache(db);
      if (mounted.current) {
        setCache(updated);
        setError(null);
        setOnline(navigator.onLine);
      }
    } catch (err) {
      if (mounted.current) {
        if (err instanceof ApiUpgradeRequired) {
          let reload = false;
          try {
            reload =
              navigator.onLine &&
              document.visibilityState === "visible" &&
              prepareApiUpgrade(err.targetSchema, sessionStorage);
          } catch {
            /* Do not reload without a durable loop guard. */
          }
          if (reload) {
            setError("接口版本已更新，正在刷新应用…");
            window.location.reload();
          } else
            setError(
              "接口版本不兼容，自动更新未完成，请联网后重新打开应用（保留旧缓存）",
            );
        } else if (!navigator.onLine) {
          setOnline(false);
          setError(null);
        } else
          setError(
            err instanceof Error && err.name !== "AbortError"
              ? err.message
              : "服务端连接超时",
          );
      }
    } finally {
      clearTimeout(timeout);
      refreshing.current = false;
      activeRequest.current = null;
      if (mounted.current) {
        setIsSyncing(false);
        setIsLoading(false);
        setNow(Date.now());
      }
    }
  }, []);

  useEffect(() => {
    mounted.current = true;
    void (async () => {
      try {
        const db = await openRatesDb();
        const existing = await readClientCache(db);
        if (mounted.current) {
          setCache(existing);
          if (existing.records.length || existing.server) setIsLoading(false);
        }
      } catch {
        if (mounted.current) setError("无法读取本地缓存");
      }
      if (mounted.current) await refresh();
    })();
    function wake() {
      setNow(Date.now());
      setOnline(navigator.onLine);
      if (document.visibilityState === "visible" && navigator.onLine)
        void refresh();
    }
    function offline() {
      setOnline(false);
      activeRequest.current?.abort();
    }
    function pageshow(event: PageTransitionEvent) {
      if (event.persisted) wake();
    }
    const timer = setInterval(wake, 60_000);
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("focus", wake);
    window.addEventListener("pageshow", pageshow);
    window.addEventListener("online", wake);
    window.addEventListener("offline", offline);
    return () => {
      mounted.current = false;
      clearInterval(timer);
      activeRequest.current?.abort();
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("focus", wake);
      window.removeEventListener("pageshow", pageshow);
      window.removeEventListener("online", wake);
      window.removeEventListener("offline", offline);
    };
  }, [refresh]);

  return { ...cache, isLoading, isSyncing, error, online, now, refresh };
}
