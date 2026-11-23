import { getBeijingDateString } from "./date";
import { dayStart } from "./intraday";
import type { ChartPoint } from "./rate-view";
import type { RateRecord } from "../contracts/rate-types";
import {
  FIXED_MS,
  type CollectionState,
  type IntradayPoint,
} from "../contracts/server-types";

const beijingTimeFormatter = new Intl.DateTimeFormat("zh-CN", {
  timeZone: "Asia/Shanghai",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false,
});

export function beijingTime(value: number | string): string {
  return beijingTimeFormatter.format(new Date(value));
}

/** Acquisition can succeed while the source is still publishing an older day's quote. */
export function displayQuoteDate(
  state: CollectionState | null,
  records: RateRecord[],
  today: string,
): string {
  const publishedAt = state?.lastSuccess?.publishedAt;
  if (publishedAt && Number.isFinite(Date.parse(publishedAt))) {
    const date = getBeijingDateString(new Date(publishedAt));
    if (date <= today) return date;
  }
  return (
    records
      .filter(
        (record) => record.source !== "carried-forward" && record.date <= today,
      )
      .map((record) => record.date)
      .sort()
      .at(-1) ?? today
  );
}

export function intradaySeries(
  points: IntradayPoint[],
  state: CollectionState | null,
  date: string,
  now: number,
  records: RateRecord[] = [],
): ChartPoint[] {
  const start = dayStart(date);
  const dayEnd = start + 86_400_000;
  const end = Math.min(
    dayEnd - FIXED_MS,
    Math.floor(now / FIXED_MS) * FIXED_MS,
  );
  const byMinute = new Map(points.map((p) => [p.minute, p]));
  const selected: IntradayPoint[] = [];
  for (let minute = start; minute <= end; minute += FIXED_MS) {
    selected.push(
      byMinute.get(minute) ?? {
        minute,
        priceUnits: null,
        sourceMinute: null,
        sourceRequestedAt: null,
        publishedAt: null,
        isFallback: false,
        kind: "fixed",
      },
    );
  }
  const live = state?.live;
  if (
    live &&
    live.minute > end &&
    now - live.minute <= FIXED_MS &&
    live.minute >= start &&
    live.minute < dayEnd
  )
    selected.push(live);
  // Bound memoized values to this calculation, rather than accumulating quotes.
  const quoteDates = new Map<string, string>();
  const times = new Map<number | string, string>();
  function timeAt(value: number | string) {
    let time = times.get(value);
    if (time === undefined) {
      time = beijingTime(value);
      times.set(value, time);
    }
    return time;
  }
  const series = selected.map((point) => {
    let quoteDate: string | null = null;
    if (point.publishedAt) {
      quoteDate = quoteDates.get(point.publishedAt) ?? null;
      if (quoteDate === null) {
        quoteDate = getBeijingDateString(new Date(point.publishedAt));
        quoteDates.set(point.publishedAt, quoteDate);
      }
    }
    const note = [
      point.kind === "live" ? "最新采集" : "5 分钟采样",
      point.isFallback && point.sourceMinute !== null
        ? `本次未采到，沿用 ${timeAt(point.sourceMinute)} 采集值`
        : "",
      quoteDate && quoteDate !== date ? `源站报价日期 ${quoteDate}` : "",
    ]
      .filter(Boolean)
      .join("；");
    return {
      date: String(point.minute),
      label: timeAt(point.minute),
      sourceTime: point.sourceRequestedAt
        ? timeAt(point.sourceRequestedAt)
        : timeAt(point.minute),
      huiSell:
        point.priceUnits === null || quoteDate !== date
          ? null
          : point.priceUnits / 10000,
      isCarriedForward:
        point.isFallback || Boolean(quoteDate && quoteDate !== date),
      note,
    };
  });
  const first = series.findIndex((point) => point.huiSell !== null);
  if (first < 0) return [];
  let last = series.length - 1;
  while (series[last].huiSell === null) last--;
  let lastObserved: (typeof series)[number] | undefined;
  const visible = series.slice(first, last + 1).map((point) => {
    if (point.huiSell !== null) {
      lastObserved = point;
      return point;
    }
    // Only original non-null observations update the source. Display-only
    // carried values never become the source for the next missing interval.
    return {
      ...point,
      huiSell: lastObserved!.huiSell,
      isCarriedForward: true,
      note: `该时段缺少采样，沿用 ${lastObserved!.sourceTime} 最后采集值；非新报价`,
    };
  });
  const previous = records
    .filter(
      (record) => record.date < date && record.source !== "carried-forward",
    )
    .sort((a, b) => b.date.localeCompare(a.date))[0];
  if (!previous) return visible;

  // This short opening line is a labeled reference, never a fabricated
  // same-day observation. It is derived for display and is not persisted.
  const reference: ChartPoint = {
    date: `reference:${previous.date}:start`,
    label: "昨天",
    huiSell: previous.huiSell,
    isCarriedForward: true,
    isReference: true,
    note: `前一有效日最后报价，数据来自 ${previous.date}${previous.publishedAt ? ` ${timeAt(previous.publishedAt)}` : ""}；仅作起始参考，非当日采样`,
  };
  return [
    reference,
    { ...reference, date: `reference:${previous.date}:end`, label: "" },
    ...visible,
  ];
}
