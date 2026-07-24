import { NextResponse } from "next/server";
import { parseHistoryHtml } from "@/lib/parse-history";
import { fetchSourceHtml, HISTORY_SOURCE_URL } from "@/lib/sources";

export async function GET() {
  try {
    const html = await fetchSourceHtml(HISTORY_SOURCE_URL);
    const series = parseHistoryHtml(html);

    return NextResponse.json(
      { currency: "aud", bank: "icbc", field: "huiSell", series },
      { headers: { "Cache-Control": "s-maxage=300, stale-while-revalidate" } },
    );
  } catch (error) {
    console.error("[/api/history] failed:", error);
    return NextResponse.json(
      { error: "Failed to fetch rate history" },
      { status: 502 },
    );
  }
}
