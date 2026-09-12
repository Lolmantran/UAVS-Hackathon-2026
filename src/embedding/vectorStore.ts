import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";
import { mkdirSync } from "node:fs";
import path from "node:path";

export interface VectorStore {
  db: Database.Database;
  dimension: number;
}

// gemini-embedding-001's default output size (no outputDimensionality override in gemini.ts).
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
