import { isValidDate } from "./date";
import type { QuoteSample } from "./server-types";

export type TodayQuote = Pick<
  QuoteSample,
  "priceUnits" | "date" | "publishedAt"
>;
// HTTP matches the published source request. HTTPS failed TLS negotiation in
// the initial local probe; do not silently disable TLS verification.
export const ICBC_TODAY_SOURCE_URL =
  "http://papi.icbc.com.cn/exchanges/ns/getLatest";
const MAX_RESPONSE_BYTES = 64 * 1024;

function object(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function parseIcbcToday(value: unknown): TodayQuote {
  if (!object(value) || value.code !== 0 || !Array.isArray(value.data))
    throw new Error("Invalid ICBC response");
  const matches = value.data.filter(
    (row): row is Record<string, unknown> =>
      object(row) && row.currencyENName === "AUD",
  );
  if (matches.length !== 1)
    throw new Error("Missing or ambiguous ICBC AUD quote");
  const row = matches[0];
  if (
    row.currencyType !== "029" ||
    typeof row.foreignSell !== "string" ||
    !/^\d{1,12}(?:\.\d{1,4})?$/.test(row.foreignSell.trim()) ||
    typeof row.publishDate !== "string" ||
    !isValidDate(row.publishDate) ||
    typeof row.publishTime !== "string" ||
    !/^(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d$/.test(row.publishTime)
  )
    throw new Error("Malformed ICBC AUD quote");
  // ICBC quotes CNY / 100 AUD. Convert to 1/10000 CNY per AUD using integer
  // decimal rounding, avoiding floating point errors at half-unit boundaries.
  const [whole, fraction = ""] = row.foreignSell.trim().split(".");
  const priceUnits =
    Number(whole) * 100 +
    Number((fraction + "00").slice(0, 2)) +
    ((fraction[2] ?? "0") >= "5" ? 1 : 0);
  if (!Number.isSafeInteger(priceUnits) || priceUnits <= 0)
    throw new Error("Invalid ICBC AUD sell price");
  return {
    priceUnits,
    date: row.publishDate,
    publishedAt: `${row.publishDate}T${row.publishTime}+08:00`,
  };
}

export async function fetchIcbcToday(
  fetcher: typeof fetch = fetch,
): Promise<TodayQuote> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);
  try {
    const response = await fetcher(ICBC_TODAY_SOURCE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Referer: "https://www.icbc.com.cn/",
        "User-Agent": "Mozilla/5.0",
      },
      body: "",
      redirect: "manual",
      signal: controller.signal,
    });
    if (!response.ok) {
      await response.body?.cancel();
      throw new Error(`ICBC source responded with ${response.status}`);
    }
    if (!response.body) throw new Error("ICBC source returned no body");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let size = 0;
    let json = "";
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_RESPONSE_BYTES) {
          await reader.cancel();
          throw new Error("ICBC source response exceeded size limit");
        }
        json += decoder.decode(value, { stream: true });
      }
      return parseIcbcToday(JSON.parse(json + decoder.decode()));
    } finally {
      reader.releaseLock();
    }
  } finally {
    clearTimeout(timeout);
  }
}
