import { queryError, queryServer, serverJson } from "@/lib/server-api";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const data = await queryServer();
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
