import { NextResponse } from "next/server";
import type { HistoryResponse } from "@/lib/api-types";
import { parseHistoryHtml } from "@/lib/parse-history";
import { fetchSourceHtml, HISTORY_SOURCE_URL } from "@/lib/sources";

// See /api/today for why this is needed on top of the Cache-Control header.
export const revalidate = 300;

export async function GET() {
  try {
    const html = await fetchSourceHtml(HISTORY_SOURCE_URL);
    const series = parseHistoryHtml(html);

    const body: HistoryResponse = {
      currency: "aud",
      bank: "icbc",
      field: "huiSell",
      series,
    };
    return NextResponse.json(body, {
      headers: { "Cache-Control": "s-maxage=300, stale-while-revalidate" },
    });
  } catch (error) {
    console.error("[/api/history] failed:", error);
    return NextResponse.json(
      { error: "Failed to fetch rate history" },
      { status: 502 },
    );
  }
}
