import { queryError, queryServer, serverJson } from "@/lib/server/server-api";

export async function GET(_request: Request, db: D1Database) {
  try {
    const data = await queryServer(db);
    const quote = data.state.lastSuccess;
    if (!quote) return queryError(new Error("No quote"));
    return serverJson({
      bank: "icbc",
      currency: "aud",
      date: quote.date,
      publishedAt: quote.publishedAt,
      huiSell: quote.priceUnits / 10000,
    });
  } catch (error) {
    return queryError(error);
  }
}
