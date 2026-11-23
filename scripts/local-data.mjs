import { createRequire } from "node:module";
import { mkdir } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { getPlatformProxy } from "wrangler";
import { setTimeout as delay } from "node:timers/promises";

const mode = process.argv[2];
if (
  ![
    "demo",
    "collect",
    "backfill",
    "repair-gaps",
    "reset",
    "watch",
    "check",
  ].includes(mode)
)
  throw new Error(
    "Choose demo, collect, backfill, repair-gaps, reset, watch or check",
  );
// Use Wrangler's installed esbuild, without adding another build dependency.
const require = createRequire(import.meta.url);
const wranglerRequire = createRequire(require.resolve("wrangler"));
const { build } = wranglerRequire("esbuild");
await mkdir(".wrangler", { recursive: true });
await build({
  entryPoints: ["scripts/local-actions.ts"],
  outfile: ".wrangler/local-actions.mjs",
  bundle: true,
  packages: "external",
  platform: "node",
  format: "esm",
});
const proxy = await getPlatformProxy({
  configPath: "wrangler.jsonc",
  remoteBindings: false,
  persist: { path: resolve(".wrangler/state/v3") },
});
try {
  const { run } = await import(
    pathToFileURL(resolve(".wrangler/local-actions.mjs")).href
  );
  if (mode === "watch") {
    const stop = new AbortController();
    process.once("SIGINT", () => stop.abort());
    process.once("SIGTERM", () => stop.abort());
    console.log(
      "Local real-source collection every minute. Press Ctrl+C to stop. No Cloudflare deployment.",
    );
    while (!stop.signal.aborted) {
      await run(proxy.env.DB, "tick");
      try {
        await delay(60_000 - (Date.now() % 60_000) + 1000, null, {
          signal: stop.signal,
        });
      } catch (error) {
        if (!stop.signal.aborted) throw error;
      }
    }
  } else await run(proxy.env.DB, mode);
} finally {
  await proxy.dispose();
}
