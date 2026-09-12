# Task.md — MVP Build Tasks

Reference: [products.md](./products.md). This is the build checklist to get a demoable MVP.

## Locked-in Technical Decisions

| Area | Decision |
|---|---|
| Runtime | TypeScript / Node, official MCP TypeScript SDK |
| LLM | Gemini — but routed through a single model-config module, not hardcoded per call site, so the model can be swapped in one place |
| Image/text embeddings | Gemini Embedding API |
| Vector index | sqlite-vec (stores embeddings, does similarity search) |
| Catalog + session storage | In-memory / JSON file — no general-purpose DB (sqlite-vec is the one exception, used only for the vector index) |
| Image input transport | Not asked yet — defaulting to base64 data URI inline in the tool call, since there's no object storage in this stack. Flag if you want URL references instead. |

## Phase 0 — Project Setup

- [x] Scaffold Node/TS project (`npm init`, `tsconfig.json`, ESM or CJS decision)
- [x] Install official MCP TypeScript SDK, wire up a minimal server that registers one no-op tool and responds to a local MCP client call
- [x] Install sqlite-vec + a Node SQLite binding (e.g. `better-sqlite3`) and confirm a basic vector insert/query round-trip works
- [x] Add `.env` handling for `GEMINI_API_KEY`; confirm a raw Gemini API call succeeds (text + embeddings) — *env plumbing done; no `GEMINI_API_KEY` is configured in this environment yet, so the live call itself is still unverified. Add one to `.env` (see `.env.example`) to close this out.*
- [x] Create `src/config/model.ts` (or similar) — single source of truth for which Gemini model ID is used for (a) text/reasoning calls and (b) embedding calls. Every other module imports from here, never hardcodes a model string.

## Phase 1 — Mock Catalog Data
Mock data is available in data/ folder
- [x] Define per-category attribute schemas (clothing, electronics, home goods, skincare) as TS types/interfaces — *deviation: the 4 real datasets (H&M + Amazon 2023) are not uniform, so instead of per-category attribute interfaces we normalized everything into one common `Product` shape (`src/types/catalog.ts`) with category-specific raw fields kept in `attributes: Record<string, unknown>` and a pre-flattened `embeddingText`. See `src/catalog/loader.ts`.*
- [x] Write an interface that access data and search similarity from SQLite-vec — `src/catalog/repository.ts` + `src/embedding/vectorStore.ts`

## Phase 2 — Embedding Pipeline

- [x] Write embedding-generation function: given text and/or image, call Gemini Embedding API, return vector — `src/embedding/gemini.ts` (image path captions via vision model first, since `embedContent` is text-only)
- [x] Build script that embeds every catalog product (image + attribute text) and writes vectors into sqlite-vec. We will run it manually once we collect enough data — `src/scripts/build-embeddings.ts` (unrun — needs `GEMINI_API_KEY`)
- [x] Write a similarity-search function: given a query embedding, return top-N nearest catalog products from sqlite-vec — `src/embedding/vectorStore.ts::querySimilar` + `src/catalog/repository.ts::similaritySearch`

## Phase 3 — Intent Decoding & Attribute Extraction

- [x] Write a generic (category-agnostic) extraction prompt/function: given free text + optional image, and a category's attribute schema, return structured attributes via Gemini (mandatory vs. preferred fields distinguished) — `src/extraction/intent.ts`
- [x] Write clarification-detection logic: given extracted attributes, decide if a required/high-impact attribute is missing or ambiguous → return a `needs_clarification` payload with a specific question instead of proceeding — folded into `extractIntent`'s prompt + `ExtractionResult` union
- [x] Write the session store: in-memory map keyed by `session_id`, holding original query, attributes extracted so far, and clarification history; add a simple TTL/cleanup so it doesn't grow unbounded during the demo — `src/session/store.ts` (30 min TTL)

## Phase 4 — Ranking & Justification Engine

- [x] Write scoring function: given decoded criteria (mandatory + preferred) and a candidate product, produce a match/fail per criterion — `src/ranking/evaluate.ts` (deterministic heuristic, no LLM — satisfied/violated/unknown)
- [x] Write ranking logic: eligible products (all mandatory criteria met) ranked by preference match + embedding similarity; ineligible-but-close products retained separately — `src/ranking/rank.ts`
- [x] Write justification-text generation: short human-readable reason per returned product, referencing which criteria it satisfied — `src/ranking/justify.ts` (deterministic template + optional LLM enhancement with safe fallback)
- [x] Assemble the shared response shape used by all search tools: `status`, `ranked_results[]` (with justification), `secondary_results[]` (with the failed criterion) — `src/mcp/searchPipeline.ts` + `src/mcp/tools/shared.ts`

## Phase 5 — Bundling Engine (Mocked)

- [x] Define a static "goes-with" category/attribute map (e.g. facewash → toner + moisturiser; shirt → pants/belt) — `src/bundling/engine.ts`, using each dataset's real taxonomy fields
- [x] Write bundle-suggestion function: given an anchor product, return 1-2 complementary products + a flat mocked discount — `src/bundling/engine.ts::getBundleSuggestions`

## Phase 6 — MCP Tools

- [x] `search_exact_product` — wires extraction → clarification check → embedding search → ranking/justification (`src/mcp/tools/searchExactProduct.ts`)
- [x] `find_matching_product` — same pipeline, seeded from a reference image + stated needs (`src/mcp/tools/findMatchingProduct.ts`)
- [x] `find_complementary_product` — candidate pool from the bundling engine's "goes-with" groups, then ranked by stated preferences (`src/mcp/tools/findComplementaryProduct.ts`)
- [x] `get_bundle_suggestions` — wraps the bundling engine (`src/mcp/tools/getBundleSuggestions.ts`) — **verified end-to-end via real MCP client call, no LLM needed**
- [x] `answer_clarification` — takes `session_id` + answer, merges into stored attributes, re-runs the originating tool's pipeline (`src/mcp/tools/answerClarification.ts`)
- [x] `initiate_checkout` — takes `session_id` + selected product ids, returns a mocked order confirmation with bundle-discount detection (`src/mcp/tools/initiateCheckout.ts`) — arithmetic + discount detection verified against real catalog data; error paths (unknown session/product) verified via real MCP client calls

## Phase 7 — Demo Prep

- [x] Write a small MCP test client (or reuse an existing agent harness) that can call each of the 6 tools against the running server — `src/scripts/test-client.ts`, already used above for `ping`, `get_bundle_suggestions`, error-path checks
- [ ] Script 4-5 concrete demo queries covering: exact search, image-based tailoring, complementary search, bundling upsell, a clarification round-trip, and checkout — one per category where possible — **blocked on a real `GEMINI_API_KEY`** (see note below)
- [ ] Rehearse the "decode → analyze → justify → bundle → checkout" flow end-to-end at least once, timed — **blocked on a real `GEMINI_API_KEY`**
- [ ] Note any known gaps/limitations to mention proactively during the pitch (mocked checkout, in-memory storage, 4-category scope, clothing images unavailable without Kaggle credentials)

**Blocker:** every tool except `get_bundle_suggestions` and the error paths of `initiate_checkout`/`find_complementary_product` needs a live `GEMINI_API_KEY` (intent extraction + embeddings both call Gemini) — add one to `.env` (copy `.env.example`) to unblock `build-embeddings.ts` and the remaining Phase 7 items.

## Explicitly Deferred (do not build for MVP)

- Real AI-to-AI negotiation/haggling protocol
- Real payment/inventory integration
- Any human-facing UI polish beyond what's needed to demo
