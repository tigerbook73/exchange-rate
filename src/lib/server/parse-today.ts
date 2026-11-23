import { Parser } from "htmlparser2";

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
  let tableDepth = 0;
  let targetDepth = 0;
  let cells: string[] = [];
  let column = -1;
  let inCell = false;
  let match: string[] | null = null;
  // Tokenize only: building a DOM for the entire 100KB+ source page dominated
  // minute collection CPU. Stop once the first AUD row has been read.
  const parser = new Parser(
    {
      onopentag(name, attributes) {
        if (name === "table") {
          tableDepth++;
          if (targetDepth) throw new Error("Unexpected nested source table");
          if (attributes.id === "bank_rate_table") targetDepth = tableDepth;
        }
        if (!targetDepth || tableDepth !== targetDepth) return;
        if (name === "tr") {
          cells = [];
          column = -1;
          inCell = false;
        }
        if (name === "td") {
          column++;
          cells[column] = "";
          inCell = true;
        }
      },
      ontext(text) {
        if (targetDepth && inCell && column < 6) cells[column] += text;
      },
      onclosetag(name) {
        if (name === "table") {
          if (tableDepth === targetDepth) targetDepth = 0;
          tableDepth--;
          return;
        }
        if (!targetDepth || tableDepth !== targetDepth) return;
        if (name === "td") inCell = false;
        if (name === "tr" && cells[0]?.trim() === TARGET_CURRENCY_NAME) {
          match = cells;
          parser.pause();
        }
      },
    },
    { decodeEntities: true },
  );
  parser.end(html);
  if (!match) {
    throw new Error(
      `Could not find a row for "${TARGET_CURRENCY_NAME}" in b-icbc.html`,
    );
  }

  const huiSellText = String(match[3] ?? "").trim();
  const publishedAtRaw = String(match[5] ?? "").trim();
  const huiSell = Number(huiSellText);

  if (
    !/^\d+(?:\.\d{1,4})?$/.test(huiSellText) ||
    !Number.isFinite(huiSell) ||
    huiSell <= 0
  ) {
    throw new Error(`Unrecognized huiSell value: "${huiSellText}"`);
  }

  return { huiSell, publishedAtRaw };
}
