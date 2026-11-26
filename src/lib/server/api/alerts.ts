import {
  enqueueTest,
  readAlertStatus,
  registerDevice,
  updateAlertSettings,
} from "../alert-store";
import { hashToken, parseSubscription, sameSecret, vapidKeys } from "../push";
import { parseAlertSettings } from "../../domain/price-alerts";

class ApiError extends Error {
  constructor(
    message: string,
    readonly status = 400,
  ) {
    super(message);
  }
}
async function body(request: Request): Promise<Record<string, unknown>> {
  if (!request.headers.get("content-type")?.startsWith("application/json"))
    throw new ApiError("请发送 JSON");
  const reader = request.body?.getReader();
  if (!reader) throw new ApiError("请求内容为空");
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > 8192) {
        await reader.cancel();
        throw new ApiError("请求内容过大", 413);
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(length);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    const parsed: unknown = JSON.parse(new TextDecoder().decode(bytes));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      throw new Error();
    return parsed as Record<string, unknown>;
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError("JSON 内容无效");
  } finally {
    reader.releaseLock();
  }
}
export async function handleAlerts(
  request: Request,
  env: Pick<CloudflareEnv, "DB" | "PUSH_VAPID_KEYS" | "PUSH_INVITE_CODE">,
): Promise<Response> {
  const json = (value: unknown, status = 200) =>
    Response.json(value, {
      status,
      headers: {
        "Cache-Control": "no-store",
        Vary: "Authorization",
        "X-Content-Type-Options": "nosniff",
      },
    });
  const path = new URL(request.url).pathname;
  const methods: Record<string, string[]> = {
    "/api/alerts/config": ["GET"],
    "/api/alerts/device": ["POST", "GET", "PUT", "DELETE"],
    "/api/alerts/test": ["POST"],
  };
  if (!Object.hasOwn(methods, path)) return json({ error: "Not found" }, 404);
  if (!methods[path].includes(request.method))
    return new Response(null, {
      status: 405,
      headers: { Allow: methods[path].join(", "), "Cache-Control": "no-store" },
    });
  try {
    if (
      request.headers.get("sec-fetch-site") === "cross-site" ||
      (request.method !== "GET" &&
        request.headers.get("origin") !== new URL(request.url).origin)
    )
      throw new ApiError("仅允许本站操作", 403);
    if (!env.PUSH_VAPID_KEYS || !env.PUSH_INVITE_CODE)
      throw new ApiError("提醒服务尚未配置", 503);
    if (path === "/api/alerts/config")
      return json({ publicKey: vapidKeys(env.PUSH_VAPID_KEYS).publicKey });
    if (path === "/api/alerts/device" && request.method === "POST") {
      const input = await body(request);
      if (
        typeof input.inviteCode !== "string" ||
        !(await sameSecret(input.inviteCode, env.PUSH_INVITE_CODE))
      )
        throw new ApiError("邀请码不正确", 403);
      let settings, subscription;
      try {
        settings = parseAlertSettings(input.settings);
        subscription = parseSubscription(input.subscription);
      } catch (error) {
        throw new ApiError(error instanceof Error ? error.message : "订阅无效");
      }
      const token = crypto.randomUUID() + crypto.randomUUID();
      const id = crypto.randomUUID();
      if (
        !(await registerDevice(
          env.DB,
          id,
          await hashToken(token),
          subscription,
          settings,
          Date.now(),
        ))
      )
        throw new ApiError(
          "订阅已存在或设备数量已达上限，请取消旧订阅后再试",
          409,
        );
      return json({ token, ...(await readAlertStatus(env.DB, id)) }, 201);
    }
    const token = request.headers
      .get("authorization")
      ?.match(/^Bearer ([a-f0-9-]{72})$/)?.[1];
    if (!token) throw new ApiError("缺少设备管理凭证", 401);
    const device = await env.DB.prepare(
      "SELECT id FROM push_devices WHERE token_hash=?",
    )
      .bind(await hashToken(token))
      .first<{ id: string }>();
    if (!device) throw new ApiError("设备订阅已失效，请重新开启通知", 401);
    if (path === "/api/alerts/test") {
      if (!(await enqueueTest(env.DB, device.id, Date.now())))
        throw new ApiError("每分钟只能发送一次测试通知", 429);
      return json({ queued: true }, 202);
    }
    if (request.method === "DELETE") {
      await env.DB.prepare("DELETE FROM push_devices WHERE id=?")
        .bind(device.id)
        .run();
      return json({ deleted: true });
    }
    if (request.method === "PUT") {
      const input = await body(request);
      let settings;
      try {
        settings = parseAlertSettings(input);
      } catch (error) {
        throw new ApiError(error instanceof Error ? error.message : "设置无效");
      }
      await updateAlertSettings(env.DB, device.id, settings, Date.now());
    }
    return json(await readAlertStatus(env.DB, device.id));
  } catch (error) {
    if (error instanceof ApiError)
      return json({ error: error.message }, error.status);
    console.error(
      JSON.stringify({ task: "alerts-api", error: "request-failed" }),
    );
    return json({ error: "提醒服务暂时不可用，请稍后重试" }, 503);
  }
}
