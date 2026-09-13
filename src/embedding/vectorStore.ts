import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import { mkdirSync } from "node:fs";
import path from "node:path";

export interface VectorStore {
  db: Database.Database;
  dimension: number;
}

// Default output size of Gemini's embedding models (no outputDimensionality override in gemini.ts).
const DEFAULT_DIMENSION = 3072;

export interface OpenVectorStoreOptions {
  dimension?: number;
}

// Opens (or creates) the sqlite-vec db at dbPath. The vec0 table's dimension is fixed at
// creation time ("if not exists" is a no-op on a pre-existing db, even with a different
// `dimension` passed here) — delete the file to rebuild with a new embedding size.
export function openVectorStore(dbPath: string, opts: OpenVectorStoreOptions = {}): VectorStore {
  if (dbPath !== ":memory:") {
    mkdirSync(path.dirname(dbPath), { recursive: true });
  }

  const db = new Database(dbPath);
  sqliteVec.load(db);

  const dimension = opts.dimension ?? DEFAULT_DIMENSION;

  db.exec(`create virtual table if not exists vec_products using vec0(embedding float[${dimension}])`);
  // Side mapping table: vec0 requires an integer rowid, but product ids are strings
  // (H&M article ids, Amazon ASINs) — rowid is auto-assigned here and joined back on query.
  db.exec(`
    create table if not exists product_map (
      rowid integer primary key,
      product_id text not null unique
    )
  `);

  return { db, dimension };
}

// Lets a rebuild resume after an interruption (e.g. swapping to a new free-tier API key)
// without re-spending quota captioning/embedding products that already have a vector.
export function hasEmbedding(store: VectorStore, productId: string): boolean {
  const row = store.db.prepare("select 1 from product_map where product_id = ?").get(productId);
  return row !== undefined;
}

/** Remove vectors for products no longer present in the active catalog. */
export function pruneEmbeddings(store: VectorStore, activeProductIds: Set<string>): number {
  const rows = store.db.prepare("select rowid, product_id as productId from product_map").all() as Array<{
    rowid: number;
    productId: string;
  }>;
  const stale = rows.filter((row) => !activeProductIds.has(row.productId));
  if (stale.length === 0) return 0;

  const remove = store.db.transaction((records: typeof stale) => {
    const deleteVector = store.db.prepare("delete from vec_products where rowid = ?");
    const deleteMapping = store.db.prepare("delete from product_map where rowid = ?");
    for (const record of records) {
      deleteVector.run(BigInt(record.rowid));
      deleteMapping.run(record.rowid);
    }
  });
  remove(stale);
  return stale.length;
}

export function upsertEmbedding(store: VectorStore, productId: string, embedding: number[]): void {
  if (embedding.length !== store.dimension) {
    throw new Error(
      `Embedding length ${embedding.length} does not match vector store dimension ${store.dimension}`,
    );
  }

  const { db } = store;
  const existing = db
    .prepare("select rowid as rowid from product_map where product_id = ?")
    .get(productId) as { rowid: number } | undefined;

  let rowid: number;
  if (existing) {
    rowid = existing.rowid;
    // vec0 has no UPDATE-in-place for a single row's vector — delete then reinsert.
    db.prepare("delete from vec_products where rowid = ?").run(BigInt(rowid));
  } else {
    const info = db.prepare("insert into product_map (product_id) values (?)").run(productId);
    rowid = Number(info.lastInsertRowid);
  }

  // sqlite-vec's vec0 rejects a plain JS number rowid — must bind as BigInt.
  db.prepare("insert into vec_products (rowid, embedding) values (?, ?)").run(
    BigInt(rowid),
    new Float32Array(embedding),
  );
}

export function querySimilar(
  store: VectorStore,
  queryEmbedding: number[],
  opts: { topK?: number } = {},
): Array<{ productId: string; distance: number }> {
  const topK = opts.topK ?? 10;

  // The `k = ?` constraint (rather than an outer LIMIT) must sit directly on the vec0 knn
  // scan — sqlite-vec can't see a LIMIT applied only after the join to product_map.
  const rows = store.db
    .prepare(
      `select m.product_id as productId, v.distance as distance
       from (
         select rowid, distance from vec_products where embedding match ? and k = ?
       ) v
       join product_map m on m.rowid = v.rowid
       order by v.distance`,
    )
    .all(new Float32Array(queryEmbedding), topK) as Array<{ productId: string; distance: number }>;

  return rows.map((r) => ({ productId: r.productId, distance: r.distance }));
}
