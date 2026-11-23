import { addDays, getBeijingDateString } from "../src/lib/domain/date";
import {
  advanceCollection,
  dayStart,
  minuteOf,
} from "../src/lib/domain/intraday";
import { collectMinute } from "../src/lib/server/server-collector";
import { collectHistory } from "../src/lib/server/history-collector";
import { repairDailyGaps } from "../src/lib/server/daily-gap-repair";
import {
  commitCollection,
  readMeta,
  cleanupDatabase,
} from "../src/lib/server/server-store";
import { checkDatabaseCompatibility } from "../src/lib/server/db-schema";
import type { RateRecord } from "../src/lib/contracts/rate-types";

export async function run(db: D1Database, mode: string) {
  if (mode === "check") {
    await checkDatabaseCompatibility(db);
    const meta = await readMeta(db);
    console.log(
      JSON.stringify({
        databaseSchema: meta.schema_version,
        datasetId: meta.dataset_id,
        revision: meta.revision,
        compatible: true,
      }),
    );
    return;
  }
  if (mode === "reset") {
    await db.batch(
      [
        "DELETE FROM intraday_points",
        "DELETE FROM daily_rates",
        "DELETE FROM collection_runs",
        "DELETE FROM sync_changes",
        "UPDATE collection_state SET schema_version=1, dataset_id=lower(hex(randomblob(16))), revision=0, cursor_floor=0, state_json='{}', lease_token=NULL, lease_until=0, attempt_minute=NULL WHERE id=1",
      ].map((sql) => db.prepare(sql)),
    );
    console.log("Local database reset. Cloud data was not accessed.");
    return;
  }
  if (mode === "collect") return collectMinute(db);
  if (mode === "backfill") return collectHistory(db);
  if (mode === "repair-gaps") {
    if (!(await repairDailyGaps(db)))
      throw new Error("Daily gap repair conflicted with another write; retry.");
    console.log(
      "Local daily gaps repaired through yesterday. No upstream request was made.",
    );
    return;
  }
  const now = Date.now();
  const meta = await readMeta(db);
  if (meta.revision > 0)
    throw new Error(
      "Demo seeding requires a fresh local database; existing data was not modified.",
    );
  const today = getBeijingDateString(new Date(now));

  let state = meta.state;
  const fixed = [];
  for (
    let minute = dayStart(addDays(today, -2));
    minute <= minuteOf(now);
    minute += 60_000
  ) {
    const priceUnits = Math.round(47500 + Math.sin(minute / 3600000) * 80);
    const requestedAt = new Date(minute + 5000).toISOString();
    const result = advanceCollection(
      state,
      minute + 5000,
      {
        minute,
        priceUnits,
        requestedAt,
        receivedAt: new Date(minute + 6000).toISOString(),
        date: getBeijingDateString(new Date(minute)),
        publishedAt: requestedAt,
      },
      null,
    )!;
    state = result.state;
    fixed.push(...result.fixed);
  }
  state.demo = true;
  state.historyDate = addDays(today, -1);
  const daily: RateRecord[] = [];
  for (let i = 365; i >= 0; i--) {
    const date = addDays(today, -i);
    daily.push({
      date,
      huiSell: Math.round(47500 + Math.sin(i / 15) * 500) / 10000,
      publishedAt: i === 0 ? state.lastSuccess!.publishedAt : null,
      source: i === 0 ? "today" : "history",
      carriedFromDate: null,
    });
  }
  // Keep demo card and current point consistent.
  daily[daily.length - 1].huiSell = state.lastSuccess!.priceUnits / 10000;
  const saved = await commitCollection(
    db,
    meta.revision,
    state,
    fixed,
    daily,
    Date.now(),
    "demo",
  );
  if (!saved)
    throw new Error(
      "Local data changed during demo initialization; no demo batch was saved.",
    );
  await cleanupDatabase(db, Date.now());
  console.log(
    "Local DEMO initialized: 366 daily values and three days of intraday points. No upstream request was made.",
  );
}
