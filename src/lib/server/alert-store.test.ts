import { collectMinute } from "./server-collector";
import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { getPlatformProxy } from "wrangler";
import {
  beforeAll,
  beforeEach,
  afterAll,
  describe,
  it,
  expect,
  vi,
} from "vitest";
import {
  registerDevice,
  readAlertStatus,
  updateAlertSettings,
  dispatchAlerts,
  enqueueTest,
} from "./alert-store";
import { hashToken, parseSubscription, sendPush } from "./push";
import { handleAlerts } from "./api/alerts";
import { commitCollection } from "./server-store";
import {
  emptyCollectionState,
  type QuoteSample,
} from "../contracts/server-types";
import { freshAlertQuote, parseAlertSettings } from "../domain/price-alerts";
import type { DeviceSubscription } from "../contracts/alert-types";

let proxy: Awaited<ReturnType<typeof getPlatformProxy<CloudflareEnv>>>;
let db: D1Database;
let subscription: DeviceSubscription;
let keys: string;
const now = Date.parse("2026-11-26T10:00:05+08:00");
const settings = {
  lowUnits: 46000,
  highUnits: 48000,
  lowEnabled: true,
  highEnabled: true,
};
const quote: QuoteSample = {
  minute: now - 5000,
  requestedAt: new Date(now).toISOString(),
  receivedAt: new Date(now).toISOString(),
  publishedAt: "2026-11-26T10:00:00+08:00",
  date: "2026-11-26",
  priceUnits: 45000,
};
async function device(id = "a") {
  await registerDevice(
    db,
    id,
    await hashToken(id.repeat(72)),
    { ...subscription, endpoint: subscription.endpoint + id },
    settings,
    now - 1,
  );
  return id;
}
async function commit(revision = 0, priceUnits = 45000, time = now) {
  const sample = {
    ...quote,
    priceUnits,
    requestedAt: new Date(time).toISOString(),
  };
  return commitCollection(
    db,
    revision,
    {
      ...emptyCollectionState(),
      lastAttemptMinute: Math.floor(time / 60000) * 60000,
      lastSuccess: sample,
    },
    [],
    [],
    time,
    "minute",
    sample,
  );
}
const request = (
  path: string,
  method = "GET",
  token?: string,
  data?: unknown,
) =>
  new Request(`https://rates.test/api/alerts/${path}`, {
    method,
    headers: {
      Origin: "https://rates.test",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(data ? { "Content-Type": "application/json" } : {}),
    },
    ...(data ? { body: JSON.stringify(data) } : {}),
  });
function api(req: Request) {
  return handleAlerts(req, {
    DB: db,
    PUSH_VAPID_KEYS: keys,
    PUSH_INVITE_CODE: "test-invite",
  });
}
beforeAll(async () => {
  proxy = await getPlatformProxy<CloudflareEnv>({
    configPath: resolve("collector/wrangler.jsonc"),
    remoteBindings: false,
    persist: false,
  });
  db = proxy.env.DB;
  const sql = readdirSync("migrations")
    .filter((x) => x.endsWith(".sql"))
    .sort()
    .map((x) => readFileSync(resolve("migrations", x), "utf8"))
    .join("\n");
  await db.batch(
    sql
      .split(";")
      .map((x) => x.trim())
      .filter(Boolean)
      .map((x) => db.prepare(x)),
  );
  const pair = await crypto.subtle.generateKey(
    { name: "ECDH", namedCurve: "P-256" },
    true,
    ["deriveBits"],
  );
  const vapid = await crypto.subtle.generateKey(
    { name: "ECDSA", namedCurve: "P-256" },
    true,
    ["sign", "verify"],
  );
  subscription = {
    endpoint: "https://fcm.googleapis.com/fcm/send/test-",
    expirationTime: null,
    keys: {
      p256dh: Buffer.from(
        await crypto.subtle.exportKey("raw", pair.publicKey),
      ).toString("base64url"),
      auth: Buffer.alloc(16, 7).toString("base64url"),
    },
  };
  keys = JSON.stringify({
    publicKey: Buffer.from(
      await crypto.subtle.exportKey("raw", vapid.publicKey),
    ).toString("base64url"),
    privateKey: (await crypto.subtle.exportKey("jwk", vapid.privateKey)).d,
    subject: "https://rates.test",
  });
}, 30000);
beforeEach(async () => {
  await db.batch(
    [
      "DELETE FROM push_events",
      "DELETE FROM push_devices",
      "DELETE FROM sync_changes",
      "UPDATE collection_state SET revision=0,state_json='{}',write_id=NULL WHERE id=1",
    ].map((sql) => db.prepare(sql)),
  );
  vi.spyOn(Date, "now").mockReturnValue(now);
});
afterAll(async () => {
  vi.restoreAllMocks();
  await proxy?.dispose();
});

