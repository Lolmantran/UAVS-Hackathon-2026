import path from "node:path";
import type { Product, ProductCategory } from "../types/catalog.js";
import { loadCatalog } from "./loader.js";
import { generateEmbedding } from "../embedding/gemini.js";
import { openVectorStore, querySimilar, type VectorStore } from "../embedding/vectorStore.js";

const VECTOR_STORE_PATH = path.resolve(process.cwd(), "var/catalog.vec.sqlite");

// Loaded lazily (not at module init) so importing this module has no side effects until
// something actually asks for catalog data or runs a search.
let products: Product[] | undefined;
let productById: Map<string, Product> | undefined;
let vectorStore: VectorStore | undefined;

function ensureCatalogLoaded(): { products: Product[]; productById: Map<string, Product> } {
  if (!products || !productById) {
    products = loadCatalog();
    productById = new Map(products.map((p) => [p.id, p]));
  }
  return { products, productById };
}

function getVectorStore(): VectorStore {
  if (!vectorStore) {
    vectorStore = openVectorStore(VECTOR_STORE_PATH);
  }
  return vectorStore;
}

export function getProduct(id: string): Product | undefined {
  return ensureCatalogLoaded().productById.get(id);
}

export function getProductsByCategory(category: ProductCategory): Product[] {
  return ensureCatalogLoaded().products.filter((p) => p.category === category);
}

export function getAllProducts(): Product[] {
  return ensureCatalogLoaded().products;
}

export interface SimilaritySearchQuery {
  text?: string;
  imageBase64?: string;
}

export interface SimilaritySearchOptions {
  category?: ProductCategory;
  topK?: number;
}

export interface SimilaritySearchMatch {
  product: Product;
  similarity: number;
}

// Embeds the query (text and/or image together in one embedContent call — gemini-embedding-2
// is natively multimodal, see src/embedding/gemini.ts), queries the vector store, and maps
// rowids back to Products.
export async function similaritySearch(
  query: SimilaritySearchQuery,
  opts: SimilaritySearchOptions = {},
): Promise<SimilaritySearchMatch[]> {
  const { productById } = ensureCatalogLoaded();

  if (!query.text && !query.imageBase64) {
    throw new Error("similaritySearch requires at least one of query.text or query.imageBase64");
  }

  const queryEmbedding = await generateEmbedding({
    text: query.text,
    image: query.imageBase64 ? { imageBase64: query.imageBase64 } : undefined,
  });

  const topK = opts.topK ?? 10;
  // Overfetch when filtering by category, since sqlite-vec's KNN result may be dominated by
  // other categories — still want up to topK matches after the filter.
  const fetchK = opts.category ? Math.max(topK * 5, 50) : topK;

  const matches = querySimilar(getVectorStore(), queryEmbedding, { topK: fetchK });

  const results: SimilaritySearchMatch[] = [];
  for (const match of matches) {
    const product = productById.get(match.productId);
    if (!product) continue;
    if (opts.category && product.category !== opts.category) continue;

    // sqlite-vec vec0 default distance is L2 (>=0, smaller = more similar). Transform to a
    // similarity score in (0, 1] where higher = more similar: 1 / (1 + distance).
    results.push({ product, similarity: 1 / (1 + match.distance) });
    if (results.length >= topK) break;
  }

  return results;
}
