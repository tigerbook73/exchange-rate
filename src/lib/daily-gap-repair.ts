import { addDays, getBeijingDateString } from "./date";
import { dailyGapFills } from "./daily-gaps";
import type { RateRecord } from "./rates-db";
import { commitCollection, readMeta } from "./server-store";

/** Explicit maintenance: no upstream request and no changes to the history cursor. */
export async function repairDailyGaps(db: D1Database, now = Date.now()) {
  const through = addDays(getBeijingDateString(new Date(now)), -1);
  const meta = await readMeta(db);
  const rows = await db
    .prepare("SELECT value_json FROM daily_rates WHERE date <= ? ORDER BY date")
    .bind(through)
    .all<{ value_json: string }>();
  const fills = dailyGapFills(
    rows.results.map((row) => JSON.parse(row.value_json) as RateRecord),
    through,
  );
  if (!fills.length && meta.state.dailyFilledThrough === through) return true;
  return commitCollection(
    db,
    meta.revision,
    { ...meta.state, dailyFilledThrough: through },
    [],
    fills,
    now,
    "repair",
  );
}
