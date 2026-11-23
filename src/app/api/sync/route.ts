import { queryError, queryServer, serverJson } from "@/lib/server/server-api";
import { SYNC_SCHEMA } from "@/lib/contracts/server-types";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const params = new URL(request.url).searchParams;
  const clientSchema = params.get("schema");
  if (clientSchema !== null && clientSchema !== String(SYNC_SCHEMA))
    return Response.json(
      {
        error: "client_upgrade_required",
        schema: SYNC_SCHEMA,
        resetClientCache: true,
      },
      { status: 426, headers: { "Cache-Control": "no-store" } },
    );
  try {
    const data = await queryServer(params.get("cursor"));
    if (!data.state.lastSuccess && !data.state.historyDate)
      return queryError(new Error("Not initialized"));
    return serverJson(data);
  } catch (error) {
    return queryError(error);
  }
}
