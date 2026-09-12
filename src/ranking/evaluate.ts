import type { Criterion, CriterionEvaluation } from "../types/pipeline.js";
import type { Product } from "../types/catalog.js";

// --- Heuristic, pure-code criterion evaluator -------------------------------------------------
// This is deliberately NOT NLP: it's regex + substring matching over product text/attributes.
// Known limits: it can't resolve synonyms it doesn't know about, can't reason about implied
// facts (e.g. "vegan" implying "no leather"), and numeric-attribute matching only works when a
// unit word in the criterion text (e.g. "spf") also appears near a number in the product data.
// Good enough for an MVP demo; a smarter (LLM-based) evaluator could replace this later without
// changing the Criterion/CriterionEvaluation contract.

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "for", "with", "that", "this", "of", "to", "in", "on", "is",
  "are", "be", "it", "its", "as", "at", "by", "from", "should", "must", "want", "under", "over",
]);

function flattenValue(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (Array.isArray(value)) return value.map(flattenValue).join(" ");
  if (typeof value === "object") return Object.values(value as Record<string, unknown>).map(flattenValue).join(" ");
  return String(value);
}

// Corpus a criterion is checked against: title/brand/embeddingText plus raw attributes
// (embeddingText already folds in most attribute fields, but not all — e.g. price, ratings).
// Exported so the semantic fallback evaluator (semanticEvaluate.ts) can give the model the same
// text this deterministic pass already looked at, instead of re-deriving it.
export function buildCorpus(product: Product): string {
  return [product.title, product.brand ?? "", product.embeddingText, flattenValue(product.attributes)]
    .join(" ")
    .toLowerCase();
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

type NumericOp = "lt" | "lte" | "gt" | "gte" | "eq";

interface NumericConstraint {
  op: NumericOp;
  value: number;
  unit: string | null;
}

const COMPARISON_WORDS = new Set([
  "under", "below", "less", "than", "at", "most", "no", "more", "up", "to", "over", "above",
  "least", "minimum", "min", "max", "maximum", "exactly", "equal", "or", "higher", "lower",
  "greater", "usd", "dollars", "dollar",
]);

const NUMERIC_PATTERNS: Array<{ regex: RegExp; op: NumericOp }> = [
  { regex: /\b(?:under|below|less than)\s*\$?(\d+(?:\.\d+)?)/i, op: "lt" },
  { regex: /\b(?:at most|no more than|up to|max(?:imum)?)\s*\$?(\d+(?:\.\d+)?)/i, op: "lte" },
  { regex: /\b(?:over|above|more than)\s*\$?(\d+(?:\.\d+)?)/i, op: "gt" },
  { regex: /\b(?:at least|minimum|min)\s*\$?(\d+(?:\.\d+)?)/i, op: "gte" },
  { regex: /\b(?:exactly|equal to)\s*\$?(\d+(?:\.\d+)?)/i, op: "eq" },
];

// Looks for a comparison word + number in `text` (e.g. "under $200", "SPF 30 or higher").
function parseNumericConstraint(text: string): NumericConstraint | null {
  for (const { regex, op } of NUMERIC_PATTERNS) {
    const match = regex.exec(text);
    if (match) {
      return { op, value: Number(match[1]), unit: extractUnit(text, match[1]) };
    }
  }
  const bareDollar = /\$(\d+(?:\.\d+)?)/.exec(text);
  if (bareDollar) {
    return { op: "lte", value: Number(bareDollar[1]), unit: null };
  }
  return null;
}

// Grabs the nearest non-comparison word next to the matched number, e.g. "spf" in "SPF 50".
function extractUnit(text: string, numberStr: string): string | null {
  const idx = text.indexOf(numberStr);
  if (idx === -1) return null;
  const window = text.slice(Math.max(0, idx - 15), idx + numberStr.length + 15);
  const words = window.toLowerCase().match(/[a-z]+/g) ?? [];
  const candidate = words.find((w) => !COMPARISON_WORDS.has(w) && w.length > 1);
  return candidate ?? null;
}

function compare(actual: number, op: NumericOp, target: number): boolean {
  switch (op) {
    case "lt": return actual < target;
    case "lte": return actual <= target;
    case "gt": return actual > target;
    case "gte": return actual >= target;
    case "eq": return actual === target;
  }
}

function opLabel(op: NumericOp): string {
  return { lt: "<", lte: "<=", gt: ">", gte: ">=", eq: "==" }[op];
}

function isPriceCriterion(criterion: Criterion): boolean {
  const text = `${criterion.attribute} ${criterion.description} ${criterion.rawPhrase}`.toLowerCase();
  return /price|cost|budget|\$|usd|dollar/.test(text);
}

function evaluatePriceCriterion(
  criterion: Criterion,
  product: Product,
  constraint: NumericConstraint,
): CriterionEvaluation {
  if (product.priceUsd === null) {
    return { criterion, outcome: "unknown", evidence: "no price data available for this product" };
  }
  const ok = compare(product.priceUsd, constraint.op, constraint.value);
  return {
    criterion,
    outcome: ok ? "satisfied" : "violated",
    evidence: `product price $${product.priceUsd} vs constraint ${opLabel(constraint.op)} $${constraint.value}`,
  };
}

// Numeric constraint on a non-price attribute (e.g. "SPF 30 or higher"). Requires a unit word
// from the criterion text to also show up near a number in the product corpus; if we can't find
// one we return null so the caller falls back to textual matching instead of guessing.
function evaluateAttributeNumeric(
  criterion: Criterion,
  product: Product,
  constraint: NumericConstraint,
): CriterionEvaluation | null {
  const unit = constraint.unit;
  if (!unit) return null;
  const corpus = buildCorpus(product);
  const u = escapeRegex(unit);
  const pattern = new RegExp(`${u}\\D{0,4}(\\d+(?:\\.\\d+)?)|(\\d+(?:\\.\\d+)?)\\D{0,4}${u}\\b`, "i");
  const match = pattern.exec(corpus);
  if (!match) {
    return { criterion, outcome: "unknown", evidence: `no mention of ${unit} value in product data` };
  }
  const value = Number(match[1] ?? match[2]);
  const ok = compare(value, constraint.op, constraint.value);
  return {
    criterion,
    outcome: ok ? "satisfied" : "violated",
    evidence: `found ${unit} value ${value} in product data vs constraint ${opLabel(constraint.op)} ${constraint.value}`,
  };
}

const NEGATION_CUES = /\b(no|not|without|free of|avoid(?:ing)?|exclud(?:e|ing|es)?|free)\b/i;

// Pulls the excluded term out of phrasing like "no leather", "without fragrance",
// "fragrance-free", falling back to the criterion's attribute key.
function extractExcludedTerm(criterion: Criterion): string | null {
  const text = `${criterion.description} ${criterion.rawPhrase}`;
  const patterns = [
    /(?:no|without|free of|avoid(?:ing)?|exclud(?:e|ing|es)?)\s+([a-z][a-z\s-]{1,30}?)(?:[.,;]|$)/i,
    /([a-z][a-z\s]{1,30}?)[\s-]free\b/i,
  ];
  for (const p of patterns) {
    const m = p.exec(text);
    if (m) return m[1].trim().toLowerCase();
  }
  const attr = criterion.attribute
    .toLowerCase()
    .replace(/_?free$/, "")
    .replace(/^no_/, "")
    .replace(/_/g, " ")
    .trim();
  return attr || null;
}

// True if `corpus` explicitly negates `term`, e.g. "fragrance-free", "no leather", "non-toxic".
function hasNegatedForm(corpus: string, term: string): boolean {
  const t = escapeRegex(term.trim());
  if (!t) return false;
  const pattern = new RegExp(
    `(?:\\bno\\b|\\bnot\\b|\\bwithout\\b|\\bfree of\\b)\\s*${t}\\b|\\b${t}[\\s-]*free\\b|\\bnon-${t}\\b`,
    "i",
  );
  return pattern.test(corpus);
}

function significantTokens(criterion: Criterion): string[] {
  const words = `${criterion.description} ${criterion.attribute.replace(/_/g, " ")}`.toLowerCase().match(/[a-z]+/g) ?? [];
  return Array.from(new Set(words.filter((w) => w.length >= 3 && !STOPWORDS.has(w))));
}

function evaluateTextual(criterion: Criterion, product: Product): CriterionEvaluation {
  const corpus = buildCorpus(product);
  const isExclusion =
    NEGATION_CUES.test(criterion.description) || NEGATION_CUES.test(criterion.rawPhrase);

  if (isExclusion) {
    const term = extractExcludedTerm(criterion);
    if (!term) {
      return { criterion, outcome: "unknown", evidence: "could not identify the excluded term from the criterion text" };
    }
    if (hasNegatedForm(corpus, term)) {
      return {
        criterion,
        outcome: "satisfied",
        evidence: `product text explicitly indicates "${term}-free"/"no ${term}"`,
      };
    }
    if (corpus.includes(term)) {
      return {
        criterion,
        outcome: "violated",
        evidence: `product text mentions "${term}" without any exclusion qualifier`,
      };
    }
    return { criterion, outcome: "unknown", evidence: `no mention of "${term}" in product data` };
  }

  const tokens = significantTokens(criterion);

  // A positive criterion (e.g. "black color") is violated if the product data explicitly
  // negates the same term (e.g. "not available in black" / "black-free" would be nonsensical
  // in practice, but this catches cases like a "waterproof" criterion vs. "not waterproof" text).
  const negatedToken = tokens.find((t) => hasNegatedForm(corpus, t));
  if (negatedToken) {
    return {
      criterion,
      outcome: "violated",
      evidence: `product text explicitly negates "${negatedToken}"`,
    };
  }

  const phrase = criterion.description.toLowerCase().trim();
  if (phrase.length > 3 && corpus.includes(phrase)) {
    return { criterion, outcome: "satisfied", evidence: `product text contains "${criterion.description}"` };
  }

  const matchedTokens = tokens.filter((t) => corpus.includes(t));
  if (matchedTokens.length > 0 && matchedTokens.length >= Math.ceil(tokens.length / 2)) {
    return {
      criterion,
      outcome: "satisfied",
      evidence: `product text mentions: ${matchedTokens.join(", ")}`,
    };
  }

  return {
    criterion,
    outcome: "unknown",
    evidence: `no mention of "${criterion.rawPhrase || criterion.description}" in product data`,
  };
}

export function evaluateCriterion(criterion: Criterion, product: Product): CriterionEvaluation {
  const numeric =
    parseNumericConstraint(criterion.description) ?? parseNumericConstraint(criterion.rawPhrase);

  if (numeric) {
    if (isPriceCriterion(criterion)) {
      return evaluatePriceCriterion(criterion, product, numeric);
    }
    const attributeResult = evaluateAttributeNumeric(criterion, product, numeric);
    if (attributeResult) return attributeResult;
  }

  return evaluateTextual(criterion, product);
}
