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

  // 70 additional fixtures added on top of the original 30 (same synthetic-price approach,
  // deterministic per article id, banded per product_group_name to match the ranges above).
  "0112679052": 27,  // SWEATSHIRT  OC (Garment Upper body)
  "0118458003": 28,  // Jerry jogger bottoms (Garment Lower body)
  "0146721002": 8,   // Hair Ring (Accessories)
  "0176754001": 16,  // 2 Row Braided Headband (1) (Accessories)
  "0202017055": 31,  // Rihanna dress (Garment Full body)
  "0212042036": 54,  // Mimmi sneaker (Shoes)
  "0357792008": 8,   // Cool Alessa Cat (Accessories)
  "0398089023": 53,  // Shorts R.W Bargain (Garment Lower body)
  "0436570026": 22,  // Moscow Cross Bag (Accessories)
  "0443860014": 45,  // S/S Polo Highline (Garment Upper body)
  "0469562036": 16,  // Skinny denim (1) (Garment Lower body)
  "0482638006": 71,  // DORIS SANDAL (Shoes)
  "0501616010": 30,  // FRAME Easy Iron (Garment Upper body)
  "0502175002": 31,  // BB Kevin Trs (Garment Lower body)
  "0504113004": 86,  // Zoo (Garment Full body)
  "0504890004": 23,  // Flirty Timmy studs (Accessories)
  "0512630003": 76,  // OL TRANCE (Shoes)
  "0515692016": 31,  // Ripley r-neck (Garment Upper body)
  "0524906002": 24,  // Sierra cross bag (Accessories)
  "0525500008": 41,  // Mike jogger (Garment Lower body)
  "0528111002": 39,  // Carried away dress (Garment Full body)
  "0534181008": 26,  // Femme (1) (Garment Upper body)
  "0539499002": 32,  // Carolina Ankel Padding boot (Shoes)
  "0546406001": 22,  // Rexona mini skirt (Garment Lower body)
  "0548388013": 23,  // Marissa (Garment Upper body)
  "0552272001": 10,  // Cool Hedda Choker (Accessories)
  "0553873002": 83,  // Dragonfly (Garment Full body)
  "0555326011": 20,  // SKINNY TRASH 89 (Garment Lower body)
  "0556549001": 51,  // Georgia sandalette (Shoes)
  "0558282001": 28,  // TWIST running jacket (Garment Upper body)
  "0559854005": 9,   // Rodnay fancy/fun (Accessories)
  "0562657002": 12,  // Huwey braided hip belt (Accessories)
  "0564557002": 45,  // Abbe shorts Top product (Garment Lower body)
  "0565855004": 56,  // Wild Slippers (Shoes)
  "0568456020": 36,  // SS Linen Mot TVP R (Garment Upper body)
  "0571656002": 65,  // Stella Set (Garment Full body)
  "0572998012": 17,  // Beverly HW Loose Mom Fit Dnm (Garment Lower body)
  "0576387003": 48,  // Freddan canvas boot (Shoes)
  "0576558001": 28,  // ARABELLA boxy cardigan (Garment Upper body)
  "0579504001": 17,  // BENNO (Accessories)
  "0581363013": 60,  // Scallop ballerina (Shoes)
  "0582247002": 63,  // SUSS trousers (Garment Lower body)
  "0584969001": 69,  // Goal dress (Garment Full body)
  "0586813003": 33,  // SNOW Mockneck cashmere (Garment Upper body)
  "0589229006": 77,  // BESS (Shoes)
  "0592959001": 38,  // SKINNY F.B (Garment Lower body)
  "0597333002": 23,  // Apollo s/s tee (Garment Upper body)
  "0598397007": 33,  // Enrique fancy sneaker (Shoes)
  "0599074003": 52,  // Piper shirt dress W (Garment Full body)
  "0601788001": 60,  // Elise wide printed (Garment Lower body)
  "0609405001": 35,  // &DENIM Jacket black jewel (Garment Upper body)
  "0609638001": 64,  // Minna leather ballerina SG (Shoes)
  "0611930001": 45,  // Lydia one shoulder dress (Garment Full body)
  "0619198003": 71,  // One dance (Garment Full body)
  "0619229003": 73,  // Billy softie (Shoes)
  "0624636002": 15,  // Jessie (Accessories)
  "0626261003": 39,  // MARAL DRESS (Garment Full body)
  "0636082001": 50,  // MIGHETTO onepiece (Garment Full body)
  "0642929006": 27,  // Evelina Dress (Garment Full body)
  "0650534001": 54,  // Weekend Bag Paul PU (Bags)
  "0682238003": 58,  // NAV MINI BACK PACK (Bags)
  "0682238030": 40,  // NAV MINI BACK PACK (Bags)
  "0721805001": 44,  // Sara hobo bag (Bags)
  "0721805010": 56,  // Sara hobo bag (Bags)
  "0736631005": 51,  // Jalle backpack (Bags)
  "0753475001": 65,  // MINDY SHOPPER (Bags)
  "0753475008": 65,  // MINDY SHOPPER (Bags)
  "0753475022": 58,  // MINDY SHOPPER (Bags)
  "0753475025": 60,  // MINDY SHOPPER (Bags)
  "0753475028": 54,  // MINDY SHOPPER (Bags)
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
  /** Local file, relative to the repo root -- for fixtures with an original illustration
   *  instead of a real source-catalog photo (e.g. no licensable Amazon URL). */
  image_path?: string | null;
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
      imagePath: r.image_path ?? null,
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
