import { describe, expect, it } from "vitest";
import { parsePublishedAt } from "./date";

describe("parsePublishedAt", () => {
  it("resolves the year using the current month when there's no boundary crossing", () => {
    const now = new Date("2026-07-24T02:00:00Z"); // 2026-07-24 10:00 Beijing time
    expect(parsePublishedAt("07-24 10:30", now)).toEqual({
      date: "2026-07-24",
      publishedAt: "2026-07-24T10:30:00+08:00",
    });
  });

  it("uses Beijing time, not the server's local timezone, to resolve 'now'", () => {
    // 2026-01-01 00:30 UTC is already 2026-01-01 08:30 in Beijing.
    const now = new Date("2026-01-01T00:30:00Z");
    expect(parsePublishedAt("01-01 08:00", now)).toEqual({
      date: "2026-01-01",
      publishedAt: "2026-01-01T08:00:00+08:00",
    });
  });

  it("rolls the year back when the source shows December but it's already January locally", () => {
    const now = new Date("2027-01-01T01:00:00Z"); // 2027-01-01 09:00 Beijing time
    expect(parsePublishedAt("12-31 15:32", now)).toEqual({
      date: "2026-12-31",
      publishedAt: "2026-12-31T15:32:00+08:00",
    });
  });

  it("rolls the year forward when the source already shows January but it's still December locally", () => {
    const now = new Date("2026-12-31T17:00:00Z"); // 2027-01-01 01:00 Beijing time
    expect(parsePublishedAt("01-01 09:11", now)).toEqual({
      date: "2027-01-01",
      publishedAt: "2027-01-01T09:11:00+08:00",
    });
  });

  it("throws on an unrecognized format", () => {
    expect(() => parsePublishedAt("not-a-date")).toThrow();
  });
});
