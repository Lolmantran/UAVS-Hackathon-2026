// Single source of truth for which Gemini models the server uses.
// Every other module must import from here instead of hardcoding a model string,
// so swapping models is a one-line change.

export const MODEL_CONFIG = {
  // Text reasoning: intent decoding, attribute extraction, justification, clarification questions.
  // gemini-2.5-flash was retired for new API keys. gemini-3.6-flash (the replacement Gemini's own
  // 404 pointed at) has a free-tier cap of just 20 requests/day — far too low to demo against.
  // Flash-Lite variants carry a much higher free-tier daily cap for the same multimodal
  // capabilities (vision + structured JSON output), so we use one here instead.
  text: "gemini-3.5-flash-lite",
  // Embeddings: catalog indexing + query-time similarity search.
  embedding: "gemini-embedding-2",
} as const;

export type ModelConfig = typeof MODEL_CONFIG;
