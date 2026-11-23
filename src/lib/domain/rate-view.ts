import { addDays, getBeijingDateString } from "./date";
import type { RateRecord } from "../contracts/rate-types";

export type HistoryRange = "7d" | "30d" | "90d" | "180d" | "365d";
export type RangeOption = "1d" | HistoryRange;

export const RANGE_LABELS: Record<RangeOption, string> = {
  "1d": "1 日",
  "7d": "7 天",
  "30d": "30 天",
  "90d": "90 天",
  "180d": "半年",
  "365d": "一年",
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
  /** A display-only previous-close reference, not a sampled observation. */
  isReference?: boolean;
  label?: string;
  note?: string;
  date: string;
  /** null marks an unrecoverable gap — no local record could be found for this date. */
  huiSell: number | null;
  isCarriedForward: boolean;
}

const RANGE_DAYS: Record<HistoryRange, number> = {
  "7d": 7,
  "30d": 30,
  "90d": 90,
  "180d": 180,
  "365d": 365,
};

/**
 * Builds a continuous per-day series for the chart. Days with no local
 * record (real or carried-forward) become `huiSell: null`, which breaks the
 * line — these are the genuinely unrecoverable gaps (source never had them,
 * or the device hasn't synced far enough back to have a local record).
 */
export function buildChartSeries(
  records: RateRecord[],
  range: HistoryRange,
  today: string = getBeijingDateString(),
): ChartPoint[] {
  if (records.length === 0) {
    return [];
  }

  const byDate = new Map(records.map((r) => [r.date, r]));
  const startDate = addDays(today, -(RANGE_DAYS[range] - 1));

  const points: ChartPoint[] = [];
  for (let date = startDate; date <= today; date = addDays(date, 1)) {
    const record = byDate.get(date);
    points.push({
      date,
      huiSell: record ? record.huiSell : null,
      isCarriedForward: record?.source === "carried-forward",
      note:
        record?.source === "carried-forward"
          ? `该日期未更新，数据来自 ${record.carriedFromDate}`
          : undefined,
    });
  }
  return points;
}
