import Database from "better-sqlite3";
import * as sqliteVec from "sqlite-vec";

const db = new Database(":memory:");
sqliteVec.load(db);

const [{ vec_version }] = db.prepare("select vec_version() as vec_version").all() as Array<{
  vec_version: string;
}>;
console.log("sqlite-vec version:", vec_version);

db.exec("create virtual table temp.vec_items using vec0(embedding float[4])");
const insert = db.prepare("insert into temp.vec_items(rowid, embedding) values (?, ?)");
insert.run(BigInt(1), new Float32Array([0.1, 0.1, 0.1, 0.1]));
insert.run(BigInt(2), new Float32Array([0.9, 0.9, 0.9, 0.9]));

const rows = db
  .prepare(
    `select rowid, distance from temp.vec_items
     where embedding match ? order by distance limit 5`,
  )
  .all(new Float32Array([0.1, 0.1, 0.1, 0.1]));

console.log("nearest neighbor query result:", rows);
