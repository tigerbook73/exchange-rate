import { createRequire } from "node:module";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import wrangler from "wrangler";

const { getPlatformProxy, unstable_readConfig: readConfig } = wrangler;

const mode = process.argv[2];
if (!["check", "bootstrap"].includes(mode) || process.argv[3] !== "--remote")
  throw new Error("Choose check or bootstrap and explicitly pass --remote.");
const config = readConfig({ config: "wrangler.jsonc" });
const database = config.d1_databases.find(({ binding }) => binding === "DB");
if (!database?.database_id || database.database_id.startsWith("00000000-"))
  throw new Error("Production D1 has not been configured.");

// Only this explicit administration command enables remote bindings. There is
// no reset/delete operation, public endpoint or change to local development.
await mkdir(".wrangler", { recursive: true });
const configPath = resolve(".wrangler/production-data.json");
await writeFile(
  configPath,
  JSON.stringify({
    name: "icbc-rate-data-admin",
    account_id: config.account_id,
    compatibility_date: config.compatibility_date,
    compatibility_flags: ["nodejs_compat"],
    d1_databases: [
      {
        binding: "DB",
        database_name: database.database_name,
        database_id: database.database_id,
        remote: true,
      },
    ],
  }),
);
console.log(
  JSON.stringify({
    mode,
    remote: true,
    database: database.database_name,
    id: database.database_id,
  }),
);
const require = createRequire(import.meta.url);
const wranglerRequire = createRequire(require.resolve("wrangler"));
await wranglerRequire("esbuild").build({
  stdin: {
    contents:
      'export {collectMinute} from "./src/lib/server-collector"; export {collectHistory} from "./src/lib/history-collector"; export {readMeta} from "./src/lib/server-store"; export {checkDatabaseCompatibility} from "./src/lib/db-schema";',
    resolveDir: process.cwd(),
  },
  outfile: ".wrangler/production-actions.mjs",
  bundle: true,
  packages: "external",
  platform: "node",
  format: "esm",
});
const proxy = await getPlatformProxy({
  configPath,
  persist: false,
  remoteBindings: true,
});
try {
  const {
    collectMinute,
    collectHistory,
    readMeta,
    checkDatabaseCompatibility,
  } = await import(
    pathToFileURL(resolve(".wrangler/production-actions.mjs")).href
  );
  await checkDatabaseCompatibility(proxy.env.DB);
  if ((await readMeta(proxy.env.DB)).state.demo)
    throw new Error(
      "Production database contains demo data; refusing to proceed.",
    );
  if (mode === "bootstrap") {
    await collectMinute(proxy.env.DB);
    let updated = false;
    for (let attempt = 0; attempt < 4 && !updated; attempt++) {
      updated = await collectHistory(proxy.env.DB);
      if (!updated && attempt < 3)
        await new Promise((resolve) => setTimeout(resolve, 1000));
    }
    if (!updated)
      throw new Error(
        "History update conflicted with another write; deployment must stop and retry.",
      );
  }
  const meta = await readMeta(proxy.env.DB);
  const counts = await proxy.env.DB.prepare(
    "SELECT (SELECT count(*) FROM daily_rates) AS daily, (SELECT count(*) FROM intraday_points) AS fixed",
  ).first();
  const ready = Boolean(
    meta.state.lastSuccess &&
    !meta.state.lastError &&
    meta.state.historyDate &&
    !meta.state.historyError,
  );
  console.log(
    JSON.stringify(
      {
        schema: meta.schema_version,
        datasetId: meta.dataset_id,
        revision: meta.revision,
        ready,
        counts,
        state: meta.state,
      },
      null,
      2,
    ),
  );
  if (!ready)
    throw new Error("Production data is not ready; do not switch the website.");
} finally {
  await proxy.dispose();
}
