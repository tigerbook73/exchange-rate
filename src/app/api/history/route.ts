import { isValidDate } from "@/lib/date";
import { queryError, queryServer, serverJson } from "@/lib/server-api";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const datefrom = new URL(request.url).searchParams.get("datefrom");
  if (datefrom && !isValidDate(datefrom))
    return Response.json({ error: "Invalid datefrom" }, { status: 400 });
  try {
    const data = await queryServer();
    if (!data.state.lastSuccess && !data.state.historyDate)
      return queryError(new Error("Not initialized"));
    return serverJson({
      bank: "icbc",
      currency: "aud",
      field: "huiSell",
      series: data.daily
        .filter(
          (p) =>
            p.source !== "carried-forward" && (!datefrom || p.date >= datefrom),
        )
        .map((p) => ({ date: p.date, huiSell: p.huiSell })),
    });
  } catch (error) {
    return queryError(error);
  }
}
