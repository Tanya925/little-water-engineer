import { test } from "node:test";
import { strict as assert } from "node:assert";
import { titleMatchScore, findRelatedTitleIds } from "../src/d1-ai.js";

test("matches partial material names while requiring multiple shared fragments", async () => {
  const rows = [
    { id: "guide", title: "流力第一章｜國考流力Chap1重點導讀" },
    { id: "exam", title: "流力第一章｜國考題目" },
    { id: "other", title: "流力第一章｜水流基本觀念" },
  ];
  const db = { prepare: () => ({ all: async () => ({ results: rows }) }) };
  assert.ok(titleMatchScore(rows[0].title, "國考重點導讀") > titleMatchScore(rows[1].title, "國考重點導讀"));
  assert.deepEqual(await findRelatedTitleIds(db, "國考重點導讀"), ["guide"]);
  assert.deepEqual(await findRelatedTitleIds(db, "完全無關"), []);
});
