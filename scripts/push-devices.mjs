import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";
const args = process.argv.slice(2);
const remote = args.includes("--remote");
const positional = args.filter((x) => x !== "--remote");
const [action, id] = positional;
if (
  (action !== "list" && action !== "remove") ||
  (action === "remove" && !/^[a-f0-9-]{36}$/.test(id ?? "")) ||
  (action === "list" && positional.length !== 1) ||
  (action === "remove" && positional.length !== 2)
)
  throw new Error(
    "Usage: pnpm push:devices list [--remote] | remove <device UUID> [--remote]",
  );
const sql =
  action === "list"
    ? "SELECT id, low_enabled, high_enabled, updated_at FROM push_devices ORDER BY updated_at DESC"
    : `DELETE FROM push_devices WHERE id='${id}'`;
const require = createRequire(import.meta.url);
const cli = resolve(
  dirname(require.resolve("wrangler/package.json")),
  "bin/wrangler.js",
);
const result = spawnSync(
  process.execPath,
  [
    cli,
    "d1",
    "execute",
    "DB",
    "--config",
    "wrangler.jsonc",
    remote ? "--remote" : "--local",
    ...(!remote ? ["--persist-to", ".wrangler/state"] : []),
    "--command",
    sql,
  ],
  { stdio: "inherit" },
);
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
