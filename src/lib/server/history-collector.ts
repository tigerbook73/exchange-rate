import { addDays, getBeijingDateString } from "../domain/date";
import { dailyGapFills } from "../domain/daily-gaps";
import { parseHistoryHtml } from "./parse-history";
import type { RateRecord } from "../contracts/rate-types";
import { commitCollection, readMeta } from "./server-store";
import { fetchSourceHtml, HISTORY_SOURCE_URL } from "./sources";

export async function collectHistory(
  db: D1Database,
  fetchHtml = fetchSourceHtml,
) {
  const now = Date.now();
  const today = getBeijingDateString(new Date(now));
  const meta = await readMeta(db);
  if (meta.state.demo)
    throw new Error(
      "演示数据不能混入真实历史，请先运行 pnpm db:reset 清空本地演示库。",
    );
  let historyDate = meta.state.historyDate;
  let historyError: string | null = null;
  const pending = await db
    .prepare(
      "SELECT min(date) AS date FROM daily_rates WHERE date < ? AND json_extract(value_json, '$.source') = 'today'",
    )
    .bind(today)
    .first<{ date: string | null }>();
  const datefrom = [
    meta.state.historyDate ?? addDays(today, -365),
    pending?.date,
  ]
    .filter((d): d is string => Boolean(d))
    .sort()[0];
  const records: RateRecord[] = [];
  let latest = meta;
  try {
    const points = parseHistoryHtml(
      await fetchHtml(`${HISTORY_SOURCE_URL}?datefrom=${datefrom}`),
    ).filter((p) => p.date < today);
    if (!points.length) throw new Error("No completed history dates");
    const sorted = [...points].sort((a, b) => a.date.localeCompare(b.date));
    // Fence the following daily snapshot with this revision. A concurrent
    // minute/history commit makes our entire batch lose rather than applying
    // fills derived from an older set of real quotes.
    latest = await readMeta(db);
    const through = addDays(today, -1);
    const existingRows = await db
      .prepare("SELECT value_json FROM daily_rates WHERE date <= ?")
      .bind(through)
      .all<{ value_json: string }>();
    const existing = new Map(
      existingRows.results.map((row) => {
        const record: RateRecord = JSON.parse(row.value_json);
        return [record.date, record] as const;
      }),
    );
    for (const point of sorted) {
      const record: RateRecord = {
        ...point,
        publishedAt: null,
        source: "history",
        carriedFromDate: null,
      };
      existing.set(point.date, record);
      records.push(record);
    }
    records.push(...dailyGapFills([...existing.values()], through));
    historyDate = sorted.at(-1)!.date;
  } catch {
    records.length = 0;
    historyError = "history-unavailable-or-invalid";
    latest = await readMeta(db);
  }
  // Merge only history fields into the latest minute state after remote work.
  const confirmedDate = historyError
    ? latest.state.historyDate
    : ([historyDate, latest.state.historyDate]
        .filter((value): value is string => Boolean(value))
        .sort()
        .at(-1) ?? null);
  const state = { ...latest.state, historyDate: confirmedDate, historyError };
  if (!historyError) state.dailyFilledThrough = addDays(today, -1);
  state.historyAttempts =
    state.historyAttemptDate === today ? state.historyAttempts + 1 : 1;
  state.historyAttemptDate = today;
  state.demo = false;
  const saved = await commitCollection(
    db,
    latest.revision,
    state,
    [],
    records,
    Date.now(),
    "history",
  );
  console.log(
    JSON.stringify({
      task: "history",
      rows: records.length,
      error: state.historyError,
    }),
  );
  return saved;
}
