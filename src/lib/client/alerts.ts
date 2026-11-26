import type {
  AlertStatus,
  AlertSettings,
  DeviceSubscription,
} from "../contracts/alert-types";

const KEY = "fx-alert-device-token";
export function deviceToken() {
  return localStorage.getItem(KEY);
}
export function saveDeviceToken(token: string | null) {
  if (token) localStorage.setItem(KEY, token);
  else localStorage.removeItem(KEY);
}
export class AlertRequestError extends Error {
  constructor(
    message: string,
    readonly status: number,
  ) {
    super(message);
  }
}
export async function alertRequest<T>(
  path: string,
  method = "GET",
  token: string | null = null,
  data?: unknown,
): Promise<T> {
  const response = await fetch(`/api/alerts/${path}`, {
    method,
    cache: "no-store",
    credentials: "omit",
    headers: {
      ...(data ? { "Content-Type": "application/json" } : {}),
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
    ...(data ? { body: JSON.stringify(data) } : {}),
  });
  const json = await response.json();
  if (!response.ok)
    throw new AlertRequestError(json.error ?? "提醒操作失败", response.status);
  return json as T;
}
export function parsePriceInput(input: string): number | null {
  if (!input.trim()) return null;
  if (!/^\d+(?:\.\d{1,4})?$/.test(input.trim()))
    throw new Error("价格最多填写四位小数");
  const units = Math.round(Number(input) * 10000);
  if (!Number.isSafeInteger(units) || units < 1 || units > 1_000_000)
    throw new Error("价格须在 0.0001–100 元之间");
  return units;
}
export async function subscribeDevice(
  publicKey: string,
  inviteCode: string,
  settings: AlertSettings,
) {
  // Called directly from a click, before any network operation, for Safari permission rules.
  const permission = await Notification.requestPermission();
  if (permission !== "granted")
    throw new Error("通知权限未开启，请在系统或浏览器设置中允许通知");
  const registration = await navigator.serviceWorker.getRegistration("/");
  if (!registration?.active)
    throw new Error("请先在线加载生产版应用，等待安装完成后再开启通知");
  const previous = await registration.pushManager.getSubscription();
  // Without the management token an old browser subscription cannot be recovered.
  // Unsubscribe it before creating a new endpoint; the old server record expires on delivery.
  if (previous) await previous.unsubscribe();
  const key = Uint8Array.from(
    atob(publicKey.replace(/-/g, "+").replace(/_/g, "/")),
    (c) => c.charCodeAt(0),
  );
  const subscription = await registration.pushManager.subscribe({
    userVisibleOnly: true,
    applicationServerKey: key,
  });
  try {
    const result = await alertRequest<AlertStatus & { token: string }>(
      "device",
      "POST",
      null,
      {
        inviteCode,
        settings,
        subscription: subscription.toJSON() as DeviceSubscription,
      },
    );
    try {
      saveDeviceToken(result.token);
    } catch {
      await alertRequest("device", "DELETE", result.token);
      throw new Error("无法保存设备凭证，请允许浏览器存储后重试");
    }
    return result;
  } catch (error) {
    await subscription.unsubscribe();
    throw error;
  }
}
