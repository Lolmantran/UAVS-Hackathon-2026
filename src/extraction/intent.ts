// Intent decoding: turns a buyer-agent's natural-language query (+ optional image) into
// structured Criterion[], or a single clarification question when genuinely underspecified.
import { GoogleGenAI, Type, type Content, type Part, type Schema } from "@google/genai";
import { env } from "../config/env.js";
import { MODEL_CONFIG } from "../config/model.js";
import { throttleGenerateContent } from "../config/rateLimit.js";
import type {
  ClarificationQuestion,
  Criterion,
  ExtractedIntent,
  ExtractionInput,
  ExtractionResult,
} from "../types/pipeline.js";
import { RawExtractionSchema, type RawExtraction } from "./schema.js";

let client: GoogleGenAI | undefined;

// Lazy singleton — avoids throwing at import time when GEMINI_API_KEY isn't set yet.
function getClient(): GoogleGenAI {
  if (!client) {
    client = new GoogleGenAI({ apiKey: env.geminiApiKey() });
  }
  return client;
}

// Mirrors RawExtractionSchema for Gemini's structured-output config. Kept separate from the
// zod schema (which is the source of truth) since the two use incompatible type systems.
const RESPONSE_SCHEMA: Schema = {
  type: Type.OBJECT,
  properties: {
    needsClarification: { type: Type.BOOLEAN },
    category: {
      type: Type.STRING,
      nullable: true,
      format: "enum",
      enum: ["clothing", "electronics", "home-goods", "skincare"],
    },
    useCaseSummary: { type: Type.STRING },
    criteria: {
      type: Type.ARRAY,
      items: {
        type: Type.OBJECT,
        properties: {
          attribute: { type: Type.STRING },
          description: { type: Type.STRING },
          importance: { type: Type.STRING, format: "enum", enum: ["mandatory", "preferred"] },
          rawPhrase: { type: Type.STRING },
        },
        required: ["attribute", "description", "importance", "rawPhrase"],
      },
    },
    clarification: {
      type: Type.OBJECT,
      nullable: true,
      properties: {
        question: { type: Type.STRING },
        reason: { type: Type.STRING },
      },
      required: ["question", "reason"],
    },
  },
  required: ["needsClarification", "category", "useCaseSummary", "criteria"],
};

// Category-agnostic on purpose: no per-category branching here. Category-specific nuance
// (what "fits well" means for clothing vs. what "non-comedogenic" means for skincare) is left
// to the model's own knowledge, driven only by the category hint / query text it's given.
const SYSTEM_INSTRUCTION = `You are the intent-decoding stage of a merchant-side agentic commerce search pipeline.
A buyer's AI agent sends a natural-language shopping request, sometimes with a reference image.
Your job is to decode it into structured search criteria, or ask ONE clarification question if the
request is genuinely underspecified in a way that would materially change which products are correct.

Output ONLY a single JSON object (no markdown, no commentary) matching exactly this shape:
{
  "needsClarification": boolean,
  "category": "clothing" | "electronics" | "home-goods" | "skincare" | null,
  "useCaseSummary": string,       // short semantic summary of what the buyer is trying to achieve
  "criteria": [
    {
      "attribute": string,        // short machine key, e.g. "price_cap", "color", "skin_concern"
      "description": string,      // human-readable statement of the constraint
      "importance": "mandatory" | "preferred",
      "rawPhrase": string         // the exact source phrase this was extracted from
    }
  ],
  "clarification": { "question": string, "reason": string }  // ONLY present if needsClarification is true
}

Rules:
- category: use the category hint if one is given, unless the query clearly contradicts it. Otherwise
  infer it from the query/image if obvious, or use null if it genuinely can't be determined.
- Mandatory vs. preferred: an explicitly stated hard constraint (a price cap, an exclusion, a stated
  must-have) is mandatory. A stated nice-to-have ("preferably foldable", a vague style preference) is
  preferred. An unqualified but clearly requested feature defaults to mandatory — read the buyer's
  request as strictly as a literal-minded shopper would.
- Fold any prior clarification answers given to you into criteria as if the buyer had stated them
  in the original request; do not ask about the same thing again.
- Clarification is rare, not default. Only set needsClarification to true when a key attribute a human
  would normally ask about is missing AND its absence would materially change which products are
  correct (e.g. "find pants that go with this shirt" with zero stated fit/material/length preference).
  Do not ask about minor ambiguity a downstream ranking step could reasonably resolve on its own.
- When needsClarification is true, still populate category/useCaseSummary/criteria with whatever can
  be confidently extracted already (a partial intent), and include exactly one clarification question.
- Never include markdown code fences or any text outside the single JSON object.`;

