// The `revalidate` route segment config (used by Vercel's CDN) and the
// Cache-Control header (used everywhere else) must stay in sync for each
// route, so both read these constants.
//
// History and today are split: history's non-today rows never change once
// published, so its window can be much longer; today's row is the one thing
// users expect to see update promptly, so it keeps a short window.
export const HISTORY_REVALIDATE_SECONDS = 3600;
export const TODAY_REVALIDATE_SECONDS = 300;

// How far back /api/history looks when the caller doesn't (or can't yet)
// request an incremental `datefrom`. Shared with the client (see
// use-rate-data.ts) so it can tell whether local history already reaches
// this far back, or still needs a one-time backfill request.
export const HISTORY_LOOKBACK_DAYS = 365;
