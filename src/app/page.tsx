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

export default function Home() {
  const { records, isLoading, isSyncing, error, refresh } = useRateData();
  const [range, setRange] = useState<RangeOption>("30d");

  const currentRate = useMemo(() => getCurrentRateView(records), [records]);
  const chartPoints = useMemo(
    () => buildChartSeries(records, range),
    [records, range],
  );

  return (
    <main className="flex h-full min-h-0 w-full flex-1 flex-col items-center gap-6 overflow-hidden p-6 sm:gap-8 sm:p-8">
      <RateCard rate={currentRate} isSyncing={isSyncing} onRefresh={refresh} />

      {error && !isLoading ? (
        <p className="text-xs text-destructive" role="alert">
          同步失败：{error}（展示的是本地已缓存数据）
        </p>
      ) : null}

      <div className="flex w-full max-w-md min-h-0 flex-1 flex-col gap-3">
        <RangeToggle value={range} onChange={setRange} />
        <RateChart points={chartPoints} />
      </div>

      <InstallButton />

      <p className="w-full max-w-md text-left text-sm text-muted-foreground">
        数据来自快易理财网，仅供参考。
      </p>
    </main>
  );
}
