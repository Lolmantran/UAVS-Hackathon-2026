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

- [ ] Scaffold Node/TS project (`npm init`, `tsconfig.json`, ESM or CJS decision)
- [ ] Install official MCP TypeScript SDK, wire up a minimal server that registers one no-op tool and responds to a local MCP client call
- [ ] Install sqlite-vec + a Node SQLite binding (e.g. `better-sqlite3`) and confirm a basic vector insert/query round-trip works
- [ ] Add `.env` handling for `GEMINI_API_KEY`; confirm a raw Gemini API call succeeds (text + embeddings)
- [ ] Create `src/config/model.ts` (or similar) — single source of truth for which Gemini model ID is used for (a) text/reasoning calls and (b) embedding calls. Every other module imports from here, never hardcodes a model string.

## Phase 1 — Mock Catalog Data
Mock data is available in data/ folder
- [ ] Define per-category attribute schemas (clothing, electronics, home goods, skincare) as TS types/interfaces
- [ ] Write an interface that access data and search similarity from SQLite-vec

## Phase 2 — Embedding Pipeline

- [ ] Write embedding-generation function: given text and/or image, call Gemini Embedding API, return vector
- [ ] Build script that embeds every catalog product (image + attribute text) and writes vectors into sqlite-vec. We will run it manually once we collect enough data
- [ ] Write a similarity-search function: given a query embedding, return top-N nearest catalog products from sqlite-vec

## Phase 3 — Intent Decoding & Attribute Extraction

- [ ] Write a generic (category-agnostic) extraction prompt/function: given free text + optional image, and a category's attribute schema, return structured attributes via Gemini (mandatory vs. preferred fields distinguished)
- [ ] Write clarification-detection logic: given extracted attributes, decide if a required/high-impact attribute is missing or ambiguous → return a `needs_clarification` payload with a specific question instead of proceeding
- [ ] Write the session store: in-memory map keyed by `session_id`, holding original query, attributes extracted so far, and clarification history; add a simple TTL/cleanup so it doesn't grow unbounded during the demo

## Phase 4 — Ranking & Justification Engine

- [ ] Write scoring function: given decoded criteria (mandatory + preferred) and a candidate product, produce a match/fail per criterion
- [ ] Write ranking logic: eligible products (all mandatory criteria met) ranked by preference match + embedding similarity; ineligible-but-close products retained separately
- [ ] Write justification-text generation: short human-readable reason per returned product, referencing which criteria it satisfied
- [ ] Assemble the shared response shape used by all search tools: `status`, `ranked_results[]` (with justification), `secondary_results[]` (with the failed criterion)

## Phase 5 — Bundling Engine (Mocked)

- [ ] Define a static "goes-with" category/attribute map (e.g. facewash → toner + moisturiser; shirt → pants/belt)
- [ ] Write bundle-suggestion function: given an anchor product, return 1-2 complementary products + a flat mocked discount

## Phase 6 — MCP Tools

- [ ] `search_exact_product` — wires extraction → clarification check → embedding search → ranking/justification
- [ ] `find_matching_product` — same pipeline, seeded from a reference image + stated needs
- [ ] `find_complementary_product` — same pipeline, seeded from an anchor product's attributes instead of free text
- [ ] `get_bundle_suggestions` — wraps the bundling engine
- [ ] `answer_clarification` — takes `session_id` + answer, merges into stored attributes, re-runs the originating tool's pipeline
- [ ] `initiate_checkout` — takes `session_id` + selected product ids, returns a mocked order confirmation (status, fake order id, total incl. bundle discount if applicable)

## Phase 7 — Demo Prep

- [ ] Write a small MCP test client (or reuse an existing agent harness) that can call each of the 6 tools against the running server
- [ ] Script 4-5 concrete demo queries covering: exact search, image-based tailoring, complementary search, bundling upsell, a clarification round-trip, and checkout — one per category where possible
- [ ] Rehearse the "decode → analyze → justify → bundle → checkout" flow end-to-end at least once, timed
- [ ] Note any known gaps/limitations to mention proactively during the pitch (mocked checkout, in-memory storage, 4-category scope)

## Explicitly Deferred (do not build for MVP)

- Real AI-to-AI negotiation/haggling protocol
- Real payment/inventory integration
- Any human-facing UI polish beyond what's needed to demo
