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

export function RateCard({ rate }: { rate: CurrentRateView | null }) {
  return (
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle className="text-sm font-normal text-muted-foreground">
          工商银行 澳元 购汇价（现汇卖出）
        </CardTitle>
      </CardHeader>
      <CardContent>
        {rate ? (
          <>
            <p className="text-4xl font-semibold tabular-nums">
              {rate.huiSell.toFixed(4)}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {rate.publishedAt
                ? `更新于 ${formatUpdatedAt(rate.publishedAt)}`
                : `数据日期 ${rate.date}`}
            </p>
            {rate.staleNote ? (
              <p className="mt-2 text-xs text-amber-600 dark:text-amber-400">
                ⚠ {rate.staleNote}
              </p>
            ) : null}
          </>
        ) : (
          <p className="text-sm text-muted-foreground">加载中…</p>
        )}
      </CardContent>
    </Card>
  );
}
