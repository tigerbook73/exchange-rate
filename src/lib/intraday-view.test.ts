import { describe, expect, it } from "vitest";
import { displayQuoteDate, intradaySeries } from "./intraday-view";
import { emptyCollectionState, type IntradayPoint } from "./server-types";

const date = "2026-11-22";
function stateWithPublication(publishedAt: string) {
  const state = emptyCollectionState();
  state.lastSuccess = {
    minute: Date.parse(`${date}T10:00:00+08:00`),
    requestedAt: `${date}T10:00:05+08:00`,
    receivedAt: `${date}T10:00:06+08:00`,
    publishedAt,
    date,
    priceUnits: 47500,
  };
  return state;
}
describe("display date follows the source publication, not collection time", () => {
  it("falls back to the actual quote date even if collection succeeded today", () => {
    const state = stateWithPublication("2026-11-20T22:00:00+08:00");
    expect(displayQuoteDate(state, [], date)).toBe("2026-11-20");
  });
  it("keeps today's unchanged quote valid without guessing market opening hours", () => {
    expect(
      displayQuoteDate(
        stateWithPublication(`${date}T07:00:00+08:00`),
        [],
        date,
      ),
    ).toBe(date);
  });
  it("ignores carried calendar dates when choosing a historical fallback", () => {
    const records = [
      {
        date: "2026-11-20",
        huiSell: 4.75,
        publishedAt: null,
        source: "history" as const,
        carriedFromDate: null,
      },
      {
        date: "2026-11-21",
        huiSell: 4.75,
        publishedAt: null,
        source: "carried-forward" as const,
        carriedFromDate: "2026-11-20",
      },
    ];
    expect(displayQuoteDate(null, records, date)).toBe("2026-11-20");
  });
  it("does not plot yesterday's source quotes as today's valid observations", () => {
    const minute = Date.parse(`${date}T10:00:00+08:00`);
    const point: IntradayPoint = {
      minute,
      priceUnits: 47500,
      sourceMinute: minute,
      sourceRequestedAt: `${date}T10:00:05+08:00`,
      publishedAt: "2026-11-21T22:00:00+08:00",
      isFallback: false,
      kind: "fixed",
    };
    const series = intradaySeries([point], null, date, minute);
    expect(series).toEqual([]);
  });
});

describe("intraday visible time range", () => {
  const at = (time: string) => Date.parse(`${date}T${time}:00+08:00`);
  function point(
    time: string,
    priceUnits: number | null = 47500,
  ): IntradayPoint {
    const minute = at(time);
    return {
      minute,
      priceUnits,
      sourceMinute: priceUnits === null ? null : minute,
      sourceRequestedAt: `${date}T${time}:05+08:00`,
      publishedAt: priceUnits === null ? null : `${date}T${time}:00+08:00`,
      isFallback: false,
      kind: "fixed",
    };
  }
  it("trims empty edges and carries the last acquired value across internal gaps", () => {
    const series = intradaySeries(
      [point("10:00"), point("10:10", 47600)],
      null,
      date,
      at("12:00"),
    );
    expect(series.map((p) => p.label)).toEqual(["10:00", "10:05", "10:10"]);
    expect(series.map((p) => p.huiSell)).toEqual([4.75, 4.75, 4.76]);
    expect(series[1]).toMatchObject({ isCarriedForward: true });
    expect(series[1].note).toContain("10:00");
  });
  it("keeps a single real observation visible without padding an empty day", () => {
    expect(
      intradaySeries([point("10:00")], null, date, at("12:00")),
    ).toHaveLength(1);
  });
  it("includes a fresh live minute at the right edge", () => {
    const state = emptyCollectionState();
    state.live = { ...point("10:12", 47700), kind: "live" };
    const series = intradaySeries([point("10:00")], state, date, at("10:12"));
    expect(series.at(-1)).toMatchObject({ label: "10:12", huiSell: 4.77 });
    expect(series.filter((p) => p.huiSell === null)).toHaveLength(0);
    expect(series[1].note).toContain("10:00");
    expect(series[2].note).toContain("10:00");
  });
  it("does not show stale live points or create data on an empty day", () => {
    const state = emptyCollectionState();
    state.live = { ...point("10:12"), kind: "live" };
    expect(intradaySeries([], state, date, at("10:18"))).toEqual([]);
  });
  it("starts with a horizontal previous-close reference labeled with its real date", () => {
    const records = [
      {
        date: "2026-11-21",
        huiSell: 4.7,
        publishedAt: "2026-11-21T22:00:00+08:00",
        source: "today" as const,
        carriedFromDate: null,
      },
    ];
    const original = point("10:00");
    const series = intradaySeries([original], null, date, at("12:00"), records);
    expect(series).toHaveLength(3);
    expect(series.slice(0, 2).map((p) => p.huiSell)).toEqual([4.7, 4.7]);
    expect(series[0]).toMatchObject({ isReference: true, label: "前日末值" });
    expect(series[0].note).toContain("2026-11-21 22:00");
    expect(series[0].note).toContain("非当日采样");
    expect(series[2]).toMatchObject({
      date: String(at("10:00")),
      huiSell: 4.75,
    });
    expect(original).toEqual(point("10:00"));
  });
  it("uses the last real day rather than chaining carried values or today's daily quote", () => {
    const records = [
      {
        date,
        huiSell: 4.99,
        publishedAt: null,
        source: "today" as const,
        carriedFromDate: null,
      },
      {
        date: "2026-11-21",
        huiSell: 4.7,
        publishedAt: null,
        source: "carried-forward" as const,
        carriedFromDate: "2026-11-20",
      },
      {
        date: "2026-11-20",
        huiSell: 4.7,
        publishedAt: null,
        source: "history" as const,
        carriedFromDate: null,
      },
    ];
    const series = intradaySeries(
      [point("10:00")],
      null,
      date,
      at("12:00"),
      records,
    );
    expect(series[0]).toMatchObject({ label: "前次末值", huiSell: 4.7 });
    expect(series[0].note).toContain("2026-11-20");
    expect(intradaySeries([], null, date, at("12:00"), records)).toEqual([]);
  });
});
