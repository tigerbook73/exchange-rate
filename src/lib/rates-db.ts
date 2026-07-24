import { openDB, type DBSchema, type IDBPDatabase } from "idb";

export type RateSource = "today" | "history" | "carried-forward";

export interface RateRecord {
  /** ISO date, e.g. "2026-07-24". Primary key. */
  date: string;
  huiSell: number;
  /** Only present for source: "today" records. */
  publishedAt: string | null;
  source: RateSource;
  /** Only present for source: "carried-forward" records; points at the real record's date. */
  carriedFromDate: string | null;
}

interface FxCacheSchema extends DBSchema {
  rates: {
    key: string;
    value: RateRecord;
  };
}

const DB_NAME = "fx-cache";
const DB_VERSION = 1;
const STORE_NAME = "rates";

export type RatesDb = IDBPDatabase<FxCacheSchema>;

export function openRatesDb(): Promise<RatesDb> {
  return openDB<FxCacheSchema>(DB_NAME, DB_VERSION, {
    upgrade(db) {
      db.createObjectStore(STORE_NAME, { keyPath: "date" });
    },
  });
}

export async function upsertRates(
  db: RatesDb,
  records: RateRecord[],
): Promise<void> {
  const tx = db.transaction(STORE_NAME, "readwrite");
  await Promise.all([
    ...records.map((record) => tx.store.put(record)),
    tx.done,
  ]);
}

export async function getAllRates(db: RatesDb): Promise<RateRecord[]> {
  return db.getAll(STORE_NAME);
}
