import { spawnSync } from "node:child_process";
import { createRequire } from "node:module";
import { dirname, resolve } from "node:path";

const require = createRequire(import.meta.url);
const cli = resolve(
  dirname(require.resolve("wrangler/package.json")),
  "bin/wrangler.js",
);
const env = { ...process.env };
// The parent Builds job belongs to the website. Its target override must not
// rename the collector or validate it against the website's script tag.
delete env.WRANGLER_CI_OVERRIDE_NAME;
delete env.WRANGLER_CI_MATCH_TAG;
const result = spawnSync(
  process.execPath,
  [
    cli,
    "deploy",
    "--config",
    "collector/wrangler.jsonc",
    ...process.argv.slice(2),
  ],
  { env, stdio: "inherit" },
);
if (result.error) throw result.error;
process.exitCode = result.status ?? 1;
