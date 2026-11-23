import { addDays } from "./date";
import type { RateRecord } from "./rates-db";

/** Fill completed dates from the preceding real quote, never from another fill. */
export function dailyGapFills(
  records: RateRecord[],
  through: string,
): RateRecord[] {
  const byDate = new Map(records.map((record) => [record.date, record]));
  const firstReal = records
    .filter(
      (record) => record.source !== "carried-forward" && record.date <= through,
    )
    .map((record) => record.date)
    .sort()[0];
  if (!firstReal) return [];
  const fills: RateRecord[] = [];
  let lastReal: RateRecord | null = null;
  for (let date = firstReal; date <= through; date = addDays(date, 1)) {
    const existing = byDate.get(date);
    if (existing && existing.source !== "carried-forward") {
      lastReal = existing;
      continue;
    }
    if (
      lastReal &&
      (!existing ||
        existing.huiSell !== lastReal.huiSell ||
        existing.carriedFromDate !== lastReal.date)
    ) {
      fills.push({
        date,
        huiSell: lastReal.huiSell,
        publishedAt: null,
        source: "carried-forward",
        carriedFromDate: lastReal.date,
      });
    }
  }
  return fills;
}
