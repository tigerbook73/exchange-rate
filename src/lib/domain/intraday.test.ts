import { describe, expect, it } from "vitest";
import { advanceCollection } from "./intraday";
import {
  emptyCollectionState,
  type QuoteSample,
} from "../contracts/server-types";

const time = (value: string) => Date.parse(`2026-11-22T${value}+08:00`);
const quote = (value: string): QuoteSample => ({
  minute: Math.floor(time(value) / 60000) * 60000,
  requestedAt: new Date(time(value)).toISOString(),
  receivedAt: new Date(time(value) + 4000).toISOString(),
  publishedAt: `2026-11-22T${value}+08:00`,
  date: "2026-11-22",
  priceUnits: 47500,
});
function success(state = emptyCollectionState(), at = "10:00:05") {
  return advanceCollection(state, time(at), quote(at), null)!;
}
describe("minute collection and fixed points", () => {
  it("uses request minute despite a response crossing the minute", () => {
    const q = quote("10:05:59");
    const result = advanceCollection(
      emptyCollectionState(),
      time("10:05:59"),
      q,
      null,
    )!;
    expect(result.fixed[0].minute).toBe(time("10:05:00"));
    expect(result.state.live).toBeNull();
  });
  it("overwrites a single live point then clears it at the fixed boundary", () => {
    let state = success().state;
    state = success(state, "10:01:05").state;
    state = success(state, "10:02:05").state;
    expect(state.live?.minute).toBe(time("10:02:00"));
    const result = success(state, "10:05:05");
    expect(result.fixed.map((p) => p.minute)).toEqual([time("10:05:00")]);
    expect(result.state.live).toBeNull();
  });
  it("fills a missed boundary from the previous real value, never the future value", () => {
    const before = success(emptyCollectionState(), "09:59:05").state;
    const result = success(before, "10:01:05");
    expect(result.fixed[0].sourceMinute).toBe(time("09:59:00"));
    expect(result.fixed[0].isFallback).toBe(true);
    expect(result.state.live?.minute).toBe(time("10:01:00"));
  });
  it("never chains fallback and clears stale live points on failure", () => {
    let state = success(emptyCollectionState(), "09:59:05").state;
    const first = advanceCollection(state, time("10:00:05"), null, "timeout")!;
    expect(first.fixed[0].sourceMinute).toBe(time("09:59:00"));
    expect(first.state.live).toBeNull();
    state = first.state;
    const next = advanceCollection(state, time("10:05:05"), null, "timeout")!;
    expect(next.fixed[0].priceUnits).toBeNull();
  });
  it("includes exactly five minutes but rejects duplicate and out-of-order results", () => {
    const state = success(emptyCollectionState(), "09:55:05").state;
    const result = advanceCollection(state, time("10:00:05"), null, "timeout")!;
    expect(result.fixed[0].sourceMinute).toBe(time("09:55:00"));
    expect(
      advanceCollection(
        result.state,
        time("09:59:05"),
        quote("09:59:05"),
        null,
      ),
    ).toBeNull();
  });
  it("assigns midnight fallback to the new day while retaining its real source", () => {
    const q = quote("23:59:05");
    const before = advanceCollection(
      emptyCollectionState(),
      time("23:59:05"),
      q,
      null,
    )!;
    const at = Date.parse("2026-11-23T00:00:05+08:00");
    const after = advanceCollection(before.state, at, null, "timeout")!;
    expect(after.fixed[0].minute).toBe(Date.parse("2026-11-23T00:00:00+08:00"));
    expect(after.fixed[0].sourceMinute).toBe(q.minute);
    expect(after.state.live).toBeNull();
  });
});
