import { getBeijingDateString, isValidDate } from "@/lib/domain/date";
import { dayStart } from "@/lib/domain/intraday";
import { queryError, serverJson } from "@/lib/server/server-api";
import { readIntraday } from "@/lib/server/server-store";

export async function GET(request: Request, db: D1Database) {
  const now = Date.now();
  const today = getBeijingDateString(new Date(now));
  const date = new URL(request.url).searchParams.get("date") ?? today;
  if (!isValidDate(date))
    return Response.json({ error: "Invalid date" }, { status: 400 });
  try {
    const data = await readIntraday(db, date, now);
    if (!data.state.lastSuccess && !data.state.historyDate)
      return queryError(new Error("Not initialized"));
    if (date < data.retainedFrom || date > today)
      return Response.json(
        { error: "Date outside retention", retainedFrom: data.retainedFrom },
        { status: 410, headers: { "Cache-Control": "no-store" } },
      );
    const start = dayStart(date);
    const end = start + 86_400_000;
    return serverJson({
      date,
      points: data.points,
      live:
        data.state.live &&
        data.state.live.minute >= start &&
        data.state.live.minute < end
          ? data.state.live
          : null,
    });
  } catch (error) {
    return queryError(error);
  }
}
