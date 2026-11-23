import { GET as sync } from "../src/lib/server/api/sync";
import { GET as today } from "../src/lib/server/api/today";
import { GET as history } from "../src/lib/server/api/history";
import { GET as intraday } from "../src/lib/server/api/intraday";

const routes: Record<
  string,
  (request: Request, db: D1Database) => Promise<Response>
> = {
  "/api/sync": sync,
  "/api/today": today,
  "/api/history": history,
  "/api/intraday": intraday,
};

export async function handleApi(
  request: Request,
  db: D1Database,
): Promise<Response> {
  const path = new URL(request.url).pathname;
  const handler = Object.hasOwn(routes, path) ? routes[path] : undefined;
  if (!handler)
    return Response.json(
      { error: "Not found" },
      { status: 404, headers: { "Cache-Control": "no-store" } },
    );
  if (request.method !== "GET")
    return Response.json(
      { error: "Method not allowed" },
      { status: 405, headers: { Allow: "GET", "Cache-Control": "no-store" } },
    );
  return handler(request, db);
}

export default {
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (path === "/api" || path.startsWith("/api/"))
      return handleApi(request, env.DB);
    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<CloudflareEnv>;
