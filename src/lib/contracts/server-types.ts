import type { RateRecord } from "./rate-types";

export const MINUTE_MS = 60_000;
export const FIXED_MS = 5 * MINUTE_MS;
export const SYNC_SCHEMA = 1;

export interface QuoteSample {
  minute: number;
  requestedAt: string;
  receivedAt: string;
  publishedAt: string;
  date: string;
  priceUnits: number;
}

export interface IntradayPoint {
  minute: number;
  priceUnits: number | null;
  sourceMinute: number | null;
  sourceRequestedAt: string | null;
  publishedAt: string | null;
  isFallback: boolean;
  kind: "fixed" | "live";
}

export interface CollectionState {
  startedAt: string | null;
  lastAttemptMinute: number | null;
  lastAttemptAt: string | null;
  lastScheduledAt: string | null;
  lastCheckedAt: string | null;
  lastSuccess: QuoteSample | null;
  lastFinalized: number | null;
  live: IntradayPoint | null;
  consecutiveFailures: number;
  lastError: string | null;
  historyDate: string | null;
  historyAttemptDate: string | null;
  historyAttempts: number;
  historyError: string | null;
  /** Last completed Beijing date processed by daily gap maintenance. */
  dailyFilledThrough: string | null;
  demo: boolean;
}

export function emptyCollectionState(): CollectionState {
  return {
    startedAt: null,
    lastAttemptMinute: null,
    lastAttemptAt: null,
    lastScheduledAt: null,
    lastCheckedAt: null,
    lastSuccess: null,
    lastFinalized: null,
    live: null,
    consecutiveFailures: 0,
    lastError: null,
    historyDate: null,
    historyAttemptDate: null,
    historyAttempts: 0,
    historyError: null,
    dailyFilledThrough: null,
    demo: false,
  };
}

export interface SyncResponse {
  schema: typeof SYNC_SCHEMA;
  datasetId: string;
  revision: number;
  cursor: string;
  mode: "snapshot" | "delta";
  generatedAt: string;
  retainedFrom: string;
  historyFrom: string;
  daily: RateRecord[];
  points: IntradayPoint[];
  deletedDaily: string[];
  deletedPoints: number[];
  state: CollectionState;
}
