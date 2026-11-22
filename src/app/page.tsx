"use client";

import { useMemo, useState } from "react";
import { InstallButton } from "@/components/install-button";
import { RangeToggle } from "@/components/range-toggle";
import { RateCard } from "@/components/rate-card";
import { RateChart } from "@/components/rate-chart";
import {
  buildChartSeries,
  getCurrentRateView,
  type RangeOption,
} from "@/lib/rate-view";
import { useRateData } from "@/lib/use-rate-data";
import { getBeijingDateString } from "@/lib/date";
import { displayQuoteDate, intradaySeries } from "@/lib/intraday-view";

export default function Home() {
  const {
    records,
    points,
    server,
    isLoading,
    isSyncing,
    error,
    online,
    now,
    refresh,
  } = useRateData();
  const [range, setRange] = useState<RangeOption>("30d");
  const today = getBeijingDateString(new Date(now));
  const state = server?.state ?? null;
  const date = displayQuoteDate(state, records, today);

  const currentRate = useMemo(() => {
    const quote = state?.lastSuccess;
    const publishedDate = quote
      ? getBeijingDateString(new Date(quote.publishedAt))
      : null;
    const rate =
      quote && publishedDate === date
        ? {
            huiSell: quote.priceUnits / 10000,
            date,
            publishedAt: quote.publishedAt,
            isCarriedForward: false,
            staleNote: null,
          }
        : getCurrentRateView(
            records.filter(
              (record) =>
                record.date === date && record.source !== "carried-forward",
            ),
          );
    return rate;
  }, [records, state, date]);
  const chartPoints = useMemo(
    () =>
      range === "1d"
        ? intradaySeries(points, state, date, now, records)
        : buildChartSeries(records, range, today),
    [records, range, points, state, date, now, today],
  );
  const observations = chartPoints.filter((point) => !point.isReference);
  const intradayTimes = observations.length
    ? ` ${observations[0].label}–${observations[observations.length - 1].label}`
    : "";
  const delayed =
    state?.lastCheckedAt && now - Date.parse(state.lastCheckedAt) >= 3 * 60_000;

  return (
    <main className="flex h-full min-h-0 w-full flex-1 flex-col items-center gap-6 overflow-hidden p-6 sm:gap-8 sm:p-8">
      <RateCard
        rate={currentRate}
        updateNote={
          currentRate && date !== today
            ? "今天无更新"
            : currentRate?.publishedAt &&
                state?.lastCheckedAt &&
                Date.parse(currentRate.publishedAt) <
                  Date.parse(state.lastCheckedAt)
              ? "当前无更新"
              : null
        }
        isSyncing={isSyncing}
        onRefresh={refresh}
      />

      {state?.demo ||
      !online ||
      delayed ||
      !state?.lastCheckedAt ||
      (error && !isLoading) ? (
        <div
          className="w-full max-w-md text-sm text-muted-foreground"
          aria-live="polite"
        >
          {state?.demo ? (
            <p className="text-amber-700 dark:text-amber-400">
              本地演示数据，非真实报价
            </p>
          ) : null}
          {!online || delayed || !state?.lastCheckedAt ? (
            <p>
              {!online
                ? "离线 · 显示已缓存数据"
                : delayed
                  ? "采集延迟 · 显示最近成功数据"
                  : "等待服务端数据"}
            </p>
          ) : null}
          {error && !isLoading ? (
            <p className="text-destructive" role="alert">
              {error}（保留本地缓存）
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="flex w-full max-w-md min-h-0 flex-1 flex-col gap-3">
        <RangeToggle value={range} onChange={setRange} />
        <p
          className="text-center text-sm text-muted-foreground"
          aria-live="polite"
        >
          {range === "1d"
            ? `${date}${intradayTimes}`
            : `${chartPoints[0]?.date ?? today} — ${today}`}
        </p>
        <RateChart
          points={chartPoints}
          emptyMessage={
            range === "1d" && server && date < server.retainedFrom
              ? `${date} 的日内记录已过保存期，请选择更长时间范围`
              : undefined
          }
        />
      </div>

      <InstallButton />

      <p className="w-full max-w-md text-left text-sm text-muted-foreground">
        数据来自快易理财网及工商银行网站。仅供参考。
      </p>
    </main>
  );
}
