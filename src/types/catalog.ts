export type ProductCategory = "clothing" | "electronics" | "home-goods" | "skincare";

export const PRODUCT_CATEGORIES: ProductCategory[] = [
  "clothing",
  "electronics",
  "home-goods",
  "skincare",
];

// Normalized shape every category's raw catalog JSON gets mapped into.
// Raw datasets are NOT uniform (H&M metadata vs. Amazon 2023 metadata) — category-specific
// fields live in `attributes`, flattened text for embedding/extraction lives in `embeddingText`.
export interface Product {
  id: string;
  category: ProductCategory;
  title: string;
  brand: string | null;
  priceUsd: number | null;
  /** Remote image URL, when the source dataset provides one (electronics/skincare/home-goods). */
  imageUrl: string | null;
  /** Local image path, when the source dataset provides one (clothing/H&M) — may not exist on
   * disk until Kaggle credentials are configured and the fetch script has been run. */
  imagePath: string | null;
  /** Category-specific raw fields (features, description, details, category_path, etc.),
   * kept as-is for LLM attribute extraction to read. */
  attributes: Record<string, unknown>;
  /** Flattened title + features + description + key detail fields, used for embeddings and
   * as extraction context. Built once at load time so downstream modules don't re-derive it. */
  embeddingText: string;
}
