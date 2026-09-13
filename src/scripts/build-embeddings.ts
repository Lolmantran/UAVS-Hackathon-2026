// Manually-run CLI: embeds the full catalog and writes vectors into sqlite-vec.
// Run with: npx tsx src/scripts/build-embeddings.ts
// Requires GEMINI_API_KEY to be set (see src/config/env.ts) — makes one live embedContent call
// per product (text + image together, gemini-embedding-2 is natively multimodal). Safe to
// interrupt and re-run (e.g. after swapping to a fresh free-tier API key) — already-embedded
// products are skipped, so no quota is wasted redoing them.
import path from "node:path";
import { loadCatalogByCategory } from "../catalog/loader.js";
import { generateEmbedding } from "../embedding/gemini.js";
import { hasEmbedding, openVectorStore, pruneEmbeddings, upsertEmbedding } from "../embedding/vectorStore.js";

const DB_PATH = path.resolve(process.cwd(), "var/catalog.vec.sqlite");

// Each product needs 1-2 sequential Gemini calls (caption + embed), and each call has multi-second
// latency — running products in bounded-concurrency batches instead of one at a time cuts total
// build time roughly by CONCURRENCY without bursting past free-tier per-minute rate limits.
const CONCURRENCY = 1;

function logCooldown(waitMs: number): void {
  console.log(`  cooling down ${(waitMs / 1000).toFixed(1)}s (free-tier rate limit)...`);
}

async function embedProduct(product: import("../types/catalog.js").Product): Promise<number[] | null> {
  // A remote imageUrl (electronics/skincare/home-goods) or a local imagePath (clothing) goes
  // into the same embedContent call as embeddingText — one vector per product, no captioning
  // round-trip.
  const image = product.imageUrl
    ? { imageUrl: product.imageUrl }
    : product.imagePath
      ? { imagePath: product.imagePath }
      : undefined;

  try {
    return await generateEmbedding({ text: product.embeddingText, image }, logCooldown);
  } catch (err) {
    // A single rate-limited/failed embed call shouldn't kill the whole batch — skip this
    // product, it can be picked up by re-running the script (upsertEmbedding is idempotent).
    console.error(`  [warn] embed failed for ${product.id}, skipping:`, (err as Error).message);
    return null;
  }
}

async function main() {
  const byCategory = loadCatalogByCategory();
  const store = openVectorStore(DB_PATH);
  const activeIds = new Set(Object.values(byCategory).flat().map((product) => product.id));
  const pruned = pruneEmbeddings(store, activeIds);
  if (pruned > 0) console.log(`Pruned ${pruned} stale embedding(s)`);

  for (const [category, products] of Object.entries(byCategory)) {
    let done = 0;
    // Free-tier quota (RPM and, more importantly, RPD) is scarce and shared across restarts —
    // never re-spend it on a product that's already embedded from a prior run/API key.
    const pending = products.filter((p) => !hasEmbedding(store, p.id));
    const skipped = products.length - pending.length;
    if (skipped > 0) {
      done = skipped;
      console.log(`${category}: skipping ${skipped}/${products.length} already embedded`);
    }

    for (let i = 0; i < pending.length; i += CONCURRENCY) {
      const batch = pending.slice(i, i + CONCURRENCY);
      const embeddings = await Promise.all(batch.map((p) => embedProduct(p)));
      for (let j = 0; j < batch.length; j++) {
        const embedding = embeddings[j];
        if (embedding) {
          upsertEmbedding(store, batch[j].id, embedding);
        }
        done += 1;
        console.log(`${category}: ${done}/${products.length}`);
      }
    }
  }

  console.log(`Done. Vector store written to ${DB_PATH}`);
}

main().catch((err) => {
  console.error("build-embeddings failed:", err);
  process.exitCode = 1;
});
