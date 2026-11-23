import { describe, expect, it } from "vitest";
import { dailyGapFills } from "./daily-gaps";
import type { RateRecord } from "../contracts/rate-types";

const real = (date: string, huiSell = 4.4331): RateRecord => ({
  date,
  huiSell,
  publishedAt: null,
  source: "history",
  carriedFromDate: null,
});

describe("completed daily gaps", () => {
  it("fills through yesterday without requiring a newer real quote", () => {
    const fills = dailyGapFills([real("2026-11-21")], "2026-11-23");
    expect(fills.map((r) => r.date)).toEqual(["2026-11-22", "2026-11-23"]);
    expect(fills.every((r) => r.carriedFromDate === "2026-11-21")).toBe(true);
  });

  it("uses each preceding real quote and preserves existing real records", () => {
    const fills = dailyGapFills(
      [real("2026-11-23", 4.446), real("2026-11-21")],
      "2026-11-24",
    );
    expect(fills.map((r) => [r.date, r.huiSell, r.carriedFromDate])).toEqual([
      ["2026-11-22", 4.4331, "2026-11-21"],
      ["2026-11-24", 4.446, "2026-11-23"],
    ]);
  });

  it("cannot fill backwards or use a carried record as the real anchor", () => {
    expect(dailyGapFills([], "2026-11-22")).toEqual([]);
    expect(dailyGapFills([real("2026-11-23")], "2026-11-22")).toEqual([]);
    expect(
      dailyGapFills(
        [
          {
            ...real("2026-11-21"),
            source: "carried-forward",
            carriedFromDate: "2026-11-20",
          },
        ],
        "2026-11-22",
      ),
    ).toEqual([]);
  });

  it("repairs stale carried values after a real historical correction, idempotently", () => {
    const original = [real("2026-11-20")];
    const oldFills = dailyGapFills(original, "2026-11-23");
    const records = [...original, ...oldFills, real("2026-11-21", 4.5)];
    const fills = dailyGapFills(records, "2026-11-23");
    expect(fills.map((r) => [r.date, r.huiSell, r.carriedFromDate])).toEqual([
      ["2026-11-22", 4.5, "2026-11-21"],
      ["2026-11-23", 4.5, "2026-11-21"],
    ]);
    expect(dailyGapFills([...records, ...fills], "2026-11-23")).toEqual([]);
  });

  it("walks calendar dates across years and leap days", () => {
    expect(
      dailyGapFills([real("2025-12-31")], "2026-01-02").map((r) => r.date),
    ).toEqual(["2026-01-01", "2026-01-02"]);
    expect(
      dailyGapFills([real("2024-02-28")], "2024-03-01").map((r) => r.date),
    ).toEqual(["2024-02-29", "2024-03-01"]);
  });
});
