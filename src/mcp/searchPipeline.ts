import type { Product, ProductCategory } from "../types/catalog.js";
import type { ClarificationTurn, ExtractionResult, OriginTool } from "../types/pipeline.js";
import { extractIntent } from "../extraction/intent.js";
import { rankProducts } from "../ranking/rank.js";
import { similaritySearch, getAllProducts, getProductsByCategory, getProduct } from "../catalog/repository.js";
import { createSession, getSession, updateSession } from "../session/store.js";
import { getComplementaryCandidates } from "../bundling/engine.js";
import { toRankedResult } from "./format.js";

const DEFAULT_TOP_K = 25;

export interface RunSearchInput {
  query: string;
  imageBase64?: string;
  category?: ProductCategory;
  originTool: OriginTool;
  /** Restrict ranking/search to this pool instead of the full catalog (used by find_complementary_product). */
  candidatePool?: Product[];
  anchorProductId?: string;
}

export type RankedResultView = ReturnType<typeof toRankedResult>;

export interface SearchToolResult {
  status: "ok" | "needs_clarification";
  sessionId: string;
  rankedResults?: RankedResultView[];
  secondaryResults?: RankedResultView[];
  clarification?: { question: string; reason: string };
}

export async function runSearch(input: RunSearchInput): Promise<SearchToolResult> {
  const extraction = await extractIntent({
    query: input.query,
    imageBase64: input.imageBase64,
    category: input.category,
  });

  return settleExtraction(extraction, {
    originalQuery: input.query,
    imageBase64: input.imageBase64,
    originTool: input.originTool,
    anchorProductId: input.anchorProductId,
    candidatePool: input.candidatePool,
    clarificationHistory: [],
  });
}

export async function resumeSearch(sessionId: string, answer: string): Promise<SearchToolResult> {
  const session = getSession(sessionId);
  if (!session) {
    throw new Error(`Unknown or expired session_id: ${sessionId}`);
  }
  if (!session.pendingQuestion) {
    throw new Error(`Session ${sessionId} has no pending clarification question to answer`);
  }

  const clarificationHistory: ClarificationTurn[] = [
    ...session.clarificationHistory,
    { question: session.pendingQuestion, answer },
  ];

  const extraction = await extractIntent({
    query: session.originalQuery,
    imageBase64: session.imageBase64,
    category: session.intent.category ?? undefined,
    priorAnswers: clarificationHistory,
  });

  const candidatePool = resolveCandidatePool(session.originTool, session.anchorProductId);

  return settleExtraction(extraction, {
    originalQuery: session.originalQuery,
    imageBase64: session.imageBase64,
    originTool: session.originTool,
    anchorProductId: session.anchorProductId,
    candidatePool,
    clarificationHistory,
    existingSessionId: sessionId,
  });
}

function resolveCandidatePool(originTool: OriginTool, anchorProductId?: string): Product[] | undefined {
  if (originTool !== "find_complementary_product" || !anchorProductId) return undefined;
  const anchor = getProduct(anchorProductId);
  if (!anchor) throw new Error(`Unknown anchor_product_id: ${anchorProductId}`);
  return getComplementaryCandidates(anchor, getAllProducts());
}

interface SettleContext {
  originalQuery: string;
  imageBase64?: string;
  originTool: OriginTool;
  anchorProductId?: string;
  candidatePool?: Product[];
  clarificationHistory: ClarificationTurn[];
  existingSessionId?: string;
}

async function settleExtraction(extraction: ExtractionResult, ctx: SettleContext): Promise<SearchToolResult> {
  if (extraction.status === "needs_clarification") {
    const sessionPatch = {
      originalQuery: ctx.originalQuery,
      imageBase64: ctx.imageBase64,
      intent: extraction.partialIntent,
      clarificationHistory: ctx.clarificationHistory,
      originTool: ctx.originTool,
      anchorProductId: ctx.anchorProductId,
      pendingQuestion: extraction.question.question,
    };
    const session = ctx.existingSessionId
      ? updateSession(ctx.existingSessionId, sessionPatch)
      : createSession(sessionPatch);

    return {
      status: "needs_clarification",
      sessionId: session.id,
      clarification: extraction.question,
    };
  }

  const intent = extraction.intent;
  const pool = ctx.candidatePool ?? (intent.category ? getProductsByCategory(intent.category) : getAllProducts());

  const topK = Math.max(pool.length, DEFAULT_TOP_K);
  const matches = await similaritySearch(
    { text: `${intent.useCaseSummary}. ${ctx.originalQuery}`, imageBase64: ctx.imageBase64 },
    { category: intent.category ?? undefined, topK },
  );

  const poolIds = new Set(pool.map((p) => p.id));
  const similarities = new Map<string, number>();
  for (const match of matches) {
    if (poolIds.has(match.product.id)) similarities.set(match.product.id, match.similarity);
  }

  const { ranked, secondary } = rankProducts(intent.criteria, pool, similarities);

  const sessionPatch = {
    originalQuery: ctx.originalQuery,
    imageBase64: ctx.imageBase64,
    intent,
    clarificationHistory: ctx.clarificationHistory,
    originTool: ctx.originTool,
    anchorProductId: ctx.anchorProductId,
    pendingQuestion: undefined,
  };
  const session = ctx.existingSessionId
    ? updateSession(ctx.existingSessionId, sessionPatch)
    : createSession(sessionPatch);

  return {
    status: "ok",
    sessionId: session.id,
    rankedResults: ranked.map(toRankedResult),
    secondaryResults: secondary.slice(0, 5).map(toRankedResult),
  };
}
