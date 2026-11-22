import { deleteDB } from "idb";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyServerSync, readClientCache } from "./client-sync";
import { openRatesDb, type RatesDb } from "./rates-db";
import { emptyCollectionState, type SyncResponse } from "./server-types";

let db: RatesDb;
const id = "a".repeat(32);
function response(
  revision = 1,
  mode: SyncResponse["mode"] = "snapshot",
): SyncResponse {
  return {
    schema: 1,
    datasetId: id,
    revision,
    cursor: `${id}.${revision}`,
    mode,
    generatedAt: "2026-11-22T10:00:00+08:00",
    retainedFrom: "2026-11-20",
    historyFrom: "2025-11-22",
    daily: [
      {
        date: "2026-11-22",
        huiSell: 4.75,
        publishedAt: null,
        source: "today",
        carriedFromDate: null,
      },
    ],
    points: [],
    deletedDaily: [],
    deletedPoints: [],
    state: emptyCollectionState(),
  };
}
beforeEach(async () => {
  await deleteDB("fx-cache");
  db = await openRatesDb();
});
afterEach(() => db.close());
describe("client authority and incremental sync", () => {
  it("clears obsolete local archives only with a validated replacement snapshot", async () => {
    await applyServerSync(db, response());
    await db.put("rates", {
      date: "2020-01-01",
      huiSell: 4.1234,
      publishedAt: null,
      source: "history",
      carriedFromDate: null,
    });
    const invalid = response(2);
    invalid.daily[0].huiSell = 0;
    await expect(applyServerSync(db, invalid, true)).rejects.toThrow();
    expect(await db.get("rates", "2020-01-01")).toBeDefined();
    await applyServerSync(db, response(2), true);
    expect(await db.get("rates", "2020-01-01")).toBeUndefined();
    expect((await readClientCache(db)).records[0].huiSell).toBe(4.75);
  });
  it("keeps one live point, replacing and clearing it through metadata", async () => {
    const data = response();
    data.state.live = {
      minute: Date.parse("2026-11-22T10:01:00+08:00"),
      priceUnits: 47500,
      sourceMinute: null,
      sourceRequestedAt: null,
      publishedAt: null,
      kind: "live",
      isFallback: false,
    };
    await applyServerSync(db, data);
    const next = response(2, "delta");
    next.daily = [];
    next.state.live = {
      ...data.state.live,
      minute: Date.parse("2026-11-22T10:02:00+08:00"),
    };
    await applyServerSync(db, next);
    expect((await readClientCache(db)).server?.state.live?.minute).toBe(
      next.state.live.minute,
    );
    next.state.live = null;
    next.revision = 3;
    next.cursor = `${id}.3`;
    await applyServerSync(db, next);
    expect((await readClientCache(db)).server?.state.live).toBeNull();
    expect((await readClientCache(db)).points).toEqual([]);
  });
  it("replaces an authoritative snapshot window rather than leaving withdrawn values", async () => {
    await applyServerSync(db, response());
    const corrected = response(2);
    corrected.daily = [];
    await applyServerSync(db, corrected);
    expect((await readClientCache(db)).records).toEqual([]);
  });
  it("rejects stale SW responses and invalid payloads without losing offline data", async () => {
    await applyServerSync(db, response(3));
    expect(await applyServerSync(db, response(2, "delta"))).toBe(false);
    const invalid = response(4);
    invalid.daily[0].huiSell = 0;
    await expect(applyServerSync(db, invalid)).rejects.toThrow();
    expect((await readClientCache(db)).server?.revision).toBe(3);
    expect((await readClientCache(db)).records[0].huiSell).toBe(4.75);
  });
});
