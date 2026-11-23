import { deleteDB } from "idb";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { applyServerSync, readClientCache } from "./client-sync";
import { openRatesDb, type RatesDb } from "./rates-db";
import {
  emptyCollectionState,
  type SyncResponse,
} from "../contracts/server-types";
import { buildChartSeries } from "../domain/rate-view";

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
  it("updates the chart series when a delta fills a missing day and then corrects it", async () => {
    await applyServerSync(db, response());
    const chart = async () =>
      buildChartSeries((await readClientCache(db)).records, "7d", "2026-11-22");
    expect(
      (await chart()).find((r) => r.date === "2026-11-21")?.huiSell,
    ).toBeNull();
    const delta = response(2, "delta");
    delta.daily = [
      {
        date: "2026-11-21",
        huiSell: 4.4331,
        publishedAt: null,
        source: "carried-forward",
        carriedFromDate: "2026-11-20",
      },
    ];
    await applyServerSync(db, delta);
    expect((await chart()).find((r) => r.date === "2026-11-21")).toMatchObject({
      huiSell: 4.4331,
      isCarriedForward: true,
      note: "该日期未更新，数据来自 2026-11-20",
    });
    delta.revision = 3;
    delta.cursor = `${id}.3`;
    delta.daily = [
      {
        ...delta.daily[0],
        huiSell: 4.45,
        source: "history",
        carriedFromDate: null,
      },
    ];
    await applyServerSync(db, delta);
    expect((await chart()).find((r) => r.date === "2026-11-21")).toMatchObject({
      huiSell: 4.45,
      isCarriedForward: false,
      note: undefined,
    });
    expect(
      (await readClientCache(db)).records.find((r) => r.date === "2026-11-22")
        ?.huiSell,
    ).toBe(4.75);
  });
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
  it("atomically expires timestamp keys strictly before Beijing midnight during a delta", async () => {
    await applyServerSync(db, response(3));
    const boundary = Date.parse("2026-11-20T00:00:00+08:00");
    const minutes = [
      boundary - 300000,
      boundary - 1,
      boundary,
      boundary + 300000,
    ];
    for (const minute of minutes) {
      await db.put("points", {
        minute,
        kind: "fixed",
        priceUnits: 47500,
        sourceMinute: minute,
        sourceRequestedAt: null,
        publishedAt: null,
        isFallback: false,
      });
    }
    expect(await applyServerSync(db, response(2, "delta"))).toBe(false);
    expect(await db.getAllKeys("points")).toEqual(minutes);
    const delta = response(4, "delta");
    delta.daily = [];
    delta.deletedPoints = [boundary + 300000];
    await applyServerSync(db, delta);
    expect(await db.getAllKeys("points")).toEqual([boundary]);
    expect((await db.get("server", "current"))?.cursor).toBe(`${id}.4`);
    expect(await db.get("rates", "2026-11-22")).toBeDefined();
    const next = response(5, "delta");
    next.retainedFrom = "2026-11-21";
    next.daily = [];
    await applyServerSync(db, next);
    expect(await db.getAllKeys("points")).toEqual([]);
    expect((await db.get("server", "current"))?.cursor).toBe(`${id}.5`);
  });
});
