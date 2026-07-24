import * as cheerio from "cheerio";

const TARGET_CURRENCY_NAME = "澳大利亚元";

export interface TodayRateRaw {
  huiSell: number;
  /** Raw "MM-DD HH:mm" string from the source, year/timezone not yet resolved. */
  publishedAtRaw: string;
}

/**
 * Parses `b-icbc.html` and extracts the 现汇卖出 (huiSell) rate and raw
 * publish time for 澳大利亚元 (AUD). Column order in the source table:
 * 币种, 现汇买入, 现钞买入, 现汇卖出, 现钞卖出, 发布时间, ...
 */
export function parseTodayHtml(html: string): TodayRateRaw {
  const $ = cheerio.load(html);
  const row = $("table#bank_rate_table tbody tr")
    .filter(
      (_, el) => $(el).find("td").eq(0).text().trim() === TARGET_CURRENCY_NAME,
    )
    .first();

  if (row.length === 0) {
    throw new Error(
      `Could not find a row for "${TARGET_CURRENCY_NAME}" in b-icbc.html`,
    );
  }

  const cells = row.find("td");
  const huiSellText = cells.eq(3).text().trim();
  const publishedAtRaw = cells.eq(5).text().trim();
  const huiSell = Number(huiSellText);

  if (!Number.isFinite(huiSell)) {
    throw new Error(`Unrecognized huiSell value: "${huiSellText}"`);
  }

  return { huiSell, publishedAtRaw };
}
