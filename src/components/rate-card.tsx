import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import type { CurrentRateView } from "@/lib/rate-view";

function formatUpdatedAt(publishedAt: string): string {
  const date = new Date(publishedAt);
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function RateCard({
  rate,
  isSyncing,
}: {
  rate: CurrentRateView | null;
  /** True while a background sync is in flight — shown as an inline note
   * next to the timestamp rather than swapping out the card's layout, so
   * the card never jumps between a "loading" skeleton and its real content. */
  isSyncing: boolean;
}) {
  return (
    <Card className="w-full max-w-md min-h-[30svh]">
      <CardHeader>
        <CardTitle className="text-sm font-normal text-muted-foreground">
          工商银行 澳元 购汇价（现汇卖出）
        </CardTitle>
      </CardHeader>
      <CardContent className="flex flex-1 flex-col">
        <div className="flex flex-1 flex-col justify-center">
          <p className="text-6xl font-semibold tabular-nums">
            {rate ? rate.huiSell.toFixed(4) : "－－－－"}
          </p>
        </div>
        <p className="text-sm text-muted-foreground">
          {rate
            ? rate.publishedAt
              ? `更新于 ${formatUpdatedAt(rate.publishedAt)}`
              : `数据日期 ${rate.date}`
            : "暂无本地数据"}
          {isSyncing ? "（加载中…）" : ""}
        </p>
        {rate?.staleNote ? (
          <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
            ⚠ {rate.staleNote}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
