import { defaultCache } from "@serwist/vite/worker";
import type { PrecacheEntry, SerwistGlobalConfig } from "serwist";
import { Serwist } from "serwist";

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
  runtimeCaching: defaultCache,
});

serwist.addEventListeners();
