// @vitest-environment node
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { getPlatformProxy } from "wrangler";
import {
  afterAll,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import {
  cleanupDatabase,
  commitCollection,
  readMeta,
  readSync,
  ResetRequired,
} from "./server-store";
import { advanceCollection } from "../domain/intraday";
import {
  emptyCollectionState,
  type SyncResponse,
} from "../contracts/server-types";
import type { RateRecord } from "../contracts/rate-types";
import { repairDailyGaps } from "./daily-gap-repair";
import { checkDatabaseCompatibility, DatabaseSchemaError } from "./db-schema";

vi.mock("./sources", () => ({
  TODAY_SOURCE_URL: "https://example.invalid/today",
  HISTORY_SOURCE_URL: "https://example.invalid/history",
  fetchSourceHtml: vi.fn(() => {
    throw new Error("Reader reached upstream");
  }),
}));
vi.mock("./icbc-today", async (importOriginal) => ({
  ...(await importOriginal<typeof import("./icbc-today")>()),
  fetchIcbcToday: vi.fn(() => {
    throw new Error("Reader reached ICBC upstream");
  }),
}));
import { fetchSourceHtml } from "./sources";
import { collectMinute } from "./server-collector";
import { collectHistory } from "./history-collector";
import { fetchIcbcToday, parseIcbcToday } from "./icbc-today";
import { GET as handleSync } from "./api/sync";
import { GET as handleToday } from "./api/today";
import { GET as handleHistory } from "./api/history";
import { handleApi } from "../../../worker/index";

let proxy: Awaited<ReturnType<typeof getPlatformProxy<CloudflareEnv>>>;
let db: D1Database;
const getSync = (request: Request) => handleSync(request, db);
const getToday = () =>
  handleToday(new Request("http://localhost/api/today"), db);
const getHistory = (request: Request) => handleHistory(request, db);
const now = Date.parse("2026-11-22T10:05:05+08:00");
function realDaily(date: string, huiSell = 4.4331): RateRecord {
  return {
    date,
    huiSell,
    publishedAt: null,
    source: "history",
    carriedFromDate: null,
  };
}
async function seedDaily(records: RateRecord[]) {
  await commitCollection(
    db,
    0,
    { ...emptyCollectionState(), historyDate: "2026-11-21" },
    [],
    records,
    now,
    "history",
  );
}
async function write() {
  const sample = {
    minute: now - 5000,
    requestedAt: new Date(now).toISOString(),
    receivedAt: new Date(now + 1000).toISOString(),
    publishedAt: "2026-11-22T10:05:00+08:00",
    date: "2026-11-22",
    priceUnits: 47500,
  };
  const result = advanceCollection(emptyCollectionState(), now, sample, null)!;
  await commitCollection(db, 0, result.state, result.fixed, [], now + 1000);
}

beforeAll(async () => {
  proxy = await getPlatformProxy<CloudflareEnv>({
    configPath: resolve("collector/wrangler.jsonc"),
    remoteBindings: false,
    persist: false,
  });
  db = proxy.env.DB;

  const sql = readdirSync("migrations")
    .filter((file) => file.endsWith(".sql"))
    .sort()
    .map((file) => readFileSync(resolve("migrations", file), "utf8"))
    .join("\n");
  await db.batch(
    sql
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((s) => db.prepare(s)),
  );
}, 30_000);
beforeEach(async () => {
  await db.batch(
    [
      "DELETE FROM intraday_points",
      "DELETE FROM daily_rates",
      "DELETE FROM collection_runs",
      "DELETE FROM sync_changes",
      "UPDATE collection_state SET schema_version=1, revision=0, cursor_floor=0, state_json='{}', lease_token=NULL, lease_until=0, attempt_minute=NULL WHERE id=1",
    ].map((s) => db.prepare(s)),
  );
  vi.mocked(fetchSourceHtml).mockClear();
  vi.mocked(fetchIcbcToday).mockClear();
});
afterAll(async () => {
  await proxy?.dispose();
});

describe("D1 persistence and read-only API", () => {
  it("fills yesterday at Beijing midnight even when collection fails, without extra round trips", async () => {
    await seedDaily([realDaily("2026-11-21")]);
    const at = Date.parse("2026-11-23T00:00:05+08:00");
    const clock = vi.spyOn(Date, "now").mockReturnValue(at);
    const before = await readSync(db, null, at);
    const reads: string[] = [];
    const batches: number[] = [];
    const tracked = new Proxy(db, {
      get(target, key, receiver) {
        if (key === "prepare")
          return (sql: string) => {
            reads.push(sql);
            return target.prepare(sql);
          };
        if (key === "batch")
          return (commands: D1PreparedStatement[]) => {
            batches.push(commands.length);
            return target.batch(commands);
          };
        return Reflect.get(target, key, receiver);
      },
    });
    try {
      const fail = async () => {
        throw new Error("offline upstream");
      };
      await collectMinute(tracked, fail);
      const delta = await readSync(db, before.cursor, at);
      expect(delta.daily).toEqual([
        {
          ...realDaily("2026-11-22"),
          source: "carried-forward",
          carriedFromDate: "2026-11-21",
        },
      ]);
      expect(delta.state.dailyFilledThrough).toBe("2026-11-22");
      expect(delta.state.lastError).toBe("source-unavailable-or-invalid");
      expect(delta.state.historyDate).toBe("2026-11-21");
      expect(reads.filter((sql) => sql.startsWith("SELECT"))).toHaveLength(1);
      // 00:00 also performs the existing quarter-hour cleanup batch.
      expect(batches).toHaveLength(2);
      clock.mockReturnValue(at + 60_000);
      await collectMinute(db, fail);
      expect((await readSync(db, delta.cursor, at + 60_000)).daily).toEqual([]);
      clock.mockReturnValue(at + 86400_000);
      await collectMinute(db, fail);
      expect(
        (await readSync(db, null, at + 86400_000)).daily.find(
          (r) => r.date === "2026-11-23",
        ),
      ).toMatchObject({
        huiSell: 4.4331,
        source: "carried-forward",
        carriedFromDate: "2026-11-21",
      });
    } finally {
      clock.mockRestore();
    }
  });

  it("fills completed dates while the source is still publishing an older date", async () => {
    await seedDaily([realDaily("2026-11-20")]);
    const at = Date.parse("2026-11-23T10:01:05+08:00");
    const clock = vi.spyOn(Date, "now").mockReturnValue(at);
    try {
      await collectMinute(db, async () => ({
        date: "2026-11-20",
        publishedAt: "2026-11-20T12:00:00+08:00",
        priceUnits: 44331,
      }));
      const result = await readSync(db, null, at);
      expect(result.daily.map((r) => r.date)).toEqual([
        "2026-11-20",
        "2026-11-21",
        "2026-11-22",
      ]);
      expect(
        result.daily.slice(1).every((r) => r.carriedFromDate === "2026-11-20"),
      ).toBe(true);
      expect(result.state.lastSuccess?.date).toBe("2026-11-20");
    } finally {
      clock.mockRestore();
    }
  });

  it("commits the new day's quote and preceding fills in the same revision", async () => {
    await seedDaily([realDaily("2026-11-21")]);
    const at = Date.parse("2026-11-23T10:01:05+08:00");
    const clock = vi.spyOn(Date, "now").mockReturnValue(at);
    try {
      const previous = await readSync(db, null, at);
      await collectMinute(db, async () => ({
        date: "2026-11-23",
        publishedAt: "2026-11-23T10:01:00+08:00",
        priceUnits: 44460,
      }));
      const delta = await readSync(db, previous.cursor, at);
      expect(delta.daily.map((r) => [r.date, r.source])).toEqual([
        ["2026-11-22", "carried-forward"],
        ["2026-11-23", "today"],
      ]);
      const revisions = await db
        .prepare(
          "SELECT DISTINCT revision FROM daily_rates WHERE date >= '2026-11-22'",
        )
        .all<{ revision: number }>();
      expect(revisions.results).toEqual([{ revision: delta.revision }]);
    } finally {
      clock.mockRestore();
    }
  });

  it("explicitly repairs old internal and trailing gaps without upstream requests or cursor changes", async () => {
    const today = {
      ...realDaily("2026-11-23", 4.446),
      source: "today" as const,
    };
    await seedDaily([
      realDaily("2026-11-19", 4.5),
      realDaily("2026-11-21"),
      today,
    ]);
    const at = Date.parse("2026-11-23T10:01:05+08:00");
    const before = await readSync(db, null, at);
    expect(await repairDailyGaps(db, at)).toBe(true);
    const delta = await readSync(db, before.cursor, at);
    expect(delta.daily.map((r) => [r.date, r.carriedFromDate])).toEqual([
      ["2026-11-20", "2026-11-19"],
      ["2026-11-22", "2026-11-21"],
    ]);
    expect(delta.state.historyDate).toBe(before.state.historyDate);
    expect(
      (await readSync(db, null, at)).daily.find((r) => r.date === today.date),
    ).toEqual(today);
    expect(await repairDailyGaps(db, at)).toBe(true);
    expect((await readMeta(db)).revision).toBe(delta.revision);
    expect(fetchSourceHtml).not.toHaveBeenCalled();
    expect(fetchIcbcToday).not.toHaveBeenCalled();
  });

  it("historical corrections replace carried values and update their downstream fills", async () => {
    await seedDaily([
      realDaily("2026-11-20"),
      { ...realDaily("2026-11-23", 4.446), source: "today" },
    ]);
    const at = Date.parse("2026-11-24T10:01:05+08:00");
    await repairDailyGaps(db, at);
    const before = await readSync(db, null, at);
    const clock = vi.spyOn(Date, "now").mockReturnValue(at);
    try {
      await collectHistory(
        db,
        async () =>
          '<table class="bank_huilv_table text-nowrap"><tr><td>2026-11-21</td><td><span class="td_rate">4.5</span></td></tr><tr><td>2026-11-24</td><td><span class="td_rate">9</span></td></tr></table>',
      );
      const delta = await readSync(db, before.cursor, at);
      expect(
        delta.daily.map((r) => [
          r.date,
          r.huiSell,
          r.source,
          r.carriedFromDate,
        ]),
      ).toEqual([
        ["2026-11-21", 4.5, "history", null],
        ["2026-11-22", 4.5, "carried-forward", "2026-11-21"],
      ]);
      const snapshot = await readSync(db, null, at);
      expect(snapshot.daily.find((r) => r.date === "2026-11-23")?.huiSell).toBe(
        4.446,
      );
      expect(snapshot.daily.some((r) => r.date === "2026-11-24")).toBe(false);
      expect(snapshot.state.historyDate).toBe("2026-11-21");
    } finally {
      clock.mockRestore();
    }
  });

  it("never replaces a stored real quote with a carried value or emits a false daily change", async () => {
    await seedDaily([realDaily("2026-11-21", 4.5)]);
    const before = await readSync(db, null, now);
    const meta = await readMeta(db);
    await commitCollection(
      db,
      meta.revision,
      meta.state,
      [],
      [
        {
          ...realDaily("2026-11-21"),
          source: "carried-forward",
          carriedFromDate: "2026-11-20",
        },
      ],
      now,
      "repair",
    );
    expect((await readSync(db, before.cursor, now)).daily).toEqual([]);
    expect((await readSync(db, null, now)).daily[0].huiSell).toBe(4.5);
    expect(
      (
        await db
          .prepare(
            "SELECT * FROM sync_changes WHERE revision = ? AND entity = 'daily'",
          )
          .bind(meta.revision + 1)
          .all()
      ).results,
    ).toEqual([]);
  });

  it("loses a repair atomically if another writer changes the daily snapshot", async () => {
    await seedDaily([realDaily("2026-11-21")]);
    const at = Date.parse("2026-11-23T10:01:05+08:00");
    const tracked = new Proxy(db, {
      get(target, key, receiver) {
        if (key === "batch")
          return async (commands: D1PreparedStatement[]) => {
            const meta = await readMeta(db);
            await commitCollection(
              db,
              meta.revision,
              meta.state,
              [],
              [realDaily("2026-11-22", 4.5)],
              at,
              "history",
            );
            return target.batch(commands);
          };
        return Reflect.get(target, key, receiver);
      },
    });
    expect(await repairDailyGaps(tracked, at)).toBe(false);
    expect((await readMeta(db)).state.dailyFilledThrough).toBeNull();
    expect(
      (await readSync(db, null, at)).daily.find((r) => r.date === "2026-11-22")
        ?.huiSell,
    ).toBe(4.5);
    expect(await repairDailyGaps(db, at)).toBe(true);
  });
  it("rejects incompatible client protocols without querying or clearing business data", async () => {
    await write();
    const result = await getSync(
      new Request("http://localhost/api/sync?schema=0"),
    );
    expect(result.status).toBe(426);
    expect(await result.json()).toMatchObject({
      schema: 1,
      resetClientCache: true,
    });
    expect((await readSync(db, null, now)).points).toHaveLength(1);
  });
  it("checks structural compatibility explicitly before deployment, without a runtime version gate", async () => {
    await write();
    await checkDatabaseCompatibility(db);
    await db.prepare("UPDATE collection_state SET schema_version=999").run();
    await expect(checkDatabaseCompatibility(db)).rejects.toBeInstanceOf(
      DatabaseSchemaError,
    );
    expect(
      (await getSync(new Request("http://localhost/api/sync?schema=1"))).status,
    ).toBe(200);
    expect((await readSync(db, null, now)).points).toHaveLength(1);
    expect(fetchIcbcToday).not.toHaveBeenCalled();
  });
  it("preflight catches an unapplied write-marker migration even with the same schema generation", async () => {
    await db
      .prepare(
        "ALTER TABLE collection_state RENAME COLUMN write_id TO missing_write_id",
      )
      .run();
    try {
      await expect(checkDatabaseCompatibility(db)).rejects.toThrow();
    } finally {
      await db
        .prepare(
          "ALTER TABLE collection_state RENAME COLUMN missing_write_id TO write_id",
        )
        .run();
    }
  });
  it("uses revision indexes for incremental reads instead of scanning the retained window", async () => {
    const plan = await db
      .prepare(
        "EXPLAIN QUERY PLAN SELECT value_json FROM intraday_points INDEXED BY intraday_revision WHERE date >= ? AND revision > ? ORDER BY minute",
      )
      .bind("2026-11-20", 99)
      .all<{ detail: string }>();
    expect(
      plan.results.some(
        (row) =>
          row.detail.includes("intraday_revision") &&
          row.detail.includes("SEARCH"),
      ),
    ).toBe(true);
  });
  it("collects real-shaped fixtures only through explicit collector entrypoints", async () => {
    const quote = parseIcbcToday(
      JSON.parse(
        readFileSync(
          resolve("src/lib/server/__fixtures__/icbc-latest.json"),
          "utf8",
        ),
      ),
    );
    const fetchQuote = vi.fn(async () => quote);
    await collectMinute(db, fetchQuote);
    await collectMinute(db, fetchQuote);
    expect(fetchQuote).toHaveBeenCalledTimes(1);
    expect((await readMeta(db)).state.lastSuccess?.priceUnits).toBe(44331);
    expect((await readMeta(db)).state.lastSuccess?.publishedAt).toBe(
      "2026-11-21T04:08:43+08:00",
    );
    const historyHtml = readFileSync(
      resolve("src/lib/server/__fixtures__/d-icbc-aud.html"),
      "utf8",
    );
    await collectHistory(db, async () => historyHtml);
    const snapshot = await readSync(db, null);
    expect(snapshot.daily.some((row) => row.source === "carried-forward")).toBe(
      true,
    );
    expect(snapshot.state.historyDate).toBe("2026-07-24");
    expect(
      (
        await db
          .prepare("SELECT count(*) AS n FROM collection_runs")
          .first<{ n: number }>()
      )?.n,
    ).toBe(0);
  });
  it("writes a same-day daily quote atomically and skips rewriting it when only collection time changes", async () => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(now);
    const quote = {
      date: "2026-11-22",
      publishedAt: "2026-11-22T10:00:00+08:00",
      priceUnits: 44331,
    };
    try {
      await collectMinute(db, async () => quote);
      const initial = await readSync(db, null, now);
      expect(initial.daily).toEqual([
        {
          date: quote.date,
          huiSell: 4.4331,
          publishedAt: quote.publishedAt,
          source: "today",
          carriedFromDate: null,
        },
      ]);
      expect(initial.points).toHaveLength(1);
      clock.mockReturnValue(now + 60000);
      await collectMinute(db, async () => quote);
      const delta = await readSync(db, initial.cursor, now + 60000);
      expect(delta.daily).toEqual([]);
      expect(delta.state.lastAttemptMinute).toBe(now - 5000 + 60000);
      expect(delta.state.lastSuccess?.priceUnits).toBe(44331);
    } finally {
      clock.mockRestore();
    }
  });
  it("returns only changed entities for a cursor while preserving current metadata", async () => {
    await write();
    const first = await readSync(db, null, now);
    expect(first.points).toHaveLength(1);
    const delta = await readSync(db, first.cursor, now);
    expect(delta.mode).toBe("delta");
    expect(delta.points).toEqual([]);
    expect(delta.state.lastSuccess?.priceUnits).toBe(47500);
    const log = await db.prepare("SELECT * FROM sync_changes").all();
    expect(JSON.stringify(log.results)).not.toContain("47500");
  });
  it("preserves the last quote on ICBC failure without falling back to the legacy source", async () => {
    await write();
    const previous = (await readMeta(db)).state.lastSuccess;
    await collectMinute(db, async () => {
      throw new Error("ICBC unavailable");
    });
    const state = (await readMeta(db)).state;
    expect(state.lastSuccess).toEqual(previous);
    expect(state.lastError).toBe("source-unavailable-or-invalid");
    expect(fetchSourceHtml).not.toHaveBeenCalled();
  });
  it("merges history into the latest minute state instead of holding a lock while fetching", async () => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(now);
    const quote = parseIcbcToday(
      JSON.parse(
        readFileSync(
          resolve("src/lib/server/__fixtures__/icbc-latest.json"),
          "utf8",
        ),
      ),
    );
    const historyHtml = readFileSync(
      resolve("src/lib/server/__fixtures__/d-icbc-aud.html"),
      "utf8",
    );
    try {
      const saved = await collectHistory(db, async () => {
        await collectMinute(db, async () => quote);
        return historyHtml;
      });
      expect(saved).toBe(true);
      const state = (await readMeta(db)).state;
      expect(state.lastSuccess?.priceUnits).toBe(44331);
      expect(state.lastAttemptMinute).toBe(now - 5000);
      expect(state.historyDate).toBe("2026-07-24");
    } finally {
      clock.mockRestore();
    }
  });
  it("records history source failure without advancing the confirmed history cursor", async () => {
    await write();
    await db
      .prepare(
        "UPDATE collection_state SET state_json=json_set(state_json,'$.historyDate','2026-11-20') WHERE id=1",
      )
      .run();
    await collectHistory(db, async () => {
      throw new Error("History source unavailable");
    });
    const meta = await readMeta(db);
    expect(meta.state.historyDate).toBe("2026-11-20");
    expect(meta.state.historyError).toBe("history-unavailable-or-invalid");
    expect(meta.state.lastSuccess?.priceUnits).toBe(47500);
  });
  it("rejects stale and duplicate commits without writing losing entities", async () => {
    await write();
    const winner = await readMeta(db);
    const stale = { ...winner.state, lastAttemptMinute: now + 60000 };
    const daily = [
      {
        date: "2026-11-21",
        huiSell: 9,
        publishedAt: null,
        source: "history" as const,
        carriedFromDate: null,
      },
    ];
    expect(await commitCollection(db, 0, stale, [], daily, now + 60000)).toBe(
      false,
    );
    expect(
      await commitCollection(
        db,
        winner.revision,
        winner.state,
        [],
        daily,
        now + 60000,
      ),
    ).toBe(false);
    expect((await readMeta(db)).revision).toBe(winner.revision);
    expect(
      (
        await db
          .prepare("SELECT count(*) AS n FROM daily_rates")
          .first<{ n: number }>()
      )?.n,
    ).toBe(0);
    expect((await readSync(db, null, now)).points).toHaveLength(1);
  });
  it("uses one state read and one batch for a normal minute, without lease or diagnostic writes", async () => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(now + 60000);
    const statements: string[] = [];
    const batches: number[] = [];
    const tracked = new Proxy(db, {
      get(target, key, receiver) {
        if (key === "prepare")
          return (sql: string) => {
            statements.push(sql);
            return target.prepare(sql);
          };
        if (key === "batch")
          return (commands: D1PreparedStatement[]) => {
            batches.push(commands.length);
            return target.batch(commands);
          };
        return Reflect.get(target, key, receiver);
      },
    });
    const quote = parseIcbcToday(
      JSON.parse(
        readFileSync(
          resolve("src/lib/server/__fixtures__/icbc-latest.json"),
          "utf8",
        ),
      ),
    );
    try {
      await collectMinute(tracked, async () => quote);
      expect(statements.filter((sql) => sql.startsWith("SELECT"))).toHaveLength(
        1,
      );
      expect(
        statements.some(
          (sql) =>
            sql.includes("lease_") ||
            sql.includes("INSERT INTO collection_runs"),
        ),
      ).toBe(false);
      expect(batches).toEqual([2]);
    } finally {
      clock.mockRestore();
    }
  });
  it("does not let a slower old-minute fetch overwrite a newer result", async () => {
    const clock = vi.spyOn(Date, "now").mockReturnValue(now);
    const quote = parseIcbcToday(
      JSON.parse(
        readFileSync(
          resolve("src/lib/server/__fixtures__/icbc-latest.json"),
          "utf8",
        ),
      ),
    );
    let start!: () => void;
    let finish!: (value: typeof quote) => void;
    const started = new Promise<void>((resolve) => {
      start = resolve;
    });
    const pending = new Promise<typeof quote>((resolve) => {
      finish = resolve;
    });
    try {
      const old = collectMinute(db, () => {
        start();
        return pending;
      });
      await started;
      clock.mockReturnValue(now + 60000);
      await collectMinute(db, async () => ({ ...quote, priceUnits: 44332 }));
      finish(quote);
      await old;
      const state = (await readMeta(db)).state;
      expect(state.lastSuccess?.priceUnits).toBe(44332);
      expect(state.lastAttemptMinute).toBe(now - 5000 + 60000);
      expect((await readSync(db, null, now + 60000)).points).toEqual([]);
    } finally {
      clock.mockRestore();
    }
  });
  it("rolls back metadata if a batched write fails", async () => {
    const invalid = {
      date: undefined,
      huiSell: 4.75,
      publishedAt: null,
      source: "history",
      carriedFromDate: null,
    };
    await expect(
      commitCollection(
        db,
        0,
        emptyCollectionState(),
        [],
        [invalid as never],
        now,
        "history",
      ),
    ).rejects.toThrow();
    expect((await readMeta(db)).revision).toBe(0);
  });
  it("expires fixed points and cursors without deleting daily history", async () => {
    await write();
    const first = await readSync(db, null, now);
    await db
      .prepare("INSERT INTO daily_rates VALUES ('2026-11-22', ?, 1)")
      .bind(
        JSON.stringify({
          date: "2026-11-22",
          huiSell: 4.75,
          source: "history",
          publishedAt: null,
          carriedFromDate: null,
        }),
      )
      .run();
    const later = now + 4 * 86400000;
    await cleanupDatabase(db, later);
    expect((await readSync(db, null, later)).points).toEqual([]);
    expect(
      (
        await db
          .prepare("SELECT count(*) AS n FROM daily_rates")
          .first<{ n: number }>()
      )?.n,
    ).toBe(1);
    await expect(
      readSync(db, `${first.datasetId}.0`, later),
    ).rejects.toBeInstanceOf(ResetRequired);
  });
  it("hides expired points immediately and physically cleans them on a quarter-hour tick", async () => {
    const stale = now - 10 * 86400000;
    await db
      .prepare("INSERT INTO intraday_points VALUES (?, '2026-11-12', ?, 0)")
      .bind(
        stale,
        JSON.stringify({
          minute: stale,
          kind: "fixed",
          priceUnits: null,
          publishedAt: null,
          sourceMinute: null,
          sourceRequestedAt: null,
          isFallback: false,
        }),
      )
      .run();
    const clock = vi.spyOn(Date, "now").mockReturnValue(now);
    const quote = parseIcbcToday(
      JSON.parse(
        readFileSync(
          resolve("src/lib/server/__fixtures__/icbc-latest.json"),
          "utf8",
        ),
      ),
    );
    try {
      await collectMinute(db, async () => quote);
      expect(
        await db
          .prepare("SELECT minute FROM intraday_points WHERE minute=?")
          .bind(stale)
          .first(),
      ).not.toBeNull();
      expect(
        (await readSync(db, null, now)).points.some((p) => p.minute === stale),
      ).toBe(false);
      clock.mockReturnValue(now + 10 * 60000);
      await collectMinute(db, async () => quote);
      expect(
        await db
          .prepare("SELECT minute FROM intraday_points WHERE minute=?")
          .bind(stale)
          .first(),
      ).toBeNull();
    } finally {
      clock.mockRestore();
    }
  });
  it("routes Worker APIs without SPA fallback or writes and preserves HTTP validation", async () => {
    for (const [path, method, status] of [
      ["/api/unknown", "GET", 404],
      ["/api", "GET", 404],
      ["/api/sync", "POST", 405],
      ["/api/intraday?date=bad", "GET", 400],
      ["/api/history?datefrom=bad", "GET", 400],
      ["/api/sync?schema=999", "GET", 426],
      ["/api/sync", "GET", 503],
    ] as const) {
      const response = await handleApi(
        new Request(`http://localhost${path}`, { method }),
        db,
      );
      expect(response.status).toBe(status);
      expect(response.headers.get("Content-Type")).toContain(
        "application/json",
      );
      if (status === 405) expect(response.headers.get("Allow")).toBe("GET");
    }
    await write();
    const valid = await handleApi(
      new Request("http://localhost/api/sync?schema=1"),
      db,
    );
    const data = await valid.json<SyncResponse>();
    expect(valid.status).toBe(200);
    expect(valid.headers.get("Cache-Control")).toBe(
      "public, s-maxage=15, stale-while-revalidate=15",
    );
    expect(data).toMatchObject({ schema: 1, mode: "snapshot" });
    const delta = await handleApi(
      new Request(`http://localhost/api/sync?schema=1&cursor=${data.cursor}`),
      db,
    );
    expect(await delta.json()).toMatchObject({
      cursor: data.cursor,
      mode: "delta",
      daily: [],
      points: [],
    });
    expect(fetchSourceHtml).not.toHaveBeenCalled();
    expect(fetchIcbcToday).not.toHaveBeenCalled();
  });
  it("never fetches upstream on empty DB, forced refresh arguments or repeated reads", async () => {
    expect(
      (await getSync(new Request("http://localhost/api/sync"))).status,
    ).toBe(503);
    expect((await getToday()).status).toBe(503);
    expect(
      (
        await getHistory(
          new Request(
            "http://localhost/api/history?datefrom=2026-11-20&force=true",
          ),
        )
      ).status,
    ).toBe(503);
    await write();
    for (let i = 0; i < 3; i++)
      expect(
        (await getSync(new Request("http://localhost/api/sync?force=true")))
          .status,
      ).toBe(200);
    expect(fetchSourceHtml).not.toHaveBeenCalled();
    expect(fetchIcbcToday).not.toHaveBeenCalled();
  });
});
