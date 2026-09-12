import type { Product } from "../types/catalog.js";
import type { ScoredProduct, BundleSuggestion } from "../types/pipeline.js";

export function toProductSummary(product: Product) {
  return {
    productId: product.id,
    title: product.title,
    category: product.category,
    brand: product.brand,
    priceUsd: product.priceUsd,
    imageUrl: product.imageUrl,
  };
}

export function toRankedResult(scored: ScoredProduct) {
  return {
    ...toProductSummary(scored.product),
    similarity: scored.similarity,
    justification: scored.justification,
    evaluations: scored.evaluations.map((e) => ({
      attribute: e.criterion.attribute,
      description: e.criterion.description,
      importance: e.criterion.importance,
      outcome: e.outcome,
      evidence: e.evidence,
    })),
  };
}

export function toBundleResponse(bundle: BundleSuggestion) {
  return {
    anchor: toProductSummary(bundle.anchor),
    bundleItems: bundle.items.map((item) => ({
      ...toProductSummary(item.product),
      discountPercent: item.discountPercent,
      reason: item.reason,
    })),
  };
}
