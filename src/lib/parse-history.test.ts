import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseHistoryHtml } from "./parse-history";

const fixture = readFileSync(
  join(__dirname, "__fixtures__/d-icbc-aud.html"),
  "utf-8",
);

describe("parseHistoryHtml", () => {
  it("parses the daily data table, not the summary table", () => {
    const points = parseHistoryHtml(fixture);

    expect(points).toHaveLength(28);
    expect(points[0]).toEqual({ date: "2026-07-24", huiSell: 4.7484 });
    expect(points.at(-1)).toEqual({ date: "2026-06-23", huiSell: 4.7208 });
  });

  it("only returns dates the source actually published (no fabricated weekend gaps)", () => {
    const points = parseHistoryHtml(fixture);
    const dates = points.map((p) => p.date);

    // Verified against the real source: every Saturday has a quote, only
    // Sunday is missing — not a blanket "weekends are closed" pattern.
    expect(dates).toContain("2026-07-18"); // Saturday
    expect(dates).not.toContain("2026-07-19"); // Sunday
  });
});
