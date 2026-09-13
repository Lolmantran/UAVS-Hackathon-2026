import type { Product, ProductCategory } from "./catalog.js";

export type CriterionImportance = "mandatory" | "preferred";
export type CriterionOutcome = "satisfied" | "violated" | "unknown";

/** One decoded constraint from the buyer's request, e.g. "under $200 AUD" or "black color". */
export interface Criterion {
  attribute: string; // short machine key, e.g. "price_cap", "color", "skin_concern"
  description: string; // human-readable statement of the constraint
  importance: CriterionImportance;
  rawPhrase: string; // the source phrase this was extracted from
}

export interface ExtractedIntent {
  category: ProductCategory | null;
  /** The bare fundamental kind of product requested, e.g. "t-shirt", "boot". Always also present
   *  as criteria[0], a synthesized mandatory "item_type" Criterion — see extraction/intent.ts. */
  itemType: string;
  useCaseSummary: string; // short semantic summary of what the buyer is trying to achieve
  criteria: Criterion[];
}

export interface ClarificationQuestion {
  question: string;
  reason: string; // why this is needed (which attribute is missing/ambiguous)
}

export type ExtractionResult =
  | { status: "ok"; intent: ExtractedIntent }
  | { status: "needs_clarification"; question: ClarificationQuestion; partialIntent: ExtractedIntent };

export interface ExtractionInput {
  query: string;
  /** data: URI or plain base64, caller-supplied reference image. */
  imageBase64?: string;
  /** Narrows extraction to a known category (e.g. when seeded from an anchor product). */
  category?: ProductCategory;
  /** Prior clarification Q&A, folded back in on a resumed session. */
  priorAnswers?: Array<{ question: string; answer: string }>;
  /** find_complementary_product only: the candidate pool is already restricted to items that
   *  pair with the anchor by taxonomy (see bundling/engine.ts), so extraction must not invent a
   *  criterion requiring product text to literally reference/pair-with a specific other product —
   *  no product's text will ever say that, so it would permanently keep ranked_results empty. */
  suppressPairingCriterion?: boolean;
}

export interface CriterionEvaluation {
  criterion: Criterion;
  outcome: CriterionOutcome;
  evidence: string; // short note on what in the product supported this outcome
}

export interface ScoredProduct {
  product: Product;
  evaluations: CriterionEvaluation[];
  eligible: boolean; // true iff every mandatory criterion is "satisfied"
  similarity: number; // 0..1, higher = more similar (embedding-based)
  justification: string; // human-readable reason, references satisfied criteria
}

export interface RankedSearchResult {
  ranked: ScoredProduct[]; // eligible, ordered best-first
  secondary: ScoredProduct[]; // ineligible-but-close, ordered by how few criteria they failed
}

export interface BundleItem {
  product: Product;
  discountPercent: number;
  reason: string;
}

export interface BundleSuggestion {
  anchor: Product;
  items: BundleItem[];
}

export interface ClarificationTurn {
  question: string;
  answer: string;
}

export type OriginTool =
  | "search_exact_product"
  | "find_matching_product"
  | "find_complementary_product";

export interface Session {
  id: string;
  createdAt: number;
  originalQuery: string;
  imageBase64?: string;
  intent: ExtractedIntent;
  clarificationHistory: ClarificationTurn[];
  /** Which tool started this session, so answer_clarification can resume the right pipeline. */
  originTool: OriginTool;
  /** Only set when originTool is "find_complementary_product" — the product being paired against. */
  anchorProductId?: string;
  /** Text used for the embedding-similarity ranking step specifically, which may differ from
   *  originalQuery — e.g. find_complementary_product enriches this with the anchor's title for
   *  ranking quality, while keeping originalQuery (sent to extraction) anchor-name-free so the
   *  model doesn't invent an unsatisfiable "must reference this product" criterion. Falls back to
   *  originalQuery when not set. */
  embeddingContextText?: string;
  /** The question currently awaiting an answer, if status is needs_clarification; cleared once answered. */
  pendingQuestion?: string;
}
