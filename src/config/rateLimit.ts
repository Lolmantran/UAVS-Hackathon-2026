// Gemini's free tier caps generateContent (text + vision) at 15 requests/min per model,
// shared across every call site (intent extraction, image captioning, justification).
// This gate serializes those calls with a fixed minimum spacing so callers get a slow-but-
// reliable response instead of a 429 — cheaper than per-call retry/backoff logic everywhere.
const MIN_INTERVAL_MS = 4300;

let nextAvailable = 0;
let nextEmbeddingAvailable = 0;

export async function throttleGenerateContent(): Promise<void> {
  const now = Date.now();
  const wait = Math.max(0, nextAvailable - now);
  nextAvailable = Math.max(now, nextAvailable) + MIN_INTERVAL_MS;
  if (wait > 0) {
    await new Promise((resolve) => setTimeout(resolve, wait));
  }
}

// Keep embedding calls at the same conservative pace as generation calls. The demo catalog is
// deliberately small, so a sequential ~14 RPM rebuild is preferable to risking free-tier limits.
export async function throttleEmbedding(): Promise<void> {
  const now = Date.now();
  const wait = Math.max(0, nextEmbeddingAvailable - now);
  nextEmbeddingAvailable = Math.max(now, nextEmbeddingAvailable) + MIN_INTERVAL_MS;
  if (wait > 0) {
    await new Promise((resolve) => setTimeout(resolve, wait));
  }
}
