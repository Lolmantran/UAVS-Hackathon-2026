// Single source of truth for which Gemini models the server uses.
// Every other module must import from here instead of hardcoding a model string,
// so swapping models is a one-line change.

export const MODEL_CONFIG = {
  // Text reasoning: intent decoding, attribute extraction, justification, clarification questions.
  text: "gemini-2.5-flash",
  // Embeddings: catalog indexing + query-time similarity search.
  embedding: "gemini-embedding-001",
} as const;

export type ModelConfig = typeof MODEL_CONFIG;
