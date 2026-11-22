import { getCloudflareContext } from "@opennextjs/cloudflare";
import { readSync, ResetRequired } from "./server-store";
import type { SyncResponse } from "./server-types";
import { DatabaseSchemaError } from "./db-schema";

export async function queryServer(
  cursor: string | null = null,
): Promise<SyncResponse> {
  const { env } = await getCloudflareContext({ async: true });
  return readSync(env.DB, cursor);
}

export function queryError(error: unknown) {
  if (error instanceof DatabaseSchemaError)
    return Response.json(
      { error: "database_upgrade_required" },
      { status: 503, headers: { "Cache-Control": "no-store" } },
    );
  if (error instanceof ResetRequired)
    return Response.json(
      { resetRequired: true },
      { status: 409, headers: { "Cache-Control": "no-store" } },
    );
  console.error(
    JSON.stringify({ task: "query", error: "database-unavailable" }),
  );
  return Response.json(
    { error: "服务端数据暂未就绪" },
    { status: 503, headers: { "Cache-Control": "no-store" } },
  );
}

export function serverJson(value: unknown) {
  return Response.json(value, {
    headers: {
      "Cache-Control": "public, s-maxage=15, stale-while-revalidate=15",
    },
  });
}
