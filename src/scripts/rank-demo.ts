// Throwaway-style demo (kept per spec's "leave at most one clearly-named script" option).
// Run with: npx tsx src/scripts/rank-demo.ts
import { loadCatalogByCategory } from "../catalog/loader.js";
import { rankProducts } from "../ranking/rank.js";
import type { Criterion } from "../types/pipeline.js";

const criteria: Criterion[] = [
  {
    attribute: "skin_concern",
    description: "suitable for oily or acne-prone skin",
    importance: "mandatory",
    rawPhrase: "I have oily, acne-prone skin",
  },
  {
    attribute: "fragrance",
    description: "fragrance-free",
    importance: "preferred",
    rawPhrase: "prefer something fragrance-free",
  },
];

const { skincare } = loadCatalogByCategory();

// Fake similarity scores (a real run would come from the embedding/vector-search module) —
// just enough variation here to prove the tiebreak ordering works.
const similarities = new Map<string, number>(skincare.map((p, i) => [p.id, 1 - i / skincare.length]));

const result = rankProducts(criteria, skincare, similarities);

console.log(`\n=== RANKED (eligible) — ${result.ranked.length} ===`);
for (const s of result.ranked.slice(0, 8)) {
  console.log(`\n${s.product.id} | ${s.product.title.slice(0, 70)}`);
  console.log(`  eligible=${s.eligible} similarity=${s.similarity.toFixed(2)}`);
  console.log(`  justification: ${s.justification}`);
  for (const e of s.evaluations) {
    console.log(`    [${e.criterion.importance}] ${e.criterion.attribute}: ${e.outcome} — ${e.evidence}`);
  }
}

console.log(`\n=== SECONDARY (ineligible, closest first) — ${result.secondary.length} ===`);
for (const s of result.secondary.slice(0, 5)) {
  console.log(`\n${s.product.id} | ${s.product.title.slice(0, 70)}`);
  console.log(`  eligible=${s.eligible} similarity=${s.similarity.toFixed(2)}`);
  console.log(`  justification: ${s.justification}`);
  for (const e of s.evaluations) {
    console.log(`    [${e.criterion.importance}] ${e.criterion.attribute}: ${e.outcome} — ${e.evidence}`);
  }
}
