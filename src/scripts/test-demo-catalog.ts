import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { loadCatalogByCategory } from "../catalog/loader.js";
import { getBundleSuggestions } from "../bundling/engine.js";
import { rankProducts } from "../ranking/rank.js";
import type { Criterion } from "../types/pipeline.js";

const EXPECTED_FAMILIES = new Map([
  ["running_smartwatch", 8],
  ["running_wireless_earbuds", 8],
  ["outdoor_security_camera", 8],
  ["oily_skin_cleanser", 8],
]);

const byCategory = loadCatalogByCategory();
const nonClothing = [...byCategory.electronics, ...byCategory.skincare, ...byCategory["home-goods"]];

assert.equal(nonClothing.length, 47, "demo catalog should contain the expected non-clothing fixtures including dress watches");
assert.equal(byCategory.clothing.length, 100, "the merged clothing sample should contain the 100 current fixtures");
assert.ok(
  nonClothing.every((product) => product.imageUrl !== null || product.imagePath !== null),
  "every non-clothing fixture should expose a reusable illustrative image",
);

for (const [family, expectedCount] of EXPECTED_FAMILIES) {
  const records = nonClothing.filter((product) => product.attributes.product_family === family);
  assert.equal(records.length, expectedCount, `${family} should have eight controlled variants`);
  assert.equal(
    new Set(records.map((product) => product.attributes.variant_key)).size,
    expectedCount,
    `${family} variants should have unique variant keys`,
  );
  assert.ok(
    records.every((product) => product.attributes.structured_attributes),
    `${family} records should expose structured_attributes`,
  );
}

const watchCriteria: Criterion[] = [
  { attribute: "item_type", description: "smartwatch", importance: "mandatory", rawPhrase: "smart watch" },
  {
    attribute: "gps_pace_tracking",
    description: "built-in GPS for pace tracking",
    importance: "mandatory",
    rawPhrase: "GPS pace track",
  },
  {
    attribute: "heart_rate_tracking",
    description: "continuous heart-rate tracking",
    importance: "mandatory",
    rawPhrase: "heart beat tracking",
  },
  {
    attribute: "formal_suitability",
    description: "formal styling suitable for dates",
    importance: "preferred",
    rawPhrase: "formal dates",
  },
  {
    attribute: "running_suitability",
    description: "suitable for running workouts",
    importance: "mandatory",
    rawPhrase: "use for running",
  },
];

const watchPool = byCategory.electronics.filter(
  (product) => product.attributes.product_family === "running_smartwatch",
);
const watchRanking = rankProducts(watchCriteria, watchPool, new Map());
assert.deepEqual(
  watchRanking.ranked.map((result) => result.product.id),
  ["DEMO-WATCH-EXACT", "DEMO-WATCH-SPORT"],
  "watch exact match should lead the functional sport-only near match",
);
assert.deepEqual(
  new Set(watchRanking.secondary.map((result) => result.product.id)),
  new Set([
    "DEMO-WATCH-NO-GPS",
    "DEMO-WATCH-NO-HR",
    "DEMO-WATCH-NO-PACE",
    "DEMO-WATCH-NOT-RUNNING",
    "DEMO-WATCH-FITNESS-BAND",
    "DEMO-WATCH-ANALOG",
  ]),
  "watches missing mandatory sensors should only appear as secondary results",
);

const earbudsCriteria: Criterion[] = [
  {
    attribute: "item_type",
    description: "wireless earbuds",
    importance: "mandatory",
    rawPhrase: "earpods",
  },
  {
    attribute: "fast_connection",
    description: "fast Bluetooth pairing and reconnection",
    importance: "mandatory",
    rawPhrase: "fast connection",
  },
  {
    attribute: "multi_device_connection",
    description: "multipoint connection to multiple devices",
    importance: "mandatory",
    rawPhrase: "multi connection device",
  },
  {
    attribute: "workout_suitability",
    description: "sweat-resistant secure fit for running and casual workouts",
    importance: "mandatory",
    rawPhrase: "casual workout and running",
  },
];

