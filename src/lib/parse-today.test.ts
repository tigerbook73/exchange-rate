import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseTodayHtml } from "./parse-today";

const fixture = readFileSync(
  join(__dirname, "__fixtures__/b-icbc.html"),
  "utf-8",
);

describe("parseTodayHtml", () => {
  it("extracts huiSell and the raw publish time for AUD from the real page structure", () => {
    expect(parseTodayHtml(fixture)).toEqual({
      huiSell: 4.7484,
      publishedAtRaw: "07-24 10:30",
    });
  });

  it("throws when the AUD row can't be found", () => {
    expect(() =>
      parseTodayHtml("<table id='bank_rate_table'></table>"),
    ).toThrow();
  });
});
