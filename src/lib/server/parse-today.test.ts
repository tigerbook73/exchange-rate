import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseTodayHtml } from "./parse-today";

const fixture = readFileSync(
  join(import.meta.dirname, "__fixtures__/b-icbc.html"),
  "utf-8",
);

describe("parseTodayHtml", () => {
  it("rejects empty prices instead of treating them as zero", () => {
    expect(() => parseTodayHtml(fixture.replaceAll("4.7484", ""))).toThrow();
  });
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

  it("accepts source rows without an explicit tbody", () => {
    expect(parseTodayHtml(fixture.replace(/<\/?tbody>/g, ""))).toEqual({
      huiSell: 4.7484,
      publishedAtRaw: "07-24 10:30",
    });
  });

  it("decodes entities and collects nested text without confusing other tables or scripts", () => {
    const row =
      "<tr><td>&nbsp;<b>澳大利亚元</b></td><td>1</td><td>2</td><td><b>4.7484</b></td><td>3</td><td>07-24 <span>10:30</span></td></tr>";
    const html = `<script>const fake='<table id="bank_rate_table">${row}</table>';</script><table>${row}</table><table id='bank_rate_table'>${row}</table>`;
    expect(parseTodayHtml(html)).toEqual({
      huiSell: 4.7484,
      publishedAtRaw: "07-24 10:30",
    });
  });

  it("rejects ambiguous nested source tables", () => {
    expect(() =>
      parseTodayHtml(
        "<table id='bank_rate_table'><tr><td><table><tr><td>澳大利亚元</td></tr></table></td></tr></table>",
      ),
    ).toThrow();
  });
});