export async function extractIntent(input: ExtractionInput): Promise<ExtractionResult> {
  const contents = buildContents(input);

  const firstRaw = await callModel(contents);
  const firstOutcome = parseExtractionOutput(firstRaw);
  if (firstOutcome.ok) {
    return firstOutcome.result;
  }

  // Retry once with an error-correction follow-up before giving up.
  const correctionContents: Content[] = [
    ...contents,
    { role: "model", parts: [{ text: firstRaw }] },
    {
      role: "user",
      parts: [
        {
          text:
            `Your previous response was invalid: ${firstOutcome.error}\n` +
            "Return ONLY the corrected JSON object matching the required schema exactly. " +
            "No markdown, no commentary.",
        },
      ],
    },
  ];
  const secondRaw = await callModel(correctionContents);
  const secondOutcome = parseExtractionOutput(secondRaw);
  if (secondOutcome.ok) {
    return secondOutcome.result;
  }

  throw new Error(
    `extractIntent: model output failed validation twice. Last error: ${secondOutcome.error}. ` +
      `Raw output: ${secondRaw}`,
  );
}

async function callModel(contents: Content[]): Promise<string> {
  await throttleGenerateContent();
  const response = await getClient().models.generateContent({
    model: MODEL_CONFIG.text,
    contents,
    config: {
      systemInstruction: SYSTEM_INSTRUCTION,
      responseMimeType: "application/json",
      responseSchema: RESPONSE_SCHEMA,
    },
  });

  const text = response.text;
  if (!text) {
    throw new Error("extractIntent: Gemini generateContent returned no text");
  }
  return text;
}

function buildContents(input: ExtractionInput): Content[] {
  const lines: string[] = [`Buyer query: ${input.query}`];

  if (input.category) {
    lines.push(`Category hint (authoritative unless the query clearly contradicts it): ${input.category}`);
  }

  if (input.priorAnswers && input.priorAnswers.length > 0) {
    lines.push(
      "Prior clarification exchanged with the buyer (treat these answers as additional stated " +
        "constraints; do not ask about the same thing again):",
    );
    for (const turn of input.priorAnswers) {
      lines.push(`- Q: ${turn.question}\n  A: ${turn.answer}`);
    }
  }

  const parts: Part[] = [{ text: lines.join("\n") }];

  if (input.imageBase64) {
    const { mimeType, data } = parseImageBase64(input.imageBase64);
    parts.push({ inlineData: { mimeType, data } });
  }

  return [{ role: "user", parts }];
}

// Accepts either a raw base64 string or a data: URI, mirroring embedding/gemini.ts's convention.
function parseImageBase64(imageBase64: string): { mimeType: string; data: string } {
  const match = /^data:(.+?);base64,(.*)$/s.exec(imageBase64);
  if (match) {
    return { mimeType: match[1], data: match[2] };
  }
  return { mimeType: "image/jpeg", data: imageBase64 };
}

export type ParseOutcome = { ok: true; result: ExtractionResult } | { ok: false; error: string };

// Pure JSON-parsing/validation path, kept separate from the network call so it can be unit
// tested against hand-written fake model-output strings without a live API key.
export function parseExtractionOutput(raw: string): ParseOutcome {
  let json: unknown;
  try {
    json = JSON.parse(stripCodeFences(raw));
  } catch (err) {
    return { ok: false, error: `Invalid JSON: ${(err as Error).message}` };
  }

  const parsed = RawExtractionSchema.safeParse(json);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.message };
  }

  return { ok: true, result: toExtractionResult(parsed.data) };
}

// Defensive only: we ask for application/json and the model generally complies, but strip
// accidental ```json fences rather than fail validation over formatting.
function stripCodeFences(raw: string): string {
  const trimmed = raw.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(trimmed);
  return fenced ? fenced[1] : trimmed;
}

function toExtractionResult(data: RawExtraction): ExtractionResult {
  const criteria: Criterion[] = data.criteria.map((c) => ({
    attribute: c.attribute,
    description: c.description,
    importance: c.importance,
    rawPhrase: c.rawPhrase,
  }));

  const partialIntent: ExtractedIntent = {
    category: data.category,
    useCaseSummary: data.useCaseSummary,
    criteria,
  };

  if (data.needsClarification) {
    // RawExtractionSchema's superRefine guarantees clarification is set in this branch.
    const clarification = data.clarification as ClarificationQuestion;
    return { status: "needs_clarification", question: clarification, partialIntent };
  }

  return { status: "ok", intent: partialIntent };
}
