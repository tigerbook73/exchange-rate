export const TODAY_SOURCE_URL = "https://www.kylc.com/bank/rmbfx/b-icbc.html";
export const HISTORY_SOURCE_URL = "https://www.kylc.com/huilv/d-icbc-aud.html";

// A realistic desktop browser UA, so the source doesn't flag us as an
// obviously scripted client.
export const SOURCE_USER_AGENT =
  "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const FETCH_TIMEOUT_MS = 8000;
const MAX_SOURCE_BYTES = 1024 * 1024;

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
    if (!response.body) throw new Error("Source returned no body");
    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let size = 0;
    let html = "";
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        size += value.byteLength;
        if (size > MAX_SOURCE_BYTES) {
          await reader.cancel();
          throw new Error("Source response exceeded size limit");
        }
        html += decoder.decode(value, { stream: true });
      }
      return html + decoder.decode();
    } finally {
      reader.releaseLock();
    }
  } finally {
    clearTimeout(timeout);
  }
}
