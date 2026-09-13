import type { Product, ProductCategory } from "../types/catalog.js";
import type { BundleSuggestion } from "../types/pipeline.js";

export const BUNDLE_DISCOUNT_PERCENT = 10;
const MAX_SUGGESTIONS = 2;

export interface BundleContext {
  /** The buyer's request, used only to prefer compatible candidates within a curated group. */
  query?: string;
}

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
    // The controlled demo inventory has running watches and running earbuds, but no generic
    // charger/cable fixtures. Pair the two explicit product families instead of treating every
    // mobile accessory (including a watch) as interchangeable with an earbud purchase.
    audio: [],
    mobile_accessories: [],
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

function productFamilyFor(product: Product): string | undefined {
  return typeof product.attributes.product_family === "string" ? product.attributes.product_family : undefined;
}

function normalized(value: unknown): string {
  return String(value ?? "").toLowerCase();
}

function audienceKey(product: Product): string {
  return normalized(product.attributes.index_group_name);
}

function hasFormalIntent(query: string | undefined): boolean {
  return /\b(formal|wedding|ceremony|black[ -]?tie|tailoring|dressy)\b/i.test(query ?? "");
}

function nestedBoolean(product: Product, section: string, key: string): boolean {
  const structured = product.attributes.structured_attributes;
  if (!structured || typeof structured !== "object") return false;
  const value = (structured as Record<string, unknown>)[section];
  return Boolean(value && typeof value === "object" && (value as Record<string, unknown>)[key] === true);
}

function apparelCompatibilityScore(anchor: Product, candidate: Product, context: BundleContext): number {
  let score = 0;
  // Do not pair baby/children or menswear products with a ladieswear anchor simply because their
  // taxonomy group matches. Exact audience is safest for this small, mixed H&M sample.
  if (audienceKey(anchor) === audienceKey(candidate)) score += 100;
  else score -= 100;

  const candidateText = [
    candidate.title,
    candidate.attributes.product_type_name,
    candidate.attributes.section_name,
    candidate.attributes.detail_desc,
  ]
    .map(normalized)
    .join(" ");

  if (hasFormalIntent(context.query)) {
    if (/tailoring/.test(candidateText)) score += 30;
    if (/trouser|blouse|pump|heel|dress|fancy/.test(candidateText)) score += 15;
    if (/hoodie|jogger|t-?shirt|boot/.test(candidateText)) score -= 10;
  }
  return score;
}

function complementaryGroups(anchor: Product): string[] {
  const anchorGroup = groupKeyFor(anchor);
  const rules = GOES_WITH[anchor.category];
  return anchorGroup && rules ? (rules[anchorGroup] ?? []) : [];
}

function getPurposeAwareCandidates(anchor: Product, catalog: Product[]): Product[] | undefined {
  // Product-family relationships take precedence over broad electronics taxonomy. This keeps a
  // running-watch offer relevant to running (earbuds for music) and excludes cameras entirely.
  if (anchor.category === "electronics" && productFamilyFor(anchor) === "running_smartwatch") {
    return catalog.filter(
      (product) =>
        product.id !== anchor.id &&
        product.category === "electronics" &&
        productFamilyFor(product) === "running_wireless_earbuds" &&
        nestedBoolean(product, "connectivity", "fast_pairing") &&
        nestedBoolean(product, "connectivity", "multipoint") &&
        nestedBoolean(product, "workout", "sweat_resistant") &&
        nestedBoolean(product, "workout", "secure_fit"),
    );
  }

  // Do not promote a much more expensive running watch after someone searched for earbuds. The
  // active demo has no suitable earbud add-on (case/charger) yet, so no offer is better.
  if (anchor.category === "electronics" && productFamilyFor(anchor) === "running_wireless_earbuds") {
    return [];
  }

  return undefined;
}

// Same-category products whose taxonomy group is a documented "goes-with" of the anchor's group.
// Used both for the discounted bundle offer (getBundleSuggestions) and for find_complementary_product,
// which ranks within this same candidate pool but without a discount attached.
export function getComplementaryCandidates(anchor: Product, catalog: Product[]): Product[] {
  const purposeAware = getPurposeAwareCandidates(anchor, catalog);
  if (purposeAware) return purposeAware;

  const groups = complementaryGroups(anchor);

  return catalog.filter(
    (p) => p.id !== anchor.id && p.category === anchor.category && groups.includes(groupKeyFor(p) ?? ""),
  );
}

export function getBundleSuggestions(anchor: Product, catalog: Product[], context: BundleContext = {}): BundleSuggestion {
  const anchorGroup = groupKeyFor(anchor);
  const candidates = getComplementaryCandidates(anchor, catalog);
  const groupOrder = complementaryGroups(anchor);
  const sortedCandidates = [...candidates].sort((left, right) => {
    const leftGroupOrder = groupOrder.indexOf(groupKeyFor(left) ?? "");
    const rightGroupOrder = groupOrder.indexOf(groupKeyFor(right) ?? "");
    const leftScore = anchor.category === "clothing" ? apparelCompatibilityScore(anchor, left, context) : 0;
    const rightScore = anchor.category === "clothing" ? apparelCompatibilityScore(anchor, right, context) : 0;
    return rightScore - leftScore || leftGroupOrder - rightGroupOrder || left.title.localeCompare(right.title);
  });
  const usedGroups = new Set<string>();
  const selected = sortedCandidates.filter((product) => {
    const group = groupKeyFor(product) ?? productFamilyFor(product) ?? product.id;
    if (usedGroups.has(group)) return false;
    usedGroups.add(group);
    return true;
  });

  const items = selected.slice(0, MAX_SUGGESTIONS).map((product) => ({
    product,
    discountPercent: BUNDLE_DISCOUNT_PERCENT,
    reason: `Suggested complement for ${anchor.title} (${anchorGroup ?? productFamilyFor(anchor)} → ${groupKeyFor(product) ?? productFamilyFor(product)}); bundle discount applied to the add-on.`,
  }));

  return { anchor, items };
}
