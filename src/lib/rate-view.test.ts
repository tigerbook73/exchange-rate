import { describe, expect, it } from "vitest";
import type { RateRecord } from "./rates-db";
import { buildChartSeries, getCurrentRateView } from "./rate-view";

const real = (
  date: string,
  huiSell: number,
  source: RateRecord["source"] = "history",
): RateRecord => ({
  date,
  huiSell,
  publishedAt: source === "today" ? `${date}T10:30:00+08:00` : null,
  source,
  carriedFromDate: null,
});

describe("getCurrentRateView", () => {
  it("returns null when there are no local records", () => {
    expect(getCurrentRateView([])).toBeNull();
  });

  it("picks the latest date and reports no staleness for a real record", () => {
    const records = [
      real("2026-07-23", 4.7459),
      real("2026-07-24", 4.7481, "today"),
    ];

    expect(getCurrentRateView(records)).toEqual({
      huiSell: 4.7481,
      date: "2026-07-24",
      publishedAt: "2026-07-24T10:30:00+08:00",
      isCarriedForward: false,
      staleNote: null,
    });
  });

  it("flags a carried-forward latest record with a note pointing at the real date", () => {
    const records = [
      real("2026-07-18", 4.75),
      {
        date: "2026-07-19",
        huiSell: 4.75,
        publishedAt: null,
        source: "carried-forward" as const,
        carriedFromDate: "2026-07-18",
      },
    ];

    const view = getCurrentRateView(records);
    expect(view?.isCarriedForward).toBe(true);
    expect(view?.staleNote).toBe("数据未更新，来自 2026-07-18");
  });
});

describe("buildChartSeries", () => {
  it("returns an empty series when there are no local records", () => {
    expect(buildChartSeries([], "7d", "2026-07-24")).toEqual([]);
  });

  it("builds a continuous 7-day range ending at 'today', nulling unrecoverable gaps", () => {
    const records = [
      real("2026-07-24", 4.7481),
      real("2026-07-23", 4.7459),
      // 2026-07-22 intentionally missing — no local record at all.
      real("2026-07-21", 4.7617),
    ];

    const series = buildChartSeries(records, "7d", "2026-07-24");

    expect(series.map((p) => p.date)).toEqual([
      "2026-07-18",
      "2026-07-19",
      "2026-07-20",
      "2026-07-21",
      "2026-07-22",
      "2026-07-23",
      "2026-07-24",
    ]);
    expect(series.find((p) => p.date === "2026-07-22")?.huiSell).toBeNull();
    expect(series.find((p) => p.date === "2026-07-24")?.huiSell).toBe(4.7481);
  });

  it("marks carried-forward points distinctly from real and missing ones", () => {
    const records = [
      real("2026-07-18", 4.75),
      {
        date: "2026-07-19",
        huiSell: 4.75,
        publishedAt: null,
        source: "carried-forward" as const,
        carriedFromDate: "2026-07-18",
      },
      real("2026-07-20", 4.76),
    ];

    const series = buildChartSeries(records, "7d", "2026-07-20");
    const sunday = series.find((p) => p.date === "2026-07-19");

    expect(sunday).toEqual({
      date: "2026-07-19",
      huiSell: 4.75,
      isCarriedForward: true,
    });
  });

  it("'365d' spans a full year ending at 'today'", () => {
    const records = [real("2026-06-01", 4.7), real("2026-07-24", 4.75)];

    const series = buildChartSeries(records, "365d", "2026-07-24");

    expect(series[0]?.date).toBe("2025-07-25");
    expect(series.at(-1)?.date).toBe("2026-07-24");
    expect(series).toHaveLength(365);
  });
});
