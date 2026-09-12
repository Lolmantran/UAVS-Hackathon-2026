import type { Product, ProductCategory } from "../types/catalog.js";
import type { BundleSuggestion } from "../types/pipeline.js";

const BUNDLE_DISCOUNT_PERCENT = 10;
const MAX_SUGGESTIONS = 2;

// Static "goes-with" rules, keyed by the raw taxonomy fields the real datasets already carry
// (attributes.catalog_group for Amazon-sourced categories, attributes.product_group_name for
// H&M clothing). Heuristic and mocked per products.md — not a real merchant pricing/margin system.
const GOES_WITH: Partial<Record<ProductCategory, Record<string, string[]>>> = {
  skincare: {
    cleanser: ["toner_essence", "moisturizer"],
    toner_essence: ["serum_treatment", "moisturizer"],
    serum_treatment: ["moisturizer", "sun_protection"],
    moisturizer: ["sun_protection"],
    sun_protection: ["moisturizer"],
    mask_exfoliant: ["moisturizer", "toner_essence"],
  },
  electronics: {
    audio: ["mobile_accessories", "charging_connectivity"],
    mobile_accessories: ["charging_connectivity"],
    charging_connectivity: ["mobile_accessories"],
    computer_input: ["display", "storage"],
    display: ["computer_input"],
    camera_smart_home: ["storage", "networking"],
    networking: ["camera_smart_home"],
    storage: ["mobile_accessories"],
  },
  "home-goods": {
    kitchen_appliances: ["kitchen_cookware", "cleaning_laundry"],
    kitchen_cookware: ["kitchen_appliances"],
    bedding_bath: ["decor", "cleaning_laundry"],
    furniture_storage: ["decor", "lighting"],
    lighting: ["decor"],
    decor: ["lighting"],
  },
  clothing: {
    "Garment Upper body": ["Garment Lower body", "Accessories"],
    "Garment Lower body": ["Garment Upper body", "Shoes"],
    "Garment Full body": ["Shoes", "Accessories", "Bags"],
    Shoes: ["Accessories"],
    Bags: ["Accessories"],
  },
};

function groupKeyFor(product: Product): string | undefined {
  if (product.category === "clothing") {
    return (product.attributes.product_group_name as string) ?? undefined;
  }
  return (product.attributes.catalog_group as string) ?? undefined;
}

export function getBundleSuggestions(anchor: Product, catalog: Product[]): BundleSuggestion {
  const anchorGroup = groupKeyFor(anchor);
  const rules = GOES_WITH[anchor.category];
  const complementaryGroups = anchorGroup && rules ? (rules[anchorGroup] ?? []) : [];

  const candidates = catalog.filter(
    (p) => p.id !== anchor.id && p.category === anchor.category && complementaryGroups.includes(groupKeyFor(p) ?? ""),
  );

  const items = candidates.slice(0, MAX_SUGGESTIONS).map((product) => ({
    product,
    discountPercent: BUNDLE_DISCOUNT_PERCENT,
    reason: `Frequently paired with ${anchor.title} (${anchorGroup} → ${groupKeyFor(product)}); bundle discount applied to encourage a larger basket.`,
  }));

  return { anchor, items };
}
