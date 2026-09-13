import { readFileSync } from "node:fs";
import path from "node:path";
import { PROJECT_ROOT } from "../config/paths.js";
import type { Product, ProductCategory } from "../types/catalog.js";

const DATA_DIR = path.join(PROJECT_ROOT, "data");

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
    const embeddingText = [
      r.prod_name,
      r.product_type_name,
      r.product_group_name,
      r.graphical_appearance_name,
      r.colour_group_name,
      r.department_name,
      r.garment_group_name,
      r.detail_desc,
    ]
      .filter(Boolean)
      .join(". ");

    return {
      id: r.article_id,
      category: "clothing" as ProductCategory,
      title: r.prod_name,
      brand: null,
      priceUsd: null, // H&M metadata has no price field
      imageUrl: null,
      // Absolute, so the photo resolves no matter which directory the server was launched from.
      imagePath: r.image_path ? path.join(PROJECT_ROOT, r.image_path) : null,
      attributes: { ...r },
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
