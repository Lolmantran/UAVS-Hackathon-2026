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

interface BundlingMetadata {
  targets: string[];
  roles: string[];
  compatibilityTags: string[];
  offerEligible: boolean;
  priority: number;
}

function strings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

function bundlingMetadata(product: Product): BundlingMetadata {
  const structured = product.attributes.structured_attributes;
  const raw =
    structured && typeof structured === "object"
      ? (structured as Record<string, unknown>).bundling
      : undefined;
  const metadata = raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  return {
    targets: strings(metadata.targets),
    roles: strings(metadata.roles),
    compatibilityTags: strings(metadata.compatibility_tags),
    offerEligible: metadata.offer_eligible === true,
    priority: typeof metadata.priority === "number" ? metadata.priority : 0,
  };
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

function metadataCandidates(anchor: Product, catalog: Product[]): Product[] | undefined {
  const anchorMetadata = bundlingMetadata(anchor);
  if (anchorMetadata.targets.length === 0) return undefined;
  return catalog.filter((product) => {
    const candidateMetadata = bundlingMetadata(product);
    return (
      product.id !== anchor.id &&
      product.category === anchor.category &&
      candidateMetadata.offerEligible &&
      candidateMetadata.roles.some((role) => anchorMetadata.targets.includes(role))
    );
  });
}

function candidateKey(anchor: Product, candidate: Product): string {
  const targets = bundlingMetadata(anchor).targets;
  const role = bundlingMetadata(candidate).roles.find((item) => targets.includes(item));
  return role ?? groupKeyFor(candidate) ?? productFamilyFor(candidate) ?? candidate.id;
}

function candidateOrder(anchor: Product, candidate: Product): number {
  const targets = bundlingMetadata(anchor).targets;
  const role = bundlingMetadata(candidate).roles.find((item) => targets.includes(item));
  if (role) return targets.indexOf(role);
  return complementaryGroups(anchor).indexOf(groupKeyFor(candidate) ?? "");
}

function metadataCompatibilityScore(anchor: Product, candidate: Product): number {
  const anchorTags = new Set(bundlingMetadata(anchor).compatibilityTags);
  const candidateMetadata = bundlingMetadata(candidate);
  const sharedTags = candidateMetadata.compatibilityTags.filter((tag) => anchorTags.has(tag)).length;
  return candidateMetadata.priority + sharedTags * 10;
}

// Same-category products whose taxonomy group is a documented "goes-with" of the anchor's group.
// Used both for the discounted bundle offer (getBundleSuggestions) and for find_complementary_product,
// which ranks within this same candidate pool but without a discount attached.
export function getComplementaryCandidates(anchor: Product, catalog: Product[]): Product[] {
  const metadataDriven = metadataCandidates(anchor, catalog);
  if (metadataDriven) return metadataDriven;

  const groups = complementaryGroups(anchor);

  return catalog.filter(
    (p) => p.id !== anchor.id && p.category === anchor.category && groups.includes(groupKeyFor(p) ?? ""),
  );
}

export function getBundleSuggestions(anchor: Product, catalog: Product[], context: BundleContext = {}): BundleSuggestion {
  const anchorGroup = groupKeyFor(anchor);
  const candidates = getComplementaryCandidates(anchor, catalog);
  const sortedCandidates = [...candidates].sort((left, right) => {
    const leftScore =
      anchor.category === "clothing" ? apparelCompatibilityScore(anchor, left, context) : metadataCompatibilityScore(anchor, left);
    const rightScore =
      anchor.category === "clothing" ? apparelCompatibilityScore(anchor, right, context) : metadataCompatibilityScore(anchor, right);
    return rightScore - leftScore || candidateOrder(anchor, left) - candidateOrder(anchor, right) || left.title.localeCompare(right.title);
  });
  const usedGroups = new Set<string>();
  const selected = sortedCandidates.filter((product) => {
    const group = candidateKey(anchor, product);
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
