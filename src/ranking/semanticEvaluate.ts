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

const MAX_CORPUS_CHARS = 500;

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

  const blocks = Array.from(byProduct.values()).map(({ product, criteria }) => {
    const corpus = buildCorpus(product).slice(0, MAX_CORPUS_CHARS);
    const criteriaLines = criteria
      .map((c) => `  - attribute="${c.attribute}": ${c.description} (source phrase: "${c.rawPhrase}")`)
      .join("\n");
    return `Product ${product.id}: "${product.title}"\nProduct text: ${corpus}\nCriteria:\n${criteriaLines}`;
  });

  await throttleGenerateContent();
  const response = await getClient().models.generateContent({
    model: MODEL_CONFIG.text,
    contents: [{ role: "user", parts: [{ text: blocks.join("\n\n") }] }],
    config: {
      systemInstruction: SYSTEM_INSTRUCTION,
      responseMimeType: "application/json",
      responseSchema: RESPONSE_SCHEMA,
    },
  });

  const text = response.text;
  if (!text) return results;

  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    return results; // Fail soft: callers keep the deterministic "unknown" outcome.
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
