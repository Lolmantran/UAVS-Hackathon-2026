// Manual check of the embedding + vector search path, without the MCP server or intent extraction.
// Run with:
//   npx tsx src/scripts/search-demo.ts "pink hoodie"
//   npx tsx src/scripts/search-demo.ts "running shoes" --category clothing --top-k 5
//   npx tsx src/scripts/search-demo.ts --image data/images/0484108014.jpg
//   npx tsx src/scripts/search-demo.ts "same style but in black" --image https://example.com/a.jpg
// Makes one live embedContent call per run.
import { similaritySearch } from "../catalog/repository.js";
import { resolveImageToDataUri } from "../embedding/gemini.js";
import { PRODUCT_CATEGORIES, type ProductCategory } from "../types/catalog.js";

function parseArgs(argv: string[]) {
  let text: string | undefined;
  let image: string | undefined;
  let category: ProductCategory | undefined;
  let topK = 10;

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    if (arg === "--image") {
      image = argv[++i];
    } else if (arg === "--category") {
      const value = argv[++i] as ProductCategory;
      if (!PRODUCT_CATEGORIES.includes(value)) {
        throw new Error(`--category must be one of: ${PRODUCT_CATEGORIES.join(", ")}`);
      }
      category = value;
    } else if (arg === "--top-k") {
      topK = Number(argv[++i]);
      if (!Number.isInteger(topK) || topK < 1) throw new Error("--top-k must be a positive integer");
    } else {
      text = text ? `${text} ${arg}` : arg;
    }
  }

  if (!text && !image) {
    throw new Error('Give a query and/or --image, e.g. npx tsx src/scripts/search-demo.ts "pink hoodie"');
  }
  return { text, image, category, topK };
}

async function main() {
  const { text, image, category, topK } = parseArgs(process.argv.slice(2));

  const imageBase64 = image
    ? await resolveImageToDataUri(/^https?:\/\//.test(image) ? { imageUrl: image } : { imagePath: image })
    : undefined;

  console.log(`query: ${text ?? "(none)"} | image: ${image ?? "(none)"} | category: ${category ?? "all"} | topK: ${topK}`);

  const started = Date.now();
  const matches = await similaritySearch({ text, imageBase64 }, { category, topK });
  console.log(`${matches.length} match(es) in ${Date.now() - started} ms\n`);

  matches.forEach(({ product, similarity }, i) => {
    const price = product.priceUsd === null ? "" : ` $${product.priceUsd}`;
    console.log(
      `${String(i + 1).padStart(2)}. ${similarity.toFixed(4)}  [${product.category}] ${product.id}${price}  ${product.title.slice(0, 80)}`,
    );
  });
}

main().catch((err) => {
  console.error("search-demo failed:", (err as Error).message);
  process.exitCode = 1;
});