describe("price alert persistence and delivery", () => {
  it("atomically creates one event and disarms only the matched rule; losing revisions cannot trigger", async () => {
    await device();
    expect(await commit()).toBe(true);
    expect(await commit()).toBe(false);
    const status = await readAlertStatus(db, "a");
    expect(status.lowEnabled).toBe(false);
    expect(status.highEnabled).toBe(true);
    expect(status.recent).toHaveLength(1);
    await commit(1, 49000, now + 60000);
    expect((await readAlertStatus(db, "a")).recent).toHaveLength(2);
  });
  it("rejects stale source quotes before enqueueing and triggers on a fresh successful collection", async () => {
    await device();
    await collectMinute(
      db,
      async () => ({ ...quote, publishedAt: "2026-11-26T09:00:00+08:00" }),
      null,
      true,
    );
    expect((await readAlertStatus(db, "a")).recent).toHaveLength(0);
    vi.spyOn(Date, "now").mockReturnValue(now + 60000);
    await collectMinute(db, async () => quote, null, true);
    expect((await readAlertStatus(db, "a")).recent).toHaveLength(1);
  });
  it("concurrent dispatches cannot attempt the same event twice", async () => {
    await device();
    await commit();
    const fetcher = vi.fn<typeof fetch>(
      async () => new Response(null, { status: 201 }),
    );
    await Promise.all([
      dispatchAlerts(db, keys, now, fetcher),
      dispatchAlerts(db, keys, now, fetcher),
    ]);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it("includes threshold equality and does not trigger a rule created after a request began", async () => {
    await device();
    await commit(0, 46000);
    expect((await readAlertStatus(db, "a")).lowEnabled).toBe(false);
    await updateAlertSettings(db, "a", settings, now + 100000);
    await commit(1, 48000, now + 60000);
    expect((await readAlertStatus(db, "a")).highEnabled).toBe(true);
  });
  it("cancels queued events on edits and allows an explicit rearm to trigger again", async () => {
    await device();
    await commit();
    await updateAlertSettings(db, "a", settings, now + 1);
    await commit(1, 45000, now + 60000);
    const status = await readAlertStatus(db, "a");
    expect(status.recent.map((e) => e.status)).toEqual([
      "pending",
      "cancelled",
    ]);
  });
  it("bounds the number of devices even with concurrent enrollments", async () => {
    const results = await Promise.all(
      Array.from({ length: 12 }, (_, i) =>
        registerDevice(
          db,
          `d${i}`,
          `hash${i}`,
          { ...subscription, endpoint: subscription.endpoint + i },
          settings,
          now,
        ),
      ),
    );
    expect(results.filter(Boolean)).toHaveLength(10);
  });
  it("rate limits concurrent test notifications in an atomic batch", async () => {
    await device();
    const results = await Promise.all([
      enqueueTest(db, "a", now),
      enqueueTest(db, "a", now),
    ]);
    expect(results.sort()).toEqual([false, true]);
  });
  it("retries transient failures without generating another price event", async () => {
    await device();
    await commit();
    const fetcher = vi.fn(async () => new Response(null, { status: 503 }));
    await dispatchAlerts(db, keys, now, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await dispatchAlerts(db, keys, now + 1000, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await dispatchAlerts(db, keys, now + 60000, fetcher);
    await dispatchAlerts(db, keys, now + 120000, fetcher);
    expect(fetcher).toHaveBeenCalledTimes(3);
    expect((await readAlertStatus(db, "a")).recent[0].status).toBe("failed");
    await commit(1);
    expect((await readAlertStatus(db, "a")).recent).toHaveLength(1);
  });
  it("submits encrypted Web Push with bounded TTL and disables expired endpoints", async () => {
    await device();
    await commit();
    const fetcher = vi.fn<typeof fetch>(
      async () => new Response(null, { status: 201 }),
    );
    await dispatchAlerts(db, keys, now, fetcher);
    const init = fetcher.mock.calls[0]?.[1] as RequestInit | undefined;
    expect(new Headers(init?.headers).get("content-encoding")).toBe(
      "aes128gcm",
    );
    expect(new Headers(init?.headers).get("authorization")).toMatch(/^vapid /);
    expect((await readAlertStatus(db, "a")).recent[0].status).toBe("sent");
    await device("b");
    await commit(1, 45000, now + 60000);
    await dispatchAlerts(
      db,
      keys,
      now + 60000,
      async () => new Response(null, { status: 410 }),
    );
    expect(
      await db
        .prepare("SELECT id FROM push_devices WHERE id=?")
        .bind("b")
        .first(),
    ).toBeNull();
  });
  it("expires unsent events and does not send cancelled rules", async () => {
    await device();
    await commit();
    const fetcher = vi.fn();
    await dispatchAlerts(db, keys, now + 300000, fetcher);
    expect(fetcher).not.toHaveBeenCalled();
    expect((await readAlertStatus(db, "a")).recent[0].status).toBe("expired");
  });
});
describe("device API isolation", () => {
  it("requires an invite and same origin, then returns a token only on enrollment", async () => {
    const data = { inviteCode: "bad", settings, subscription };
    expect((await api(request("device", "POST", undefined, data))).status).toBe(
      403,
    );
    data.inviteCode = "test-invite";
    const foreign = request("device", "POST", undefined, data);
    foreign.headers.set("Origin", "https://evil.test");
    expect((await api(foreign)).status).toBe(403);
    const response = await api(request("device", "POST", undefined, data));
    expect(response.status).toBe(201);
    const { token } = (await response.json()) as { token: string };
    expect(token).toHaveLength(72);
    const own = await api(request("device", "GET", token));
    expect(own.status).toBe(200);
    expect(own.headers.get("cache-control")).toBe("no-store");
    expect(JSON.stringify(await own.json())).not.toContain(token);
    expect((await api(request("device"))).status).toBe(401);
    expect((await api(request("device", "GET", "f".repeat(72)))).status).toBe(
      401,
    );
  });
  it("updates only the bearer device and deleting it removes its pending notifications", async () => {
    await device();
    await device("b");
    await commit();
    const response = await api(
      request("device", "PUT", "a".repeat(72), {
        ...settings,
        lowEnabled: false,
        highEnabled: false,
      }),
    );
    expect(response.status).toBe(200);
    expect((await readAlertStatus(db, "b")).highEnabled).toBe(true);
    expect(
      (await api(request("device", "DELETE", "a".repeat(72)))).status,
    ).toBe(200);
    expect(
      await db
        .prepare("SELECT id FROM push_events WHERE device_id='a'")
        .first(),
    ).toBeNull();
  });
  it("rejects arbitrary push destinations, invalid prices and oversized bodies", async () => {
    for (const endpoint of [
      "https://127.0.0.1/push",
      "https://fcm.googleapis.com.evil.test/push",
      "https://web.push.apple.com@evil.test/push",
    ])
      expect(() => parseSubscription({ ...subscription, endpoint })).toThrow();
    expect(() =>
      parseAlertSettings({ ...settings, lowUnits: 48000 }),
    ).toThrow();
    expect(() =>
      parseAlertSettings({ ...settings, lowUnits: 45000.1 }),
    ).toThrow();
    expect(
      (
        await api(
          request("device", "POST", undefined, { padding: "x".repeat(9000) }),
        )
      ).status,
    ).toBe(413);
    expect((await api(request("anything"))).status).toBe(404);
  });
});
it("never accepts stale or previous-day quotes as a trigger", () => {
  expect(freshAlertQuote(quote, now)).toBe(true);
  expect(freshAlertQuote(quote, now + 301000)).toBe(false);
  expect(freshAlertQuote({ ...quote, date: "2026-11-25" }, now)).toBe(false);
  expect(freshAlertQuote(null, now)).toBe(false);
});
it("does not follow push service redirects", async () => {
  const fetcher = vi.fn<typeof fetch>(async (_url, init) => {
    expect(init?.redirect).toBe("error");
    return new Response(null, { status: 201 });
  });
  await sendPush(
    subscription,
    { title: "test", body: "body", tag: "test", url: "/" },
    JSON.parse(keys),
    10,
    fetcher,
  );
});
