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
  const anchorPrice = bundle.anchor.priceUsd ?? 0;
  const itemsFullPrice = bundle.items.reduce((sum, item) => sum + (item.product.priceUsd ?? 0), 0);
  const itemsDiscountedPrice = bundle.items.reduce(
    (sum, item) => sum + (item.product.priceUsd ?? 0) * (1 - item.discountPercent / 100),
    0,
  );
  const subtotalUsd = anchorPrice + itemsFullPrice;
  const proposedTotalUsd = anchorPrice + itemsDiscountedPrice;
  const missingPriceIds = [bundle.anchor, ...bundle.items.map((item) => item.product)]
    .filter((p) => p.priceUsd === null)
    .map((p) => p.id);

  return {
    anchor: toProductSummary(bundle.anchor),
    bundleItems: bundle.items.map((item) => ({
      ...toProductSummary(item.product),
      discountPercent: item.discountPercent,
      reason: item.reason,
    })),
    proposal: {
      currency: "USD",
      subtotalUsd: round2(subtotalUsd),
      proposedTotalUsd: round2(proposedTotalUsd),
      savingsUsd: round2(subtotalUsd - proposedTotalUsd),
      ...(missingPriceIds.length > 0
        ? { note: `No price data for: ${missingPriceIds.join(", ")} — treated as $0.` }
        : {}),
    },
  };
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
