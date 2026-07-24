export const TODAY_SOURCE_URL = "https://www.kylc.com/bank/rmbfx/b-icbc.html";
export const HISTORY_SOURCE_URL = "https://www.kylc.com/huilv/d-icbc-aud.html";

// A realistic desktop browser UA, so the source doesn't flag us as an
// obviously scripted client.
export const SOURCE_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const FETCH_TIMEOUT_MS = 8000;

export async function fetchSourceHtml(url: string): Promise<string> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const response = await fetch(url, {
      headers: { "User-Agent": SOURCE_USER_AGENT },
      signal: controller.signal,
    });
    if (!response.ok) {
      throw new Error(`Source responded with ${response.status}: ${url}`);
    }
    return await response.text();
  } finally {
    clearTimeout(timeout);
  }
}
