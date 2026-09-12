import type {
  Criterion,
  CriterionEvaluation,
  CriterionImportance,
  RankedSearchResult,
  ScoredProduct,
} from "../types/pipeline.js";
import type { Product } from "../types/catalog.js";
import { evaluateCriterion } from "./evaluate.js";
import { buildDeterministicJustification } from "./justify.js";
import { resolveSemanticUnknowns } from "./semanticEvaluate.js";

function countSatisfied(evaluations: CriterionEvaluation[], importance: CriterionImportance): number {
  return evaluations.filter((e) => e.criterion.importance === importance && e.outcome === "satisfied").length;
}

// Getting the right kind of product outranks every other attribute: a rubber boot that's the
// wrong color still belongs above a leather bag when nothing satisfies every mandatory criterion.
// No item_type criterion present (older/legacy extractions) is treated as a non-factor, not a
// penalty, so this falls back to the previous mandatory-count ordering.
function itemTypeSatisfied(evaluations: CriterionEvaluation[]): boolean {
  const itemType = evaluations.find((e) => e.criterion.attribute === "item_type");
  return itemType ? itemType.outcome === "satisfied" : true;
}

export function scoreProduct(criteria: Criterion[], product: Product, similarity: number): ScoredProduct {
  const evaluations = criteria.map((c) => evaluateCriterion(c, product));
  const eligible = evaluations
    .filter((e) => e.criterion.importance === "mandatory")
    .every((e) => e.outcome === "satisfied");

  return {
    product,
    evaluations,
    eligible,
    similarity,
    justification: buildDeterministicJustification(evaluations),
  };
}

function finalizeRanking(scored: ScoredProduct[]): RankedSearchResult {
  const ranked = scored
    .filter((s) => s.eligible)
    .sort((a, b) => {
      const preferredDiff = countSatisfied(b.evaluations, "preferred") - countSatisfied(a.evaluations, "preferred");
      if (preferredDiff !== 0) return preferredDiff;
      const similarityDiff = b.similarity - a.similarity;
      if (similarityDiff !== 0) return similarityDiff;
      return a.product.id < b.product.id ? -1 : a.product.id > b.product.id ? 1 : 0;
    });

  const secondary = scored
    .filter((s) => !s.eligible)
    .sort((a, b) => {
      const itemTypeDiff = Number(itemTypeSatisfied(b.evaluations)) - Number(itemTypeSatisfied(a.evaluations));
      if (itemTypeDiff !== 0) return itemTypeDiff;
      const mandatoryDiff = countSatisfied(b.evaluations, "mandatory") - countSatisfied(a.evaluations, "mandatory");
      if (mandatoryDiff !== 0) return mandatoryDiff;
      return b.similarity - a.similarity;
    });

  return { ranked, secondary };
}

export function rankProducts(
  criteria: Criterion[],
  candidates: Product[],
  similarities: Map<string, number>,
): RankedSearchResult {
  const scored = candidates.map((product) =>
    scoreProduct(criteria, product, similarities.get(product.id) ?? 0),
  );

  return finalizeRanking(scored);
}

// Only the top-ranked candidates (by deterministic mandatory-match count, then similarity) are
// worth the slow, rate-limited LLM fallback call — sending the whole pool was the dominant cost
// on every search (multiple sequential throttled batches, ~4.3s apart each, see rateLimit.ts).
const MAX_SEMANTIC_CANDIDATES = 3;

// Same as rankProducts, plus a semantic second pass over whatever the deterministic keyword
// evaluator left as "unknown" (see semanticEvaluate.ts) — e.g. "red" resolving "bright color".
// Only run over the top MAX_SEMANTIC_CANDIDATES candidates, not the whole pool (see above).
export async function rankProductsSemantic(
  criteria: Criterion[],
  candidates: Product[],
  similarities: Map<string, number>,
): Promise<RankedSearchResult> {
  const scored = candidates.map((product) =>
    scoreProduct(criteria, product, similarities.get(product.id) ?? 0),
  );

  const topForResolution = [...scored]
    .sort((a, b) => {
      const mandatoryDiff = countSatisfied(b.evaluations, "mandatory") - countSatisfied(a.evaluations, "mandatory");
      if (mandatoryDiff !== 0) return mandatoryDiff;
      return b.similarity - a.similarity;
    })
    .slice(0, MAX_SEMANTIC_CANDIDATES);
  const idsForResolution = new Set(topForResolution.map((s) => s.product.id));

  const pending = scored
    .filter((s) => idsForResolution.has(s.product.id))
    .flatMap((s) =>
      s.evaluations
        .filter((e) => e.outcome === "unknown")
        .map((e) => ({ product: s.product, criterion: e.criterion })),
    );

  if (pending.length > 0) {
    const resolved = await resolveSemanticUnknowns(pending);
    for (const s of scored) {
      let changed = false;
      s.evaluations = s.evaluations.map((e) => {
        if (e.outcome !== "unknown") return e;
        const patch = resolved.get(`${s.product.id}::${e.criterion.attribute}`);
        if (!patch) return e;
        changed = true;
        return { criterion: e.criterion, outcome: patch.outcome, evidence: patch.evidence };
      });
      if (changed) {
        s.eligible = s.evaluations
          .filter((e) => e.criterion.importance === "mandatory")
          .every((e) => e.outcome === "satisfied");
        s.justification = buildDeterministicJustification(s.evaluations);
      }
    }
  }

  return finalizeRanking(scored);
}
