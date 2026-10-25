import { test } from "node:test";
import { strict as assert } from "node:assert";
import { DatabaseSync } from "node:sqlite";
import { resolveMaterialIdChunks, resolveMaterialReferenceChunks } from "../src/d1-ai.js";

function database() {
  const sqlite = new DatabaseSync(":memory:");
  sqlite.exec(`CREATE TABLE ai_materials (id TEXT, title TEXT, topic TEXT, source_url TEXT, deleted INTEGER, status TEXT, index_state TEXT, revision INTEGER);
    CREATE TABLE ai_chunks (id TEXT, content TEXT, revision INTEGER, material_id TEXT);
    CREATE TABLE resource_materials (ai_material_id TEXT, image_url TEXT, images_json TEXT);`);
  return { sqlite, db: { prepare: (sql) => ({ bind: (...args) => ({ all: async () => ({ results: sqlite.prepare(sql).all(...args) }) }) }) } };
}

test("exact lookup retrieves all chunks in numeric order and retains bounded title search", async () => {
  const { sqlite, db } = database();
  sqlite.prepare("INSERT INTO ai_materials VALUES (?,?,?,?,?,?,?,?)").run("a", "102地特-4", "", "", 0, "published", "ready", 1);
  for (let i = 0; i < 12; i++) sqlite.prepare("INSERT INTO ai_chunks VALUES (?,?,?,?)").run(`a-1-${i}`, `part ${i}`, 1, "a");
  const byReference = await resolveMaterialReferenceChunks(db, "102地特4");
  assert.equal(byReference.length, 12);
  assert.deepEqual(byReference.map((row) => row.content), Array.from({ length: 12 }, (_, i) => `part ${i}`));
  assert.equal((await resolveMaterialIdChunks(db, ["a"])).length, 12);
  assert.equal((await resolveMaterialIdChunks(db, ["a"], 3)).length, 3);
  sqlite.close();
});

test("duplicate references are rejected even when the first material has more than five chunks", async () => {
  const { sqlite, db } = database();
  for (const id of ["a", "b"]) sqlite.prepare("INSERT INTO ai_materials VALUES (?,?,?,?,?,?,?,?)").run(id, "102地特-4", "", "", 0, "published", "ready", 1);
  for (let i = 0; i < 8; i++) sqlite.prepare("INSERT INTO ai_chunks VALUES (?,?,?,?)").run(`a-1-${i}`, "a", 1, "a");
  sqlite.prepare("INSERT INTO ai_chunks VALUES (?,?,?,?)").run("b-1-0", "b", 1, "b");
  assert.deepEqual(await resolveMaterialReferenceChunks(db, "102地特4"), []);
  sqlite.close();
});
