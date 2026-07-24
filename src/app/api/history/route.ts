import { NextResponse, type NextRequest } from "next/server";
import { HISTORY_REVALIDATE_SECONDS } from "@/lib/api-cache";
import type { HistoryResponse } from "@/lib/api-types";
import { addDays, getBeijingDateString } from "@/lib/date";
import { parseHistoryHtml } from "@/lib/parse-history";
import { fetchSourceHtml, HISTORY_SOURCE_URL } from "@/lib/sources";

// See /api/today for why this is needed on top of the Cache-Control header,
// and why it must be a literal kept equal to HISTORY_REVALIDATE_SECONDS by
// hand. Longer than /api/today's window: everything but today's row in this
// response is immutable once published.
export const revalidate = 3600;

const DATEFROM_PATTERN = /^\d{4}-\d{2}-\d{2}$/;
const DEFAULT_LOOKBACK_DAYS = 365;

// Callers (see rates-sync.ts) pass the day after the newest date they
// already have locally, so repeat visits only request the gap since last
// sync. No local data (first visit) means no `datefrom`, and we fall back to
// a full year — the source has no built-in "everything" option.
function resolveDatefrom(request: NextRequest): string {
  const raw = request.nextUrl.searchParams.get("datefrom");
  if (raw && DATEFROM_PATTERN.test(raw)) {
    return raw;
  }
  return addDays(getBeijingDateString(), -DEFAULT_LOOKBACK_DAYS);
}

export async function GET(request: NextRequest) {
  try {
    const datefrom = resolveDatefrom(request);
    const url = `${HISTORY_SOURCE_URL}?datefrom=${datefrom}`;
    const html = await fetchSourceHtml(url);
    const series = parseHistoryHtml(html);

    const body: HistoryResponse = {
      currency: "aud",
      bank: "icbc",
      field: "huiSell",
      series,
    };
    return NextResponse.json(body, {
      headers: {
        "Cache-Control": `s-maxage=${HISTORY_REVALIDATE_SECONDS}, stale-while-revalidate`,
      },
    });
  } catch (error) {
    console.error("[/api/history] failed:", error);
    return NextResponse.json(
      { error: "Failed to fetch rate history" },
      { status: 502 },
    );
  }
}
