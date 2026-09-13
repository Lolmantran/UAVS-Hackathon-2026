import { readFileSync } from "node:fs";
import path from "node:path";
import type { Product, ProductCategory } from "../types/catalog.js";

const DATA_DIR = path.resolve(process.cwd(), "data");

interface HmClothingRecord {
  article_id: string;
  image_file: string;
  image_path: string;
  prod_name: string;
  product_type_name: string;
  product_group_name: string;
  graphical_appearance_name: string;
  colour_group_name: string;
  department_name: string;
  index_name: string;
  section_name: string;
  garment_group_name: string;
  detail_desc: string;
}

// The H&M sample is metadata-only, so it cannot support a credible bundle-price demo on its
// own. These clearly labelled, stable demo prices let the original 30 fixtures take part in
// pricing calculations without misrepresenting a source-catalog price.
const SYNTHETIC_CLOTHING_PRICE_USD: Record<string, number> = {
  "0111586001": 15,
  "0112679048": 25,
  "0146721001": 9,
  "0181160009": 70,
  "0192460006": 59,
  "0458083007": 18,
  "0469562048": 49,
  "0484108014": 42,
  "0515692013": 45,
  "0525500023": 48,
  "0537183005": 22,
  "0539744001": 75,
  "0541491015": 28,
  "0553873005": 25,
  "0555351001": 29,
  "0558178001": 28,
  "0571343003": 16,
  "0572128005": 48,
  "0573085001": 55,
  "0576782001": 35,
  "0586677004": 36,
  "0592975003": 62,
  "0599102001": 79,
  "0599680001": 69,
  "0604430001": 28,
  "0615197001": 8,
  "0626461002": 89,
  "0633152012": 49,
  "0650534002": 65,
  "0682238013": 45,
};

interface AmazonRecord {
  id: string;
  main_category: string;
  category_path: string[];
  catalog_group: string;
  title: string;
  brand_or_store: string | null;
  price_usd: number | null;
  average_rating: number | null;
  rating_count: number | null;
  features: string[];
  description: string[];
  details: Record<string, unknown>;
  image_url: string | null;
  /** Present on the controlled demo fixtures; omitted on legacy source records. */
  product_family?: string;
  variant_key?: string;
  structured_attributes?: Record<string, unknown>;
}

function structuredAttributesText(value: unknown, prefix = ""): string[] {
  if (value === null || value === undefined) return [];
  if (Array.isArray(value)) {
    return [`${prefix}: ${value.join(", ")}`];
  }
  if (typeof value !== "object") {
    if (typeof value === "boolean") {
      const label = prefix.replaceAll("_", " ");
      return [value ? label : `no ${label}`];
    }
    return [`${prefix.replaceAll("_", " ")}: ${String(value)}`];
  }

  return Object.entries(value as Record<string, unknown>).flatMap(([key, child]) =>
    structuredAttributesText(child, prefix ? `${prefix}.${key}` : key),
  );
}

function loadJson<T>(relativePath: string): T {
  const filePath = path.join(DATA_DIR, relativePath);
  return JSON.parse(readFileSync(filePath, "utf-8")) as T;
}

function loadClothing(): Product[] {
  const records = loadJson<HmClothingRecord[]>("clothing/products.json");
  return records.map((r) => {
    const syntheticPriceUsd = SYNTHETIC_CLOTHING_PRICE_USD[r.article_id];
    if (syntheticPriceUsd === undefined) {
      throw new Error(`Missing synthetic demo price for clothing article ${r.article_id}`);
    }
    const embeddingText = [
      r.prod_name,
      r.product_type_name,
      r.product_group_name,
      r.graphical_appearance_name,
      r.colour_group_name,
      r.department_name,
      r.garment_group_name,
      r.detail_desc,
      `Synthetic demo price: $${syntheticPriceUsd} USD`,
    ]
      .filter(Boolean)
      .join(". ");

    return {
      id: r.article_id,
      category: "clothing" as ProductCategory,
      title: r.prod_name,
      brand: null,
      priceUsd: syntheticPriceUsd,
      imageUrl: null,
      imagePath: r.image_path,
      attributes: {
        ...r,
        demo_price_usd: syntheticPriceUsd,
        price_source: "synthetic demo price; H&M source metadata did not include a price",
      },
      embeddingText,
    };
  });
}

function loadAmazonCategory(category: ProductCategory, fileName: string): Product[] {
  const records = loadJson<AmazonRecord[]>(`${category}/${fileName}`);
  return records.map((r) => {
    const detailsText = Object.entries(r.details ?? {})
      .map(([k, v]) => `${k}: ${typeof v === "object" ? JSON.stringify(v) : v}`)
      .join("; ");
    const structuredText = structuredAttributesText(r.structured_attributes)
      .map((fact) => `Structured attribute: ${fact}`)
      .join(". ");

    const embeddingText = [
      r.title,
      r.category_path?.join(" > "),
      r.catalog_group,
      r.product_family,
      r.variant_key,
      ...(r.features ?? []),
      ...(r.description ?? []),
      detailsText,
      structuredText,
    ]
      .filter(Boolean)
      .join(". ");

    return {
      id: r.id,
      category,
      title: r.title,
      brand: r.brand_or_store ?? null,
      priceUsd: r.price_usd ?? null,
      imageUrl: r.image_url ?? null,
      imagePath: null,
      attributes: { ...r },
      embeddingText,
    };
  });
}

export function loadCatalog(): Product[] {
  return [
    ...loadClothing(),
    ...loadAmazonCategory("electronics", "electronics_catalog.json"),
    ...loadAmazonCategory("skincare", "skincare_catalog.json"),
    ...loadAmazonCategory("home-goods", "homegoods_catalog.json"),
  ];
}

export function loadCatalogByCategory(): Record<ProductCategory, Product[]> {
  const all = loadCatalog();
  const grouped: Record<ProductCategory, Product[]> = {
    clothing: [],
    electronics: [],
    "home-goods": [],
    skincare: [],
  };
  for (const product of all) {
    grouped[product.category].push(product);
  }
  return grouped;
}
