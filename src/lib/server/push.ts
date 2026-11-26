import { buildPushPayload, type VapidKeys } from "@block65/webcrypto-web-push";
import type {
  AlertNotification,
  DeviceSubscription,
} from "../contracts/alert-types";

const services = new Set([
  "fcm.googleapis.com",
  "updates.push.services.mozilla.com",
  "web.push.apple.com",
]);
export function parseSubscription(value: unknown): DeviceSubscription {
  if (!value || typeof value !== "object") throw new Error("推送订阅无效");
  const v = value as Partial<DeviceSubscription>;
  if (typeof v.endpoint !== "string" || v.endpoint.length > 2048)
    throw new Error("推送地址无效");
  const url = new URL(v.endpoint);
  if (
    url.protocol !== "https:" ||
    !(
      services.has(url.hostname) ||
      /^[a-z0-9-]+\.notify\.windows\.com$/.test(url.hostname)
    ) ||
    url.port ||
    url.username ||
    url.password ||
    url.hash
  )
    throw new Error("不支持此推送服务，请使用 Safari、Chrome、Edge 或 Firefox");
  if (
    !v.keys ||
    !/^[A-Za-z0-9_-]{87}$/.test(v.keys.p256dh) ||
    !/^[A-Za-z0-9_-]{22}$/.test(v.keys.auth)
  )
    throw new Error("推送密钥无效");
  if (atob(v.keys.p256dh.replace(/-/g, "+").replace(/_/g, "/"))[0] !== "\x04")
    throw new Error("推送密钥无效");
  return {
    endpoint: url.href,
    expirationTime: null,
    keys: { p256dh: v.keys.p256dh, auth: v.keys.auth },
  };
}
export function vapidKeys(raw: string) {
  const keys = JSON.parse(raw) as VapidKeys;
  if (!keys.publicKey || !keys.privateKey || !keys.subject)
    throw new Error("推送密钥未配置");
  return {
    subject: keys.subject,
    publicKey: keys.publicKey,
    privateKey: keys.privateKey,
  };
}
export async function hashToken(value: string) {
  const bytes = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value),
  );
  return Array.from(new Uint8Array(bytes), (b) =>
    b.toString(16).padStart(2, "0"),
  ).join("");
}
export async function sameSecret(a: string, b: string) {
  // HMAC verification provides constant-time verification on both Web Crypto and Workers.
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(b),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(b),
  );
  return crypto.subtle.verify(
    "HMAC",
    key,
    signature,
    new TextEncoder().encode(a),
  );
}
export async function sendPush(
  subscription: DeviceSubscription,
  notification: AlertNotification,
  keys: VapidKeys,
  ttl: number,
  fetcher = fetch,
) {
  parseSubscription(subscription);
  const payload = await buildPushPayload(
    {
      data: {
        title: notification.title,
        body: notification.body,
        tag: notification.tag,
        url: notification.url,
        ...(notification.receipt
          ? { receipt: { ...notification.receipt } }
          : {}),
        ...(notification.createdAt !== undefined
          ? { createdAt: notification.createdAt }
          : {}),
      },
      options: { ttl: Math.max(1, Math.min(300, ttl)), urgency: "high" },
    },
    subscription,
    keys,
  );
  const response = await fetcher(subscription.endpoint, {
    ...payload,
    redirect: "error",
    signal: AbortSignal.timeout(8000),
  });
  await response.body?.cancel();
  return response.status;
}

async function receiptKey(privateKey: string) {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(privateKey),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}
export async function signAlertReceipt(id: string, privateKey: string) {
  const signature = await crypto.subtle.sign(
    "HMAC",
    await receiptKey(privateKey),
    new TextEncoder().encode(`fx-alert-read:${id}`),
  );
  return Array.from(new Uint8Array(signature), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
export async function verifyAlertReceipt(
  id: string,
  token: string,
  privateKey: string,
) {
  if (!/^[a-f0-9]{64}$/.test(token)) return false;
  const bytes = Uint8Array.from(token.match(/../g)!, (hex) =>
    parseInt(hex, 16),
  );
  return crypto.subtle.verify(
    "HMAC",
    await receiptKey(privateKey),
    bytes,
    new TextEncoder().encode(`fx-alert-read:${id}`),
  );
}