const earbudsPool = byCategory.electronics.filter(
  (product) => product.attributes.product_family === "running_wireless_earbuds",
);
const earbudsRanking = rankProducts(earbudsCriteria, earbudsPool, new Map());
assert.deepEqual(
  earbudsRanking.ranked.map((result) => result.product.id),
  ["DEMO-BUDS-EXACT"],
  "only the earbuds fixture satisfying every mandatory feature should be eligible",
);
assert.deepEqual(
  new Set(earbudsRanking.secondary.map((result) => result.product.id)),
  new Set([
    "DEMO-BUDS-NO-MULTIPOINT",
    "DEMO-BUDS-NO-WORKOUT",
    "DEMO-BUDS-LEGACY",
    "DEMO-BUDS-NO-FAST",
    "DEMO-BUDS-LOOSE-FIT",
    "DEMO-BUDS-HEADSET",
    "DEMO-BUDS-WIRED",
  ]),
  "all controlled earbuds near misses should remain secondary",
);

const cameraCriteria: Criterion[] = [
  { attribute: "item_type", description: "security camera", importance: "mandatory", rawPhrase: "security camera" },
  { attribute: "night_vision", description: "night vision", importance: "mandatory", rawPhrase: "night vision" },
  { attribute: "local_storage", description: "local storage", importance: "mandatory", rawPhrase: "local storage" },
  {
    attribute: "weather_resistance",
    description: "weather-resistant and suitable for outdoor installation",
    importance: "mandatory",
    rawPhrase: "outdoor weather resistance",
  },
];
const cameraPool = byCategory.electronics.filter(
  (product) => product.attributes.product_family === "outdoor_security_camera",
);
const cameraRanking = rankProducts(cameraCriteria, cameraPool, new Map());
assert.deepEqual(
  cameraRanking.ranked.map((result) => result.product.id),
  ["DEMO-CAMERA-EXACT", "DEMO-CAMERA-EXACT-1080"],
  "both cameras satisfying every requested capability should be eligible",
);
assert.deepEqual(
  new Set(cameraRanking.secondary.map((result) => result.product.id)),
  new Set([
    "DEMO-CAMERA-NO-LOCAL",
    "DEMO-CAMERA-INDOOR",
    "DEMO-CAMERA-NO-NIGHT",
    "DEMO-CAMERA-NO-WEATHER",
    "DEMO-CAMERA-DOORBELL",
    "DEMO-CAMERA-MOUNT",
  ]),
  "camera capability and item-type failures should remain secondary",
);

const cleanserCriteria: Criterion[] = [
  { attribute: "item_type", description: "facial cleanser", importance: "mandatory", rawPhrase: "facial cleanser" },
  {
    attribute: "skin_concern",
    description: "suitable for oily and acne-prone skin",
    importance: "mandatory",
    rawPhrase: "oily acne-prone skin",
  },
  { attribute: "price_cap", description: "under $25", importance: "mandatory", rawPhrase: "under $25" },
  {
    attribute: "fragrance_free",
    description: "fragrance-free",
    importance: "preferred",
    rawPhrase: "preferably fragrance-free",
  },
];
const cleanserPool = byCategory.skincare.filter(
  (product) => product.attributes.product_family === "oily_skin_cleanser",
);
const cleanserRanking = rankProducts(cleanserCriteria, cleanserPool, new Map());
assert.deepEqual(
  cleanserRanking.ranked.map((result) => result.product.id),
  ["DEMO-CLEANSER-EXACT", "DEMO-CLEANSER-EXACT-FOAM", "DEMO-CLEANSER-FRAGRANCED"],
  "valid fragrance-free cleansers should lead the fragranced eligible near match",
);
assert.deepEqual(
  new Set(cleanserRanking.secondary.map((result) => result.product.id)),
  new Set([
    "DEMO-CLEANSER-DRY-SKIN",
    "DEMO-CLEANSER-OVER-BUDGET",
    "DEMO-CLEANSER-COMEDOGENIC",
    "DEMO-CLEANSER-BODY-WASH",
    "DEMO-CLEANSER-TONER",
  ]),
  "cleanser type, skin-suitability, and budget failures should remain secondary",
);

