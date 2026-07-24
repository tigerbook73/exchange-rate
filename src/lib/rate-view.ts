import { getBeijingDateString } from "./date";
import type { RateRecord } from "./rates-db";

export type RangeOption = "7d" | "30d" | "all";

export const RANGE_LABELS: Record<RangeOption, string> = {
  "7d": "7 天",
  "30d": "30 天",
  all: "全部",
};

export interface CurrentRateView {
  huiSell: number;
  date: string;
  publishedAt: string | null;
  /** True when this isn't a same-day real quote (carried forward from an earlier date). */
  isCarriedForward: boolean;
  /** e.g. "数据未更新，来自 07-18" — set only when isCarriedForward. */
  staleNote: string | null;
}

/** The latest known local record, with staleness info for display. */
export function getCurrentRateView(
  records: RateRecord[],
): CurrentRateView | null {
  if (records.length === 0) {
    return null;
  }
  const latest = [...records].sort((a, b) => (a.date < b.date ? 1 : -1))[0];
  if (!latest) {
    return null;
  }

  const isCarriedForward = latest.source === "carried-forward";
  return {
    huiSell: latest.huiSell,
    date: latest.date,
    publishedAt: latest.publishedAt,
    isCarriedForward,
    staleNote: isCarriedForward
      ? `数据未更新，来自 ${latest.carriedFromDate}`
      : null,
  };
}

export interface ChartPoint {
  date: string;
  /** null marks an unrecoverable gap — no local record could be found for this date. */
  huiSell: number | null;
  isCarriedForward: boolean;
}

function addDays(date: string, delta: number): string {
  const [year, month, day] = date.split("-").map(Number);
  const utc = new Date(Date.UTC(year, month - 1, day));
  utc.setUTCDate(utc.getUTCDate() + delta);
  const y = utc.getUTCFullYear();
  const m = String(utc.getUTCMonth() + 1).padStart(2, "0");
  const d = String(utc.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}

const RANGE_DAYS: Record<Exclude<RangeOption, "all">, number> = {
  "7d": 7,
  "30d": 30,
};

/**
 * Builds a continuous per-day series for the chart. Days with no local
 * record (real or carried-forward) become `huiSell: null`, which breaks the
 * line — these are the genuinely unrecoverable gaps (source never had them,
 * or the device missed the 28-day window entirely).
 */
export function buildChartSeries(
  records: RateRecord[],
  range: RangeOption,
  today: string = getBeijingDateString(),
): ChartPoint[] {
  if (records.length === 0) {
    return [];
  }

  const byDate = new Map(records.map((r) => [r.date, r]));
  const earliestLocalDate = records.reduce(
    (min, r) => (r.date < min ? r.date : min),
    records[0]!.date,
  );

  const startDate =
    range === "all"
      ? earliestLocalDate
      : addDays(today, -(RANGE_DAYS[range] - 1));

  const points: ChartPoint[] = [];
  for (let date = startDate; date <= today; date = addDays(date, 1)) {
    const record = byDate.get(date);
    points.push({
      date,
      huiSell: record ? record.huiSell : null,
      isCarriedForward: record?.source === "carried-forward",
    });
  }
  return points;
}
