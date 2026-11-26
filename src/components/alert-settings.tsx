import { useState } from "react";
import { Dialog } from "@base-ui/react/dialog";
import { Bell, X } from "lucide-react";
import { Button } from "./ui/button";
import {
  alertRequest,
  AlertRequestError,
  deviceToken,
  parsePriceInput,
  saveDeviceToken,
  subscribeDevice,
} from "../lib/client/alerts";
import type { AlertSettings, AlertStatus } from "../lib/contracts/alert-types";

const field =
  "h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-50";
const outcomes = {
  pending: "等待发送",
  sent: "已提交推送",
  failed: "发送失败",
  expired: "已过期",
  cancelled: "已取消",
};
export function AlertSettingsButton({
  currentPrice,
}: {
  currentPrice: number | undefined;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [token, setToken] = useState<string | null>(null);
  const [publicKey, setPublicKey] = useState("");
  const [status, setStatus] = useState<AlertStatus | null>(null);
  const [invite, setInvite] = useState("");
  const [low, setLow] = useState("");
  const [high, setHigh] = useState("");
  const [lowEnabled, setLowEnabled] = useState(false);
  const [highEnabled, setHighEnabled] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const supported =
    typeof Notification !== "undefined" &&
    "serviceWorker" in navigator &&
    "PushManager" in window;
  const denied = supported && Notification.permission === "denied";
  const ios =
    /iPad|iPhone|iPod/.test(navigator.userAgent) ||
    (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const needsInstall =
    ios &&
    !window.matchMedia("(display-mode: standalone)").matches &&
    !(navigator as Navigator & { standalone?: boolean }).standalone;
  function apply(next: AlertStatus) {
    setStatus(next);
    setLow(next.lowUnits === null ? "" : (next.lowUnits / 10000).toFixed(4));
    setHigh(next.highUnits === null ? "" : (next.highUnits / 10000).toFixed(4));
    setLowEnabled(next.lowEnabled);
    setHighEnabled(next.highEnabled);
  }
  async function run(action: () => Promise<void>) {
    setBusy(true);
    setError("");
    setMessage("");
    try {
      await action();
    } catch (e) {
      if (e instanceof AlertRequestError && e.status === 401) {
        saveDeviceToken(null);
        setToken(null);
        setStatus(null);
      }
      setError(e instanceof Error ? e.message : "操作失败，请稍后重试");
    } finally {
      setBusy(false);
    }
  }
  function onOpen(next: boolean) {
    setOpen(next);
    if (!next) return;
    void run(async () => {
      setPublicKey("");
      const stored = deviceToken();
      setToken(stored);
      const config = await alertRequest<{ publicKey: string }>("config");
      setPublicKey(config.publicKey);
      if (stored)
        apply(await alertRequest<AlertStatus>("device", "GET", stored));
    });
  }
  function settings(): AlertSettings {
    return {
      lowUnits: parsePriceInput(low),
      highUnits: parsePriceInput(high),
      lowEnabled,
      highEnabled,
    };
  }
  async function save() {
    await run(async () => {
      const next = settings();
      if (
        (next.lowEnabled && next.lowUnits === null) ||
        (next.highEnabled && next.highUnits === null)
      )
        throw new Error("请填写已开启提醒的价格");
      if (
        next.lowUnits !== null &&
        next.highUnits !== null &&
        next.lowUnits >= next.highUnits
      )
        throw new Error("低价阈值须小于高价阈值");
      if (token)
        apply(await alertRequest<AlertStatus>("device", "PUT", token, next));
      else {
        const result = await subscribeDevice(publicKey, invite, next);
        setToken(result.token);
        setInvite("");
        apply(result);
      }
      setMessage("已保存。达标后提醒一次，请手动重新开启后续提醒。");
    });
  }
  const alreadyMet =
    currentPrice !== undefined &&
    ((lowEnabled && Number(low) > 0 && currentPrice <= Number(low)) ||
      (highEnabled && Number(high) > 0 && currentPrice >= Number(high)));
  return (
    <Dialog.Root open={open} onOpenChange={onOpen}>
      <Dialog.Trigger
        render={
          <Button
            variant="ghost"
            size="icon-sm"
            className="align-middle text-muted-foreground"
            aria-label="价格提醒"
            title="价格提醒"
          />
        }
      >
        <Bell />
      </Dialog.Trigger>
      <Dialog.Portal>
        <Dialog.Backdrop className="fixed inset-0 z-40 bg-black/40" />
        <Dialog.Popup className="fixed top-1/2 left-1/2 z-50 max-h-[calc(100dvh-2rem)] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 -translate-y-1/2 overflow-y-auto rounded-xl border border-border bg-background p-5 text-foreground shadow-xl">
          <div className="flex items-center justify-between gap-3">
            <Dialog.Title className="font-semibold">价格提醒</Dialog.Title>
            <Dialog.Close
              render={
                <Button
                  variant="ghost"
                  size="icon-sm"
                  aria-label="关闭价格提醒"
                />
              }
            >
              <X />
            </Dialog.Close>
          </div>
          <Dialog.Description className="mt-2 text-sm text-muted-foreground">
            按本设备设置，页面关闭后也可接收通知。每项达标提醒一次。
          </Dialog.Description>
          <div className="mt-4 space-y-4">
            {needsInstall ? (
              <p className="text-sm">
                请先通过浏览器分享菜单“添加到主屏幕”，再从主屏幕打开并开启通知。
              </p>
            ) : !supported ? (
              <p className="text-sm">
                当前浏览器不支持推送通知，请使用支持 Web Push 的浏览器。
              </p>
            ) : null}
            {denied ? (
              <p className="text-sm">
                通知权限已关闭，请先在系统或浏览器设置中允许通知。
              </p>
            ) : null}
            {!token ? (
              <label className="block space-y-1 text-sm">
                <span>共享邀请码</span>
                <input
                  className={field}
                  type="password"
                  autoComplete="off"
                  value={invite}
                  onChange={(e) => setInvite(e.target.value)}
                  disabled={busy}
                />
                <span className="block text-xs text-muted-foreground">
                  仅首次开启需要，无需注册账号。
                </span>
              </label>
            ) : null}
            <fieldset disabled={busy} className="space-y-4">
              <legend className="sr-only">提醒价格设置</legend>
              <div className="space-y-1 text-sm">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={lowEnabled}
                    onChange={(e) => setLowEnabled(e.target.checked)}
                  />
                  低价提醒（≤）
                </label>
                <input
                  className={field}
                  aria-label="低价阈值"
                  inputMode="decimal"
                  placeholder="例如 4.6000"
                  value={low}
                  onChange={(e) => setLow(e.target.value)}
                />
              </div>
              <div className="space-y-1 text-sm">
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={highEnabled}
                    onChange={(e) => setHighEnabled(e.target.checked)}
                  />
                  高价提醒（≥）
                </label>
                <input
                  className={field}
                  aria-label="高价阈值"
                  inputMode="decimal"
                  placeholder="例如 4.8000"
                  value={high}
                  onChange={(e) => setHigh(e.target.value)}
                />
              </div>
            </fieldset>
            <p className="text-xs text-muted-foreground">
              人民币／澳元 ·
              工商银行现汇卖出价。手机和电脑分别设置；通知可能因网络或系统设置延迟。
            </p>
            {alreadyMet ? (
              <p className="text-sm">
                当前显示价格已达标，将在下次有效采集后提醒。
              </p>
            ) : null}
            {error ? (
              <p className="text-sm text-destructive" role="alert">
                {error}
              </p>
            ) : null}
            {message ? (
              <p className="text-sm" role="status">
                {message}
              </p>
            ) : null}
            <div className="flex flex-wrap gap-2">
              <Button
                disabled={
                  busy ||
                  !publicKey ||
                  (!token &&
                    (!supported || denied || needsInstall || !invite.trim()))
                }
                onClick={() => void save()}
              >
                {busy ? "处理中…" : token ? "保存并更新提醒" : "开启通知并保存"}
              </Button>
              {token ? (
                <>
                  <Button
                    variant="outline"
                    disabled={busy || denied}
                    onClick={() =>
                      void run(async () => {
                        await alertRequest("test", "POST", token);
                        setMessage("测试通知已排队，通常在下一分钟发送。");
                      })
                    }
                  >
                    测试通知
                  </Button>
                  <Button
                    variant="ghost"
                    disabled={busy}
                    onClick={() =>
                      void run(async () => {
                        await alertRequest("device", "DELETE", token);
                        saveDeviceToken(null);
                        setToken(null);
                        setStatus(null);
                        setLowEnabled(false);
                        setHighEnabled(false);
                        const registration =
                          await navigator.serviceWorker.getRegistration("/");
                        await (
                          await registration?.pushManager.getSubscription()
                        )?.unsubscribe();
                        setMessage("已取消本设备的全部提醒。");
                      })
                    }
                  >
                    取消订阅
                  </Button>
                </>
              ) : null}
            </div>
            {status?.recent.length ? (
              <div className="space-y-2 border-t border-border pt-3 text-xs text-muted-foreground">
                <p>最近提醒</p>
                {status.recent.map((event, i) => (
                  <p key={i}>
                    {event.kind === "test"
                      ? "测试通知"
                      : event.kind === "low"
                        ? "低价提醒"
                        : "高价提醒"}{" "}
                    · {outcomes[event.status]} ·{" "}
                    {new Date(event.createdAt).toLocaleString()}
                  </p>
                ))}
              </div>
            ) : null}
          </div>
        </Dialog.Popup>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
