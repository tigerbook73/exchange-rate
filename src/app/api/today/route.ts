import { NextResponse } from "next/server";
import type { TodayResponse } from "@/lib/api-types";
import { parsePublishedAt } from "@/lib/date";
import { parseTodayHtml } from "@/lib/parse-today";
import { fetchSourceHtml, TODAY_SOURCE_URL } from "@/lib/sources";

// Vercel's CDN caches Route Handlers based on this ISR-style config, not the
// manually-set Cache-Control header below (that header is what's actually
// respected under self-hosting / other platforms, so we keep both).
export const revalidate = 300;

export async function GET() {
  try {
    const html = await fetchSourceHtml(TODAY_SOURCE_URL);
    const { huiSell, publishedAtRaw } = parseTodayHtml(html);
    const { date, publishedAt } = parsePublishedAt(publishedAtRaw);

    const body: TodayResponse = {
      bank: "icbc",
      currency: "aud",
      date,
      publishedAt,
      huiSell,
    };
    return NextResponse.json(body, {
      headers: { "Cache-Control": "s-maxage=300, stale-while-revalidate" },
    });
  } catch (error) {
    console.error("[/api/today] failed:", error);
    return NextResponse.json(
      { error: "Failed to fetch today's rate" },
      { status: 502 },
    );
  }
}
