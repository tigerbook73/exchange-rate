import { getBeijingDateString, isValidDate } from "@/lib/domain/date";
import { queryError, queryServer, serverJson } from "@/lib/server/server-api";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const date =
    new URL(request.url).searchParams.get("date") ?? getBeijingDateString();
  if (!isValidDate(date))
    return Response.json({ error: "Invalid date" }, { status: 400 });
  try {
    const data = await queryServer();
    if (!data.state.lastSuccess && !data.state.historyDate)
      return queryError(new Error("Not initialized"));
    if (date < data.retainedFrom || date > getBeijingDateString())
      return Response.json(
        { error: "Date outside retention", retainedFrom: data.retainedFrom },
        { status: 410, headers: { "Cache-Control": "no-store" } },
      );
    return serverJson({
      date,
      points: data.points.filter(
        (p) => getBeijingDateString(new Date(p.minute)) === date,
      ),
      live:
        data.state.live &&
        getBeijingDateString(new Date(data.state.live.minute)) === date
          ? data.state.live
          : null,
    });
  } catch (error) {
    return queryError(error);
  }
}
