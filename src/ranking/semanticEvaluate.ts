// Fallback for criteria the deterministic keyword evaluator (evaluate.ts) couldn't resolve.
// Substring matching can't know "red" satisfies "bright color", or that a hoodie isn't formal
// wear — it has no world knowledge, only literal token overlap. This asks the model instead,
// batched into ONE call per search (grouped by product) rather than one call per (product,
// criterion) pair, to stay inside Gemini free-tier rate limits (see config/rateLimit.ts).
import { GoogleGenAI, Type, type Schema } from "@google/genai";
import { env } from "../config/env.js";
import { MODEL_CONFIG } from "../config/model.js";
import { throttleGenerateContent } from "../config/rateLimit.js";
import type { Criterion, CriterionOutcome } from "../types/pipeline.js";
import type { Product } from "../types/catalog.js";
import { buildCorpus } from "./evaluate.js";

let client: GoogleGenAI | undefined;

function getClient(): GoogleGenAI {
  if (!client) {
    client = new GoogleGenAI({ apiKey: env.geminiApiKey() });
  }
  return client;
}

export interface PendingEvaluation {
  product: Product;
  criterion: Criterion;
}

export interface SemanticResult {
  outcome: CriterionOutcome;
  evidence: string;
}

const SYSTEM_INSTRUCTION = `You are the semantic fallback stage of an e-commerce criteria evaluator.
A cheap keyword matcher already ran and couldn't resolve some (product, criterion) pairs — usually
because the match requires common-sense/world knowledge rather than literal word overlap (e.g. "red"
satisfies "bright color"; "hoodie" does not satisfy "formal dress shirt"; "chelsea boot" satisfies
"boot" but not "lace-up closure").

For each listed criterion per product, decide:
- "satisfied": the product's data supports this criterion, even if via inference a human shopper
  would confidently make (color families, common synonyms, category/type relationships).
- "violated": the product's data contradicts this criterion.
- "unknown": the product's data is genuinely silent on this and no confident inference is possible —
  do not guess or fabricate facts not implied by the given text.

Output ONLY a JSON array (no markdown, no commentary) matching exactly this shape:
[
  {
    "productId": string,
    "results": [
      { "attribute": string, "outcome": "satisfied" | "violated" | "unknown", "evidence": string }
    ]
  }
]
"results" must include exactly one entry per criterion listed for that product, using the same
"attribute" key it was given. "evidence" is a short (<20 word) note on what in the product text
supports the outcome, or why it's genuinely unknown.`;

const RESPONSE_SCHEMA: Schema = {
  type: Type.ARRAY,
  items: {
    type: Type.OBJECT,
    properties: {
      productId: { type: Type.STRING },
      results: {
        type: Type.ARRAY,
        items: {
          type: Type.OBJECT,
          properties: {
            attribute: { type: Type.STRING },
            outcome: { type: Type.STRING, format: "enum", enum: ["satisfied", "violated", "unknown"] },
            evidence: { type: Type.STRING },
          },
          required: ["attribute", "outcome", "evidence"],
        },
      },
    },
    required: ["productId", "results"],
  },
};

// Was 500: a live case ("Ladieswear" sitting at index 502 of a 736-char corpus) proved this cap
// silently drops classification fields that genuinely exist on the product, past the noise-field
// exclusion in evaluate.ts's buildCorpus. Raised for real headroom, not just past that one case.
const MAX_CORPUS_CHARS = 1200;

// Cramming every pending (product, criterion) pair from a whole search into one call measurably
// degrades answer quality: verified by isolating a single failing pair (2 criteria, 1 product) and
// getting the correct "satisfied" outcome from the model both times, then re-running the exact
// same pair inside a real 29-product/56-pair batch and getting "unknown" back for it instead. This
// caps how many products' worth of criteria go into one call; larger pools are chunked into several
// smaller sequential calls instead of one big one. Costs a few extra throttled calls (~4.3s apart,
// see rateLimit.ts) on a big pool, but a slower correct answer beats a fast wrong one here.
const MAX_PRODUCTS_PER_BATCH = 8;

function chunk<T>(items: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

// One batch call over at most MAX_PRODUCTS_PER_BATCH products. Fails soft on any error (network,
// empty response, malformed JSON) so one bad chunk doesn't cost the other chunks' results too —
// callers just keep the deterministic "unknown" outcome for whatever this chunk couldn't resolve.
async function resolveBatch(
  entries: Array<{ product: Product; criteria: Criterion[] }>,
): Promise<Map<string, SemanticResult>> {
  const results = new Map<string, SemanticResult>();

  const blocks = entries.map(({ product, criteria }) => {
    const corpus = buildCorpus(product).slice(0, MAX_CORPUS_CHARS);
    const criteriaLines = criteria
      .map((c) => `  - attribute="${c.attribute}": ${c.description} (source phrase: "${c.rawPhrase}")`)
      .join("\n");
    return `Product ${product.id}: "${product.title}"\nProduct text: ${corpus}\nCriteria:\n${criteriaLines}`;
  });

  await throttleGenerateContent();
  let text: string | undefined;
  try {
    const response = await getClient().models.generateContent({
      model: MODEL_CONFIG.text,
      contents: [{ role: "user", parts: [{ text: blocks.join("\n\n") }] }],
      config: {
        systemInstruction: SYSTEM_INSTRUCTION,
        responseMimeType: "application/json",
        responseSchema: RESPONSE_SCHEMA,
      },
    });
    text = response.text;
  } catch {
    return results; // Fail soft: callers keep the deterministic "unknown" outcome.
  }
  if (!text) return results;

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return results;
  }

  if (!Array.isArray(parsed)) return results;
  for (const entry of parsed) {
    if (!entry || typeof entry !== "object") continue;
    const { productId, results: productResults } = entry as { productId?: unknown; results?: unknown };
    if (typeof productId !== "string" || !Array.isArray(productResults)) continue;
    for (const r of productResults) {
      if (!r || typeof r !== "object") continue;
      const { attribute, outcome, evidence } = r as Record<string, unknown>;
      if (typeof attribute !== "string" || typeof outcome !== "string" || typeof evidence !== "string") continue;
      if (outcome !== "satisfied" && outcome !== "violated" && outcome !== "unknown") continue;
      results.set(`${productId}::${attribute}`, { outcome, evidence });
    }
  }

  return results;
}

// Keyed "<productId>::<attribute>" so callers can look up a specific pending pair's result.
export async function resolveSemanticUnknowns(
  pending: PendingEvaluation[],
): Promise<Map<string, SemanticResult>> {
  const results = new Map<string, SemanticResult>();
  if (pending.length === 0) return results;

  // Group by product so a product's text is sent once even if several criteria are pending on it.
  const byProduct = new Map<string, { product: Product; criteria: Criterion[] }>();
  for (const { product, criterion } of pending) {
    const entry = byProduct.get(product.id);
    if (entry) {
      if (!entry.criteria.some((c) => c.attribute === criterion.attribute)) entry.criteria.push(criterion);
    } else {
      byProduct.set(product.id, { product, criteria: [criterion] });
    }
  }

  const batches = chunk(Array.from(byProduct.values()), MAX_PRODUCTS_PER_BATCH);

  // Sequential, not Promise.all: throttleGenerateContent already serializes these against
  // Gemini's free-tier rate limit, so concurrent calls would just queue up behind it anyway.
  for (const batch of batches) {
    const batchResults = await resolveBatch(batch);
    for (const [key, value] of batchResults) results.set(key, value);
  }

  return results;
}
