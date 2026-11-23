import { addDays, getBeijingDateString } from "../domain/date";
import { dailyGapFills } from "../domain/daily-gaps";
import { advanceCollection, minuteOf } from "../domain/intraday";
import { fetchIcbcToday } from "./icbc-today";
import type { RateRecord } from "../contracts/rate-types";
import { cleanupDatabase, commitCollection, readMeta } from "./server-store";
import type { QuoteSample } from "../contracts/server-types";
export async function collectMinute(
  db: D1Database,
  fetchQuote = fetchIcbcToday,
  scheduledAt: number | null = null,
) {
  const now = Date.now();
  const fillThrough = addDays(getBeijingDateString(new Date(now)), -1);
  const meta = await readMeta(db, fillThrough);
  if (
    meta.state.lastAttemptMinute !== null &&
    meta.state.lastAttemptMinute >= minuteOf(now)
  )
    return;
  if (meta.state.demo)
    throw new Error(
      "演示数据不能混入真实报价，请先运行 pnpm db:reset 清空本地演示库。",
    );
  const requestedAt = Date.now();
  let sample: QuoteSample | null = null;
  let failure: string | null = null;
  try {
    const quote = await fetchQuote();
    if (Date.parse(quote.publishedAt) > requestedAt + 5 * 60000)
      throw new Error("Future source quote");
    sample = {
      minute: minuteOf(requestedAt),
      requestedAt: new Date(requestedAt).toISOString(),
      receivedAt: new Date().toISOString(),
      ...quote,
    };
  } catch {
    failure = "source-unavailable-or-invalid";
  }
  const result = advanceCollection(meta.state, requestedAt, sample, failure);
  if (!result) return;
  result.state.lastScheduledAt =
    scheduledAt === null ? null : new Date(scheduledAt).toISOString();
  result.state.demo = false;
  const daily: RateRecord[] = meta.gapSource
    ? dailyGapFills([meta.gapSource], fillThrough)
    : [];
  if (
    !result.state.dailyFilledThrough ||
    result.state.dailyFilledThrough < fillThrough
  )
    result.state.dailyFilledThrough = fillThrough;
  if (
    result.accepted &&
    (result.accepted.publishedAt !== meta.state.lastSuccess?.publishedAt ||
      result.accepted.priceUnits !== meta.state.lastSuccess?.priceUnits) &&
    result.accepted.date === getBeijingDateString(new Date(requestedAt))
  ) {
    daily.push({
      date: result.accepted.date,
      huiSell: result.accepted.priceUnits / 10000,
      publishedAt: result.accepted.publishedAt,
      source: "today",
      carriedFromDate: null,
    });
  }
  const saved = await commitCollection(
    db,
    meta.revision,
    result.state,
    result.fixed,
    daily,
    Date.now(),
  );
  console.log(
    JSON.stringify({
      task: "minute",
      minute: minuteOf(requestedAt),
      saved,
      success: Boolean(result.accepted),
      fixed: result.fixed.length,
      daily: daily.length,
    }),
  );
  // Readers enforce retention immediately; physical maintenance can run every
  // quarter hour rather than adding four D1 statements to every minute tick.
  if (Math.floor(now / 60000) % 15 === 0) {
    try {
      await cleanupDatabase(db, Date.now());
    } catch {
      console.error(
        JSON.stringify({ task: "cleanup", error: "cleanup-failed" }),
      );
    }
  }
}
