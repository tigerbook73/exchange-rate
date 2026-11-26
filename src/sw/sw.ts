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

// Always display a visible notification; push is never used for silent polling.
self.addEventListener("push", (event: PushEvent) => {
  let value: unknown;
  try {
    value = event.data?.json();
  } catch {
    return;
  }
  if (!value || typeof value !== "object") return;
  const data = value as Record<string, unknown>;
  if (
    typeof data.title !== "string" ||
    typeof data.body !== "string" ||
    typeof data.tag !== "string"
  )
    return;
  event.waitUntil(
    self.registration.showNotification(data.title, {
      body: data.body,
      tag: data.tag,
      icon: "/icons/icon-192.png",
      data: { url: "/" },
    }),
  );
});
self.addEventListener("notificationclick", (event: NotificationEvent) => {
  event.notification.close();
  event.waitUntil(
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
  );
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
