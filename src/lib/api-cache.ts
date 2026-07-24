// Shared by /api/today and /api/history: the `revalidate` route segment
// config (used by Vercel's CDN) and the Cache-Control header (used
// everywhere else) must stay in sync, so both read this one constant.
export const REVALIDATE_SECONDS = 300;
