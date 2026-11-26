import { AlertSettingsButton } from "@/components/alert-settings";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardAction,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { CurrentRateView } from "@/lib/domain/rate-view";

function formatUpdatedAt(publishedAt: string): string {
  const date = new Date(publishedAt);
  return new Intl.DateTimeFormat("zh-CN", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).format(date);
}

export function RateCard({
  rate,
  isSyncing,
  updateNote,
  onRefresh,
}: {
  rate: CurrentRateView | null;
  updateNote?: string | null;
  /** Show a rotating icon beside the price while preserving its value and layout. */
  isSyncing: boolean;
  onRefresh: () => void;
}) {
  return (
    <Card className="w-full max-w-md min-h-[30svh] shrink-0">
      <CardHeader>
        <CardTitle className="text-base font-normal text-muted-foreground">
          工商银行 澳元{" "}
          <span className="whitespace-nowrap">
            购汇价 <AlertSettingsButton currentPrice={rate?.huiSell} />
          </span>
        </CardTitle>
        <CardAction>
          <Button
            type="button"
            variant="ghost"
            size="icon"
            aria-label="刷新汇率"
            disabled={isSyncing}
            onClick={onRefresh}
          >
            <RefreshCw className="size-4" />
          </Button>
        </CardAction>
      </CardHeader>
      <CardContent className="@container flex min-h-0 flex-1 flex-col">
        <div className="flex min-h-0 flex-1 items-center gap-3 text-[clamp(2rem,18cqw,3.75rem)]">
          <p className="min-h-lh font-semibold tabular-nums">
            {rate ? rate.huiSell.toFixed(4) : null}
          </p>
          <span
            className="inline-flex size-[0.8em] shrink-0 text-muted-foreground"
            role={isSyncing ? "status" : undefined}
            aria-label={isSyncing ? "正在刷新汇率" : undefined}
          >
            {isSyncing ? (
              <RefreshCw
                className="size-full animate-spin"
                aria-hidden="true"
              />
            ) : null}
          </span>
        </div>
        <p className="min-h-[2lh] text-base text-muted-foreground @min-[19rem]:min-h-lh">
          {rate
            ? rate.publishedAt
              ? `更新于 ${formatUpdatedAt(rate.publishedAt)}`
              : `数据日期 ${rate.date}`
            : "暂无本地数据"}
          {updateNote ? (
            <>
              {" · "}
              <span className="text-amber-600 dark:text-amber-400">
                {updateNote}
              </span>
            </>
          ) : null}
        </p>
        {rate?.staleNote ? (
          <p className="mt-2 text-base text-amber-600 dark:text-amber-400">
            ⚠ {rate.staleNote}
          </p>
        ) : null}
      </CardContent>
    </Card>
  );
}
