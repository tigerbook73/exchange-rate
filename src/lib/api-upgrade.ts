import { SYNC_SCHEMA } from "./server-types";

export const UPGRADE_KEY = "icbc-rate:api-upgrade";
export interface UpgradeTicket {
  fromSchema: number;
  targetSchema: number;
}
export class ApiUpgradeRequired extends Error {
  constructor(public readonly targetSchema: number) {
    super("API 协议版本需要更新");
  }
}
export function isSchemaVersion(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0;
}
export function readUpgradeTicket(
  storage: Pick<Storage, "getItem">,
): UpgradeTicket | null {
  try {
    const value = JSON.parse(storage.getItem(UPGRADE_KEY) ?? "null");
    return value &&
      isSchemaVersion(value.fromSchema) &&
      isSchemaVersion(value.targetSchema)
      ? value
      : null;
  } catch {
    return null;
  }
}
/** Without persistent loop protection, do not attempt an automatic reload. */
export function prepareApiUpgrade(
  targetSchema: number,
  storage: Pick<Storage, "getItem" | "setItem">,
  currentSchema: number = SYNC_SCHEMA,
): boolean {
  if (!isSchemaVersion(targetSchema) || targetSchema === currentSchema)
    return false;
  const previous = readUpgradeTicket(storage);
  if (
    previous?.targetSchema === targetSchema &&
    previous.fromSchema === currentSchema
  )
    return false;
  try {
    storage.setItem(
      UPGRADE_KEY,
      JSON.stringify({ fromSchema: currentSchema, targetSchema }),
    );
    return true;
  } catch {
    return false;
  }
}
export function needsCacheReset(
  previous: { schema: number } | undefined,
  currentSchema: number = SYNC_SCHEMA,
): boolean {
  // Unversioned legacy caches can be displayed offline, but must not be
  // treated as an authoritative cache once a fresh compatible snapshot arrives.
  return previous?.schema !== currentSchema;
}
/** Remove obsolete API responses only, never the SW or its application assets. */
export async function clearOldApiResponses(
  currentSchema: number = SYNC_SCHEMA,
) {
  if (typeof caches === "undefined") return;
  const paths = new Set([
    "/api/sync",
    "/api/today",
    "/api/history",
    "/api/intraday",
  ]);
  for (const name of await caches.keys()) {
    const cache = await caches.open(name);
    for (const request of await cache.keys()) {
      const url = new URL(request.url);
      if (
        url.origin === location.origin &&
        paths.has(url.pathname) &&
        url.searchParams.get("schema") !== String(currentSchema)
      )
        await cache.delete(request);
    }
  }
}
