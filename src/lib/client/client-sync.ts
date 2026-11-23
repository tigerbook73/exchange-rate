import { getBeijingDateString, isValidDate } from "../domain/date";
import type { RatesDb } from "./rates-db";
import { SYNC_SCHEMA, type SyncResponse } from "../contracts/server-types";
import { ApiUpgradeRequired } from "./api-upgrade";

export function validateSync(data: SyncResponse): void {
  if (
    !data ||
    data.schema !== SYNC_SCHEMA ||
    !/^[a-f0-9]{32}$/.test(data.datasetId) ||
    !Number.isSafeInteger(data.revision) ||
    data.revision < 0 ||
    data.cursor !== `${data.datasetId}.${data.revision}` ||
    !["snapshot", "delta"].includes(data.mode) ||
    !isValidDate(data.retainedFrom) ||
    !isValidDate(data.historyFrom) ||
    !Number.isFinite(Date.parse(data.generatedAt)) ||
    !data.state ||
    !Array.isArray(data.daily) ||
    !Array.isArray(data.points) ||
    !Array.isArray(data.deletedDaily) ||
    !Array.isArray(data.deletedPoints) ||
    data.daily.length > 366 ||
    data.points.length > 864
  )
    throw new Error("服务端同步数据格式无效");
  if (
    data.daily.some(
      (p) =>
        !isValidDate(p.date) ||
        !Number.isFinite(p.huiSell) ||
        p.huiSell <= 0 ||
        !["today", "history", "carried-forward"].includes(p.source),
    ) ||
    data.points.some(
      (p) =>
        !Number.isSafeInteger(p.minute) ||
        (p.priceUnits !== null &&
          (!Number.isSafeInteger(p.priceUnits) || p.priceUnits <= 0)),
    )
  )
    throw new Error("服务端报价数据无效");
}

export async function readClientCache(db: RatesDb) {
  const tx = db.transaction(["rates", "points", "server"]);
  const [records, points, server] = await Promise.all([
    tx.objectStore("rates").getAll(),
    tx.objectStore("points").getAll(),
    tx.objectStore("server").get("current"),
  ]);
  await tx.done;
  const compatible = server?.schema === SYNC_SCHEMA;
  const readable = records.filter(
    (record) =>
      record &&
      typeof record.date === "string" &&
      isValidDate(record.date) &&
      Number.isFinite(record.huiSell) &&
      record.huiSell > 0 &&
      ["today", "history", "carried-forward"].includes(record.source),
  );
  return {
    records: readable,
    points: compatible ? points : [],
    server: compatible ? server : null,
  };
}

export async function applyServerSync(
  db: RatesDb,
  data: SyncResponse,
  resetLocalCache = false,
) {
  validateSync(data);
  if (resetLocalCache && data.mode !== "snapshot")
    throw new Error("升级需要完整窗口快照");
  const tx = db.transaction(["rates", "points", "server"], "readwrite");
  const previous = await tx.objectStore("server").get("current");
  if (previous && Number(previous.schema) > data.schema) {
    await tx.done;
    throw new ApiUpgradeRequired(Number(previous.schema));
  }
  if (
    previous &&
    !resetLocalCache &&
    ((data.datasetId === previous.datasetId &&
      (data.revision < previous.revision ||
        (data.revision === previous.revision &&
          Date.parse(data.generatedAt) < Date.parse(previous.generatedAt)))) ||
      (data.mode === "delta" && data.datasetId !== previous.datasetId))
  ) {
    await tx.done;
    return false;
  }
  if (resetLocalCache) {
    await tx.objectStore("rates").clear();
    await tx.objectStore("points").clear();
    await tx.objectStore("server").clear();
  }
  if (data.mode === "snapshot") {
    for (const key of await tx.objectStore("rates").getAllKeys()) {
      if (key >= data.historyFrom) await tx.objectStore("rates").delete(key);
    }
    await tx.objectStore("points").clear();
  }
  for (const date of data.deletedDaily)
    await tx.objectStore("rates").delete(date);
  for (const minute of data.deletedPoints)
    await tx.objectStore("points").delete(minute);
  for (const record of data.daily) await tx.objectStore("rates").put(record);
  for (const point of data.points) await tx.objectStore("points").put(point);
  for (const minute of await tx.objectStore("points").getAllKeys()) {
    if (getBeijingDateString(new Date(minute)) < data.retainedFrom)
      await tx.objectStore("points").delete(minute);
  }
  // Only one live point, inside metadata. Never append intermediate minute prices.
  await tx
    .objectStore("server")
    .put(
      { ...data, daily: [], points: [], deletedDaily: [], deletedPoints: [] },
      "current",
    );
  await tx.done;
  return true;
}
