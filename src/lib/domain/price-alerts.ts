import type { AlertSettings } from "../contracts/alert-types";
import type { QuoteSample } from "../contracts/server-types";
import { getBeijingDateString } from "./date";

export const ALERT_TTL = 5 * 60_000;
export const MAX_PUSH_DEVICES = 10;
export function freshAlertQuote(quote: QuoteSample | null, now: number) {
  if (!quote || quote.date !== getBeijingDateString(new Date(now)))
    return false;
  const age = now - Date.parse(quote.publishedAt);
  return Number.isFinite(age) && age >= -60_000 && age < ALERT_TTL;
}
export function parseAlertSettings(value: unknown): AlertSettings {
  if (!value || typeof value !== "object") throw new Error("提醒设置无效");
  const v = value as Record<string, unknown>;
  for (const key of ["lowUnits", "highUnits"] as const) {
    if (
      v[key] !== null &&
      (!Number.isInteger(v[key]) ||
        Number(v[key]) < 1 ||
        Number(v[key]) > 1_000_000)
    )
      throw new Error("价格须在 0.0001–100 元之间，最多四位小数");
  }
  if (typeof v.lowEnabled !== "boolean" || typeof v.highEnabled !== "boolean")
    throw new Error("提醒开关无效");
  const result: AlertSettings = {
    lowUnits: v.lowUnits as number | null,
    highUnits: v.highUnits as number | null,
    lowEnabled: v.lowEnabled,
    highEnabled: v.highEnabled,
  };
  if (
    (result.lowEnabled && result.lowUnits === null) ||
    (result.highEnabled && result.highUnits === null)
  )
    throw new Error("请填写已开启提醒的价格");
  if (
    result.lowUnits !== null &&
    result.highUnits !== null &&
    result.lowUnits >= result.highUnits
  )
    throw new Error("低价阈值须小于高价阈值");
  return {
    lowUnits: result.lowUnits,
    highUnits: result.highUnits,
    lowEnabled: result.lowEnabled,
    highEnabled: result.highEnabled,
  };
}
