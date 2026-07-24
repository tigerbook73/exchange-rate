import type { HistoryResponse, TodayResponse } from "./api-types";
import { addDays, getBeijingDateString } from "./date";
import {
  getAllRates,
  upsertRates,
  type RateRecord,
  type RatesDb,
} from "./rates-db";

/**
 * Merges /api/today and /api/history into RateRecord[]. Today's row is only
 * ever taken from /api/today — /api/history is cached for up to an hour, so
 * its copy of today's row can be stale; if /api/today fails, today simply
 * stays whatever was already in IndexedDB (or absent) rather than falling
 * back to that stale value.
 */
export function toRateRecords(
  today: TodayResponse | null,
  history: HistoryResponse,
  todayDate: string = today?.date ?? getBeijingDateString(),
): RateRecord[] {
  const records = new Map<string, RateRecord>();

  for (const point of history.series) {
    if (point.date === todayDate) continue;
    records.set(point.date, {
      date: point.date,
      huiSell: point.huiSell,
      publishedAt: null,
      source: "history",
      carriedFromDate: null,
    });
  }

  if (today) {
    records.set(today.date, {
      date: today.date,
      huiSell: today.huiSell,
      publishedAt: today.publishedAt,
      source: "today",
      carriedFromDate: null,
    });
  }

  return [...records.values()];
}

/** Every calendar date from `start` to `end`, inclusive. */
function enumerateDateRange(start: string, end: string): string[] {
  const dates: string[] = [];
  for (let cursor = start; cursor <= end; cursor = addDays(cursor, 1)) {
    dates.push(cursor);
  }
  return dates;
}

/**
 * Fills gaps within the *span* of `sourceWindowDates` (from the oldest to
 * the newest date this /api/history call actually returned) using the
 * nearest earlier real record's huiSell. A date the source silently omits
 * (e.g. Sundays) never appears in `sourceWindowDates` itself, which is why
 * this walks the full calendar range rather than just the returned dates.
 * Never looks outside that span, and never chains a fill off another fill —
 * carriedFromDate always points at a real ("today"/"history") record.
 */
export function computeCarriedForwardFills(
  sourceWindowDates: string[],
  existingRecords: RateRecord[],
): RateRecord[] {
  if (sourceWindowDates.length === 0) {
    return [];
  }

  const byDate = new Map(existingRecords.map((r) => [r.date, r]));
  const sorted = [...sourceWindowDates].sort();
  const fullRange = enumerateDateRange(
    sorted[0] as string,
    sorted[sorted.length - 1] as string,
  );
  const fills: RateRecord[] = [];
  let lastReal: RateRecord | null = null;

  for (const date of fullRange) {
    const existing = byDate.get(date);
    if (existing && existing.source !== "carried-forward") {
      lastReal = existing;
      continue;
    }
    if (lastReal) {
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

/**
 * One full sync pass: merge real API data into IndexedDB, then fill any
 * gaps within the fetched /api/history window (which shrinks to just the
 * gap since the last sync once a device has local history) with marked
 * carried-forward values.
 */
export async function syncRates(
  db: RatesDb,
  today: TodayResponse | null,
  history: HistoryResponse,
): Promise<void> {
  const realRecords = toRateRecords(today, history);
  await upsertRates(db, realRecords);

  const allRecords = await getAllRates(db);
  const sourceWindowDates = history.series.map((point) => point.date);
  const fills = computeCarriedForwardFills(sourceWindowDates, allRecords);

  if (fills.length > 0) {
    await upsertRates(db, fills);
  }
}
