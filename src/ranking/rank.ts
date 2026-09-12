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

function countSatisfied(evaluations: CriterionEvaluation[], importance: CriterionImportance): number {
  return evaluations.filter((e) => e.criterion.importance === importance && e.outcome === "satisfied").length;
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

export function rankProducts(
  criteria: Criterion[],
  candidates: Product[],
  similarities: Map<string, number>,
): RankedSearchResult {
  const scored = candidates.map((product) =>
    scoreProduct(criteria, product, similarities.get(product.id) ?? 0),
  );

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
      const mandatoryDiff = countSatisfied(b.evaluations, "mandatory") - countSatisfied(a.evaluations, "mandatory");
      if (mandatoryDiff !== 0) return mandatoryDiff;
      return b.similarity - a.similarity;
    });

  return { ranked, secondary };
}
