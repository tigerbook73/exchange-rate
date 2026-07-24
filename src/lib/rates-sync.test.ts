import { afterEach, beforeEach, describe, expect, it } from "vitest";
import type { HistoryResponse, TodayResponse } from "./api-types";
import {
  getAllRates,
  openRatesDb,
  upsertRates,
  type RateRecord,
  type RatesDb,
} from "./rates-db";
import {
  computeCarriedForwardFills,
  syncRates,
  toRateRecords,
} from "./rates-sync";

describe("toRateRecords", () => {
  it("prefers the today record over the same-date history point", () => {
    const today: TodayResponse = {
      bank: "icbc",
      currency: "aud",
      date: "2026-07-24",
      publishedAt: "2026-07-24T10:30:00+08:00",
      huiSell: 4.7481,
    };
    const history: HistoryResponse = {
      currency: "aud",
      bank: "icbc",
      field: "huiSell",
      series: [
        { date: "2026-07-24", huiSell: 4.7484 },
        { date: "2026-07-23", huiSell: 4.7459 },
      ],
    };

    const records = toRateRecords(today, history);
    const byDate = new Map(records.map((r) => [r.date, r]));

    expect(byDate.get("2026-07-24")).toEqual({
      date: "2026-07-24",
      huiSell: 4.7481,
      publishedAt: "2026-07-24T10:30:00+08:00",
      source: "today",
      carriedFromDate: null,
    });
    expect(byDate.get("2026-07-23")).toEqual({
      date: "2026-07-23",
      huiSell: 4.7459,
      publishedAt: null,
      source: "history",
      carriedFromDate: null,
    });
  });
});

describe("computeCarriedForwardFills", () => {
  const real = (date: string, huiSell: number): RateRecord => ({
    date,
    huiSell,
    publishedAt: null,
    source: "history",
    carriedFromDate: null,
  });

  it("fills a gap within the window from the nearest earlier real record", () => {
    const window = ["2026-07-18", "2026-07-19", "2026-07-20"]; // Sun (07-19) missing
    const existing = [real("2026-07-18", 4.75), real("2026-07-20", 4.76)];

    const fills = computeCarriedForwardFills(window, existing);

    expect(fills).toEqual([
      {
        date: "2026-07-19",
        huiSell: 4.75,
        publishedAt: null,
        source: "carried-forward",
        carriedFromDate: "2026-07-18",
      },
    ]);
  });

  it("does not fill a gap that has nothing earlier in the window", () => {
    const window = ["2026-07-19", "2026-07-20"]; // window starts on the gap itself
    const existing = [real("2026-07-20", 4.76)];

    expect(computeCarriedForwardFills(window, existing)).toEqual([]);
  });

  it("does not look outside the given window", () => {
    const window = ["2026-07-20", "2026-07-21"];
    // A gap on 2026-07-19 exists locally but isn't part of this window, so
    // it must be left alone (handled as an unrecoverable gap elsewhere).
    const existing = [real("2026-07-18", 4.75), real("2026-07-21", 4.77)];

    const fills = computeCarriedForwardFills(window, existing);

    expect(fills.map((f) => f.date)).toEqual([]);
  });

  it("chains carriedFromDate back to the real record, not another fill", () => {
    const window = ["2026-07-17", "2026-07-18", "2026-07-19", "2026-07-20"];
    const existing = [
      real("2026-07-17", 4.74),
      {
        date: "2026-07-18",
        huiSell: 4.74,
        publishedAt: null,
        source: "carried-forward" as const,
        carriedFromDate: "2026-07-17",
      },
      real("2026-07-20", 4.76),
    ];

    const fills = computeCarriedForwardFills(window, existing);
    const fillFor19 = fills.find((f) => f.date === "2026-07-19");

    expect(fillFor19?.carriedFromDate).toBe("2026-07-17");
  });
});

describe("syncRates (with fake-indexeddb)", () => {
  let db: RatesDb;

  beforeEach(async () => {
    // fake-indexeddb's global store persists across tests within a file,
    // so start each test from a clean database.
    await new Promise<void>((resolve, reject) => {
      const req = indexedDB.deleteDatabase("fx-cache");
      req.onsuccess = () => resolve();
      req.onerror = () => reject(req.error as DOMException);
      req.onblocked = () => resolve();
    });
    db = await openRatesDb();
  });

  afterEach(() => {
    db.close();
  });

  it("merges today+history and fills the Sunday gap in the window", async () => {
    const today: TodayResponse = {
      bank: "icbc",
      currency: "aud",
      date: "2026-07-20",
      publishedAt: "2026-07-20T10:30:00+08:00",
      huiSell: 4.76,
    };
    const history: HistoryResponse = {
      currency: "aud",
      bank: "icbc",
      field: "huiSell",
      series: [
        { date: "2026-07-20", huiSell: 4.76 },
        { date: "2026-07-18", huiSell: 4.75 }, // Saturday
        // 2026-07-19 (Sunday) intentionally absent, like the real source.
      ],
    };

    await syncRates(db, today, history);
    const all = await getAllRates(db);
    const byDate = new Map(all.map((r) => [r.date, r]));

    expect(byDate.get("2026-07-19")).toEqual({
      date: "2026-07-19",
      huiSell: 4.75,
      publishedAt: null,
      source: "carried-forward",
      carriedFromDate: "2026-07-18",
    });
  });

  it("clears a carried-forward marker once real data arrives for that date", async () => {
    // First sync: 07-19 is missing from the source, gets carried forward.
    await syncRates(db, null, {
      currency: "aud",
      bank: "icbc",
      field: "huiSell",
      series: [
        { date: "2026-07-20", huiSell: 4.76 },
        { date: "2026-07-18", huiSell: 4.75 },
      ],
    });
    expect(
      (await getAllRates(db)).find((r) => r.date === "2026-07-19")?.source,
    ).toBe("carried-forward");

    // Second sync: the source now has real data for 07-19.
    await syncRates(db, null, {
      currency: "aud",
      bank: "icbc",
      field: "huiSell",
      series: [
        { date: "2026-07-20", huiSell: 4.76 },
        { date: "2026-07-19", huiSell: 4.755 },
        { date: "2026-07-18", huiSell: 4.75 },
      ],
    });

    const record = (await getAllRates(db)).find((r) => r.date === "2026-07-19");
    expect(record).toEqual({
      date: "2026-07-19",
      huiSell: 4.755,
      publishedAt: null,
      source: "history",
      carriedFromDate: null,
    });
  });

  it("upsert overwrites an existing record for the same date", async () => {
    await upsertRates(db, [
      {
        date: "2026-07-24",
        huiSell: 1,
        publishedAt: null,
        source: "history",
        carriedFromDate: null,
      },
    ]);
    await upsertRates(db, [
      {
        date: "2026-07-24",
        huiSell: 2,
        publishedAt: "2026-07-24T10:30:00+08:00",
        source: "today",
        carriedFromDate: null,
      },
    ]);

    const all = await getAllRates(db);
    expect(all).toHaveLength(1);
    expect(all[0]?.huiSell).toBe(2);
    expect(all[0]?.source).toBe("today");
  });
});