const clothingPath = path.resolve(process.cwd(), "data/clothing/products.json");
const clothingSource = JSON.parse(readFileSync(clothingPath, "utf8")) as unknown[];
assert.equal(clothingSource.length, 100, "clothing source should include the merged 100-record fixture set");

const dressAnchor = byCategory.clothing.find((product) => product.id === "0599102001");
assert.ok(dressAnchor, "the unchanged Polly dress fixture should be available for bundle tests");
const clothingBundle = getBundleSuggestions(dressAnchor, byCategory.clothing);
assert.equal(clothingBundle.items.length, 2, "a dress should produce two clothing bundle suggestions");
assert.ok(
  clothingBundle.items.every((item) => item.product.category === "clothing"),
  "clothing bundle suggestions should stay inside the clothing category",
);
assert.ok(
  clothingBundle.items.every((item) => item.product.priceUsd !== null),
  "synthetic clothing prices should make every clothing bundle priceable",
);

const watchAnchor = byCategory.electronics.find((product) => product.id === "DEMO-WATCH-EXACT");
assert.ok(watchAnchor, "the exact running watch fixture should be available for bundle tests");
const watchBundle = getBundleSuggestions(watchAnchor, byCategory.electronics, { query: "running with music" });
assert.deepEqual(
  watchBundle.items.map((item) => item.product.id),
  ["DEMO-BUDS-EXACT"],
  "a running watch should offer workout-ready running earbuds, never an unrelated electronics category",
);

const earbudsAnchor = byCategory.electronics.find((product) => product.id === "DEMO-BUDS-EXACT");
assert.ok(earbudsAnchor, "the exact earbuds fixture should be available for bundle tests");
assert.deepEqual(
  getBundleSuggestions(earbudsAnchor, byCategory.electronics).items.map((item) => item.product.id),
  ["DEMO-EARBUD-CASE", "DEMO-RUN-POWER"],
  "earbuds should receive a charging case and compact power bank through metadata-driven roles",
);

const cameraAnchor = byCategory.electronics.find((product) => product.id === "DEMO-CAMERA-EXACT");
assert.ok(cameraAnchor, "the exact camera fixture should be available for bundle tests");
assert.deepEqual(
  getBundleSuggestions(cameraAnchor, byCategory.electronics).items.map((item) => item.product.id),
  ["DEMO-CAMERA-MICROSD", "DEMO-CAMERA-MOUNT-ADDON"],
  "security cameras should receive local storage and a compatible mount through metadata-driven roles",
);

const cleanserAnchor = byCategory.skincare.find((product) => product.id === "DEMO-CLEANSER-EXACT");
assert.ok(cleanserAnchor, "the exact cleanser fixture should be available for bundle tests");
assert.deepEqual(
  getBundleSuggestions(cleanserAnchor, byCategory.skincare).items.map((item) => item.product.id),
  ["DEMO-CLEANSER-TONER", "DEMO-MOISTURIZER-OILY"],
  "a cleanser should lead to toner and lightweight moisturizer through metadata-driven roles",
);

const formalTop = byCategory.clothing.find((product) => product.id === "0572128005");
assert.ok(formalTop, "the ladieswear blouse fixture should be available for formal bundle tests");
const formalBundle = getBundleSuggestions(formalTop, byCategory.clothing, { query: "formal wedding outfit" });
assert.equal(
  formalBundle.items[0]?.product.attributes.product_group_name,
  "Garment Lower body",
  "a formal ladieswear upper-body item should lead with a lower-body complement",
);
assert.equal(
  formalBundle.items[0]?.product.attributes.index_group_name,
  "Ladieswear",
  "a formal ladieswear upper-body item should stay within the same audience group",
);

console.log("Demo catalog checks passed: catalog fixtures, local product imagery, and metadata-driven complements are valid.");
