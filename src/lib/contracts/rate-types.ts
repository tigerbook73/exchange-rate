export type RateSource = "today" | "history" | "carried-forward";

export interface RateRecord {
  /** ISO date, e.g. "2026-07-24". Primary key. */
  date: string;
  huiSell: number;
  /** Only present for source: "today" records. */
  publishedAt: string | null;
  source: RateSource;
  /** Only present for source: "carried-forward" records; points at the real record's date. */
  carriedFromDate: string | null;
}
