import { GoogleGenAI } from "@google/genai";
import type { CriterionEvaluation } from "../types/pipeline.js";
import type { Product } from "../types/catalog.js";
import { env } from "../config/env.js";
import { MODEL_CONFIG } from "../config/model.js";
import { throttleGenerateContent } from "../config/rateLimit.js";

// Template-based, no LLM. Default justification used everywhere in the deterministic pipeline.
export function buildDeterministicJustification(evaluations: CriterionEvaluation[]): string {
  const satisfied = evaluations.filter((e) => e.outcome === "satisfied").map((e) => e.criterion.description);
  const violated = evaluations.filter((e) => e.outcome === "violated").map((e) => e.criterion.description);
  const unknown = evaluations.filter((e) => e.outcome === "unknown").map((e) => e.criterion.description);

  const parts: string[] = [];
  if (satisfied.length > 0) parts.push(`Matches: ${satisfied.join(", ")}`);
  if (violated.length > 0) parts.push(`fails: ${violated.join(", ")}`);
  if (unknown.length > 0) parts.push(`unclear on: ${unknown.join(", ")}`);

  return parts.length > 0 ? parts.join("; ") : "No criteria evaluated";
}

let client: GoogleGenAI | undefined;

// Lazy singleton — avoids throwing at import time when GEMINI_API_KEY isn't set yet.
function getClient(): GoogleGenAI {
  if (!client) {
    client = new GoogleGenAI({ apiKey: env.geminiApiKey() });
  }
  return client;
}

// Optional enhancement over buildDeterministicJustification: asks the LLM to turn the same
// evaluations into a more natural sentence. Never throws — falls back to the deterministic
// text on any error (missing API key, network failure, empty response, etc.), so callers can
// use this without risking the ranking pipeline.
export async function generateLlmJustification(
  evaluations: CriterionEvaluation[],
  product: Product,
): Promise<string> {
  try {
    const summary = evaluations
      .map((e) => `- ${e.criterion.description} (${e.criterion.importance}): ${e.outcome} — ${e.evidence}`)
      .join("\n");

    await throttleGenerateContent();
    const response = await getClient().models.generateContent({
      model: MODEL_CONFIG.text,
      contents: [
        {
          text:
            `Write one concise, natural sentence explaining why "${product.title}" is or isn't a good ` +
            `match for the buyer, based only on the evaluation below. Do not invent facts beyond it.\n\n${summary}`,
        },
      ],
    });

    const text = response.text?.trim();
    if (!text) throw new Error("empty response from Gemini");
    return text;
  } catch {
    return buildDeterministicJustification(evaluations);
  }
}
