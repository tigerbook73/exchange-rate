import { flushNotificationReads } from "../lib/client/notification-receipts";
import {
  showAlertNotification,
  readAlertNotification,
  maintainAlertNotifications,
} from "./notifications";
import { defaultCache } from "@serwist/vite/worker";
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import { Serwist, NetworkOnly } from "serwist";

declare global {
  interface WorkerGlobalScope extends SerwistGlobalConfig {
    __SW_MANIFEST: (PrecacheEntry | string)[] | undefined;
  }
}

declare const self: ServiceWorkerGlobalScope;

// defaultCache already includes: cache-first for static assets (JS/CSS/fonts/
// images), and network-first (10s timeout) for same-origin /api/* — matching
// this project's PWA caching requirements (docs/blueprint.md §8) without
// needing a custom runtimeCaching entry.
const serwist = new Serwist({
  precacheEntries: self.__SW_MANIFEST,
  skipWaiting: true,
  clientsClaim: true,
  navigationPreload: true,
  runtimeCaching: [
    {
      matcher: ({ url }) => url.pathname.startsWith("/api/alerts/"),
      handler: new NetworkOnly(),
    },
    ...defaultCache,
  ],
});

serwist.addEventListeners();

self.addEventListener("push", (event: PushEvent) => {
  event.waitUntil(
    (async () => {
      try {
        await Promise.all([
          showAlertNotification(event.data?.json()),
          flushNotificationReads(),
        ]);
      } catch {
        console.error("Notification could not be displayed");
      }
    })(),
  );
});
self.addEventListener("notificationclick", (event: NotificationEvent) => {
  event.notification.close();
  // Acknowledging never blocks opening the app, including when offline.
  event.waitUntil(
    Promise.allSettled([
      readAlertNotification(event.notification),
      (async () => {
        const windows = await self.clients.matchAll({
          type: "window",
          includeUncontrolled: true,
        });
        const existing = windows.find(
          (client) => new URL(client.url).origin === self.location.origin,
        );
        if (existing) await existing.focus();
        else await self.clients.openWindow("/");
      })(),
    ]).then(() => undefined),
  );
});
self.addEventListener("notificationclose", (event: NotificationEvent) => {
  event.waitUntil(readAlertNotification(event.notification));
});
self.addEventListener("message", (event: ExtendableMessageEvent) => {
  if (
    event.data?.type === "MAINTAIN_ALERT_NOTIFICATIONS" ||
    event.data?.type === "CLEAR_ALERT_NOTIFICATIONS"
  )
    event.waitUntil(
      maintainAlertNotifications(
        event.data.type === "CLEAR_ALERT_NOTIFICATIONS",
      ),
    );
});
self.addEventListener("activate", (event: ExtendableEvent) => {
  event.waitUntil(maintainAlertNotifications());
});

// A preceding SW may briefly serve a newer page before this version takes over.
// Remove only notification API entries; keep quote and application caches intact.
self.addEventListener("activate", (event: ExtendableEvent) => {
  event.waitUntil(
    (async () => {
      for (const name of await caches.keys()) {
        const cache = await caches.open(name);
        for (const request of await cache.keys()) {
          const url = new URL(request.url);
          if (
            url.origin === self.location.origin &&
            url.pathname.startsWith("/api/alerts/")
          )
            await cache.delete(request);
        }
      }
    })(),
  );
});
