import * as cheerio from "cheerio";

export interface HistoryPoint {
  /** ISO date, e.g. "2026-07-24" — the source already includes the year here. */
  date: string;
  huiSell: number;
}

/**
 * Parses `d-icbc-aud.html`. The page has two `table.bank_huilv_table`
 * elements: a summary table (涨跌/最高/最低/平均, not needed) and the daily
 * data table, which additionally carries `.text-nowrap`. Rows are selected
 * by "has a <td>" rather than relying on a <tbody>, since the source HTML
 * doesn't wrap data rows in one.
 */
export function parseHistoryHtml(html: string): HistoryPoint[] {
  const $ = cheerio.load(html);
  const rows = $("table.bank_huilv_table.text-nowrap tr").filter(
    (_, el) => $(el).find("td").length >= 2,
  );

  const points: HistoryPoint[] = [];
  rows.each((_, el) => {
    const cells = $(el).find("td");
    const date = cells.eq(0).text().trim();
    const huiSellText = cells.eq(1).find(".td_rate").first().text().trim();
    const huiSell = Number(huiSellText);

    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || !Number.isFinite(huiSell)) {
      return;
    }
    points.push({ date, huiSell });
  });

  return points;
}
