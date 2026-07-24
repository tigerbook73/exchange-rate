"use client";

import { useMemo, useState } from "react";
import { RangeToggle } from "@/components/range-toggle";
import { RateCard } from "@/components/rate-card";
import { RateChart } from "@/components/rate-chart";
import { ThemeToggle } from "@/components/theme-toggle";
import {
  buildChartSeries,
  getCurrentRateView,
  type RangeOption,
} from "@/lib/rate-view";
import { usePullToRefresh } from "@/lib/use-pull-to-refresh";
import { useRateData } from "@/lib/use-rate-data";

export default function Home() {
  const { records, isLoading, isSyncing, error, refresh } = useRateData();
  const [range, setRange] = useState<RangeOption>("30d");
  const { pullDistance, triggerDistance } = usePullToRefresh(refresh);

  const currentRate = useMemo(() => getCurrentRateView(records), [records]);
  const chartPoints = useMemo(
    () => buildChartSeries(records, range),
    [records, range],
  );

  return (
    <main className="flex flex-1 flex-col items-center gap-6 p-6">
      {pullDistance > 0 ? (
        <div
          className="text-xs text-muted-foreground"
          style={{ opacity: Math.min(pullDistance / triggerDistance, 1) }}
        >
          {pullDistance >= triggerDistance ? "松开刷新" : "下拉刷新"}
        </div>
      ) : null}

      <div className="flex w-full max-w-sm items-center justify-between">
        <span className="text-xs text-muted-foreground">
          {isSyncing ? "同步中…" : isLoading ? "加载中…" : null}
        </span>
        <ThemeToggle />
      </div>

      <RateCard rate={currentRate} />

      {error && !isLoading ? (
        <p className="text-xs text-destructive" role="alert">
          同步失败：{error}（展示的是本地已缓存数据）
        </p>
      ) : null}

      <div className="flex w-full max-w-sm flex-col gap-2">
        <RangeToggle value={range} onChange={setRange} />
        <RateChart points={chartPoints} />
      </div>

      <p className="max-w-sm text-center text-xs text-muted-foreground">
        数据来自快易理财网，仅供参考，以银行官网实际成交汇率为准。
      </p>
    </main>
  );
}
