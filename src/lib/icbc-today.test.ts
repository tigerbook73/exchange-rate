import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it, vi } from "vitest";
import {
  fetchIcbcToday,
  ICBC_TODAY_SOURCE_URL,
  parseIcbcToday,
} from "./icbc-today";
import { fetchLegacyToday } from "./legacy-today";

const fixture = JSON.parse(
  readFileSync(resolve("src/lib/__fixtures__/icbc-latest.json"), "utf8"),
);
const quote = {
  priceUnits: 44331,
  date: "2026-11-21",
  publishedAt: "2026-11-21T04:08:43+08:00",
};
function withAud(fields: Record<string, unknown>) {
  return {
    code: 0,
    data: [
      {
        ...fixture.data.find(
          (r: { currencyENName: string }) => r.currencyENName === "AUD",
        ),
        ...fields,
      },
    ],
  };
}

describe("ICBC current quote", () => {
  it("uses foreignSell and converts per-100 quotes to per-AUD integer units", () => {
    expect(parseIcbcToday(fixture)).toEqual(quote);
    expect(parseIcbcToday(withAud({ foreignSell: "443.315" })).priceUnits).toBe(
      44332,
    );
    expect(
      parseIcbcToday(withAud({ foreignSell: "443.3149" })).priceUnits,
    ).toBe(44331);
    expect(parseIcbcToday(withAud({ foreignSell: "443" })).priceUnits).toBe(
      44300,
    );
  });
  it("rejects errors, missing and ambiguous AUD rows", () => {
    for (const input of [
      null,
      { code: 1, data: fixture.data },
      { code: 0, data: [] },
      { code: 0, data: {} },
      { code: 0, data: [...fixture.data, ...fixture.data] },
    ])
      expect(() => parseIcbcToday(input)).toThrow();
  });
  it("rejects invalid sell prices instead of using reference or cashSell", () => {
    for (const foreignSell of [
      "",
      "0",
      "-1",
      "NaN",
      "Infinity",
      "1e2",
      "443.12345",
      "99999999999999",
      443.31,
      null,
      "0.0001",
    ])
      expect(() => parseIcbcToday(withAud({ foreignSell }))).toThrow();
  });
  it("requires valid full source dates and second precision in Beijing time", () => {
    for (const fields of [
      { publishDate: "2026-02-30" },
      { publishTime: "24:00:00" },
      { publishTime: "04:08" },
      { currencyType: "028" },
    ])
      expect(() => parseIcbcToday(withAud(fields))).toThrow();
    expect(parseIcbcToday(withAud({ publishDate: "2024-02-29" })).date).toBe(
      "2024-02-29",
    );
  });
  it("posts an empty body with the supplied source headers", async () => {
    const fetcher = vi.fn<typeof fetch>(
      async () => new Response(JSON.stringify(fixture)),
    );
    expect(await fetchIcbcToday(fetcher)).toEqual(quote);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0][0]).toBe(ICBC_TODAY_SOURCE_URL);
    expect(fetcher.mock.calls[0][1]).toMatchObject({
      method: "POST",
      body: "",
      redirect: "manual",
      headers: {
        "Content-Type": "application/json",
        Referer: "https://www.icbc.com.cn/",
        "User-Agent": "Mozilla/5.0",
      },
    });
  });
  it("rejects HTTP errors, oversized or non-JSON responses without fallback", async () => {
    for (const response of [
      new Response("failure", { status: 503 }),
      new Response("x".repeat(65537)),
      new Response("<html>unavailable</html>"),
    ]) {
      const fetcher = vi.fn<typeof fetch>(async () => response);
      await expect(fetchIcbcToday(fetcher)).rejects.toThrow();
      expect(fetcher).toHaveBeenCalledTimes(1);
    }
  });
  it("retains the legacy implementation for explicit comparison", async () => {
    const html = readFileSync(
      resolve("src/lib/__fixtures__/b-icbc.html"),
      "utf8",
    );
    expect(
      await fetchLegacyToday(
        Date.parse("2026-07-24T11:00:00+08:00"),
        async () => html,
      ),
    ).toEqual({
      priceUnits: 47484,
      date: "2026-07-24",
      publishedAt: "2026-07-24T10:30:00+08:00",
    });
  });
});
