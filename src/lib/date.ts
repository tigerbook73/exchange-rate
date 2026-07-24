// Source publish-time strings (e.g. "07-24 10:30") have no year and no
// timezone; both must be resolved against Beijing time (Asia/Shanghai),
// never the server's local timezone.
const SOURCE_TIME_ZONE = "Asia/Shanghai";
const PUBLISHED_AT_PATTERN = /^(\d{2})-(\d{2})\s+(\d{2}):(\d{2})$/;

export interface ParsedPublishedAt {
  /** ISO date, e.g. "2026-07-24". */
  date: string;
  /** ISO 8601 datetime with a fixed +08:00 offset. */
  publishedAt: string;
}

function pad2(value: number): string {
  return String(value).padStart(2, "0");
}

function getBeijingYearMonth(now: Date): { year: number; month: number } {
  const formatter = new Intl.DateTimeFormat("en-US", {
    timeZone: SOURCE_TIME_ZONE,
    year: "numeric",
    month: "numeric",
  });
  const parts = formatter.formatToParts(now);
  const year = Number(parts.find((p) => p.type === "year")?.value);
  const month = Number(parts.find((p) => p.type === "month")?.value);
  return { year, month };
}

/**
 * Parses a source "MM-DD HH:mm" publish-time string into a full date and
 * ISO datetime, resolving the missing year against `now` (Beijing time)
 * and handling the December/January boundary explicitly.
 */
export function parsePublishedAt(
  raw: string,
  now: Date = new Date(),
): ParsedPublishedAt {
  const match = PUBLISHED_AT_PATTERN.exec(raw.trim());
  if (!match) {
    throw new Error(`Unrecognized publishedAt format: "${raw}"`);
  }
  const [, monthStr, dayStr, hourStr, minuteStr] = match;
  const month = Number(monthStr);
  const day = Number(dayStr);
  const hour = Number(hourStr);
  const minute = Number(minuteStr);

  const { year: currentYear, month: currentMonth } = getBeijingYearMonth(now);
  let year = currentYear;
  if (month === 12 && currentMonth === 1) {
    year = currentYear - 1;
  } else if (month === 1 && currentMonth === 12) {
    year = currentYear + 1;
  }

  const date = `${year}-${pad2(month)}-${pad2(day)}`;
  const publishedAt = `${date}T${pad2(hour)}:${pad2(minute)}:00+08:00`;
  return { date, publishedAt };
}

/**
 * "Today" as an ISO date in Beijing time, independent of the viewer's own
 * timezone — keeps date-range math consistent with how source dates are
 * interpreted everywhere else in the app.
 */
export function getBeijingDateString(now: Date = new Date()): string {
  const formatter = new Intl.DateTimeFormat("en-CA", {
    timeZone: SOURCE_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  });
  return formatter.format(now);
}

/** Adds `delta` calendar days (may be negative) to an ISO date string. */
export function addDays(date: string, delta: number): string {
  const [year, month, day] = date.split("-").map(Number);
  const utc = new Date(Date.UTC(year, month - 1, day));
  utc.setUTCDate(utc.getUTCDate() + delta);
  const y = utc.getUTCFullYear();
  const m = String(utc.getUTCMonth() + 1).padStart(2, "0");
  const d = String(utc.getUTCDate()).padStart(2, "0");
  return `${y}-${m}-${d}`;
}
