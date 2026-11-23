import { openDB, type DBSchema, type IDBPDatabase } from "idb";
import type { IntradayPoint, SyncResponse } from "../contracts/server-types";

import type { RateRecord } from "../contracts/rate-types";

interface FxCacheSchema extends DBSchema {
  points: { key: number; value: IntradayPoint };
  server: { key: string; value: SyncResponse };
  rates: {
    key: string;
    value: RateRecord;
  };
}

const DB_NAME = "fx-cache";
const DB_VERSION = 2;
const STORE_NAME = "rates";

export type RatesDb = IDBPDatabase<FxCacheSchema>;

export function openRatesDb(): Promise<RatesDb> {
  return openDB<FxCacheSchema>(DB_NAME, DB_VERSION, {
    upgrade(db) {
      if (!db.objectStoreNames.contains(STORE_NAME))
        db.createObjectStore(STORE_NAME, { keyPath: "date" });
      if (!db.objectStoreNames.contains("points"))
        db.createObjectStore("points", { keyPath: "minute" });
      if (!db.objectStoreNames.contains("server"))
        db.createObjectStore("server");
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

/** The newest date with a local record, or null if the store is empty. */
export async function getLatestDate(db: RatesDb): Promise<string | null> {
  const records = await getAllRates(db);
  return records.reduce<string | null>(
    (max, r) => (max === null || r.date > max ? r.date : max),
    null,
  );
}

/** The oldest date with a local record, or null if the store is empty. */
export async function getEarliestDate(db: RatesDb): Promise<string | null> {
  const records = await getAllRates(db);
  return records.reduce<string | null>(
    (min, r) => (min === null || r.date < min ? r.date : min),
    null,
  );
}
