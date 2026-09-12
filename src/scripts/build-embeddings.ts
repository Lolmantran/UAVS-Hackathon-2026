// Manually-run CLI: embeds the full catalog and writes vectors into sqlite-vec.
// Run with: npx tsx src/scripts/build-embeddings.ts
// Requires GEMINI_API_KEY to be set (see src/config/env.ts) — makes one live API call per
// product (plus one extra captioning call per product with an imageUrl).
import path from "node:path";
import { loadCatalogByCategory } from "../catalog/loader.js";
import { describeImage, generateTextEmbedding } from "../embedding/gemini.js";
import { openVectorStore, upsertEmbedding } from "../embedding/vectorStore.js";

const DB_PATH = path.resolve(process.cwd(), "var/catalog.vec.sqlite");

async function main() {
  const byCategory = loadCatalogByCategory();
  const store = openVectorStore(DB_PATH);

  for (const [category, products] of Object.entries(byCategory)) {
    let done = 0;
    for (const product of products) {
      // When an imageUrl exists (electronics/skincare/home-goods), caption it and concatenate
      // the caption onto embeddingText before a single embed call — cheaper than embedding
      // text and image separately and averaging, and keeps one vector per product.
      let textToEmbed = product.embeddingText;
      if (product.imageUrl) {
        try {
          const caption = await describeImage({ imageUrl: product.imageUrl });
          textToEmbed = `${textToEmbed}. ${caption}`;
        } catch (err) {
          console.error(`  [warn] caption failed for ${product.id}, embedding text only:`, (err as Error).message);
        }
      }

      const embedding = await generateTextEmbedding(textToEmbed);
      upsertEmbedding(store, product.id, embedding);

      done += 1;
      console.log(`${category}: ${done}/${products.length}`);
    }
  }

  console.log(`Done. Vector store written to ${DB_PATH}`);
}

main().catch((err) => {
  console.error("build-embeddings failed:", err);
  process.exitCode = 1;
});
