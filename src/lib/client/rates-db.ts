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
