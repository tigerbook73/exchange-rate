import { readFileSync } from "node:fs";

const worker = readFileSync("dist/client/sw.js", "utf8");
if (/["']?url["']?\s*:\s*["']\/_(?:headers|redirects)["']/.test(worker)) {
  throw new Error(
    "Service worker precaches Cloudflare configuration URLs; installation would fail.",
  );
}
console.log("Service-worker precache excludes Cloudflare configuration files.");
