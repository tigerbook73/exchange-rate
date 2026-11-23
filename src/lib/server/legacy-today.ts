import { parsePublishedAt } from "../domain/date";
import type { TodayQuote } from "./icbc-today";
import { parseTodayHtml } from "./parse-today";
import { fetchSourceHtml, TODAY_SOURCE_URL } from "./sources";

/** Retained for explicit comparison; the active collector never calls this. */
export async function fetchLegacyToday(
  requestedAt: number,
  fetchHtml = fetchSourceHtml,
): Promise<TodayQuote> {
  const raw = parseTodayHtml(await fetchHtml(TODAY_SOURCE_URL));
  return {
    ...parsePublishedAt(raw.publishedAtRaw, new Date(requestedAt)),
    priceUnits: Math.round(raw.huiSell * 10000),
  };
}
