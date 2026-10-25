import { test } from "node:test";
import { strict as assert } from "node:assert";
import { validatedSearchPlan } from "../src/site-worker.js";
const previous = ["我不會week2-5和國考102地特-4", "國考那個解題步驟可以再詳細一點嗎"];
const result = (searchQuery) => ({ response: JSON.stringify({ searchQuery }) });

test("retains an earlier reference when the rewritten question identifies it", () => {
  assert.deepEqual(validatedSearchPlan(result("102地特-4 的解題步驟"), previous, "國考那個詳細點"), { searchQuery: "102地特-4 的解題步驟", references: ["102地特4"] });
});

test("accepts a reference from the third most recent question", () => {
  const history = ["請教我 102地特-4", "什麼是邊界層", "為什麼要積分"];
  assert.deepEqual(validatedSearchPlan(result("102地特-4 解題步驟"), history, "再詳細說明"), { searchQuery: "102地特-4 解題步驟", references: ["102地特4"] });
});

test("searches a new concept without inheriting earlier materials", () => {
  assert.deepEqual(validatedSearchPlan(result("什麼是質量？"), previous, "那所以說啥是質量阿"), { searchQuery: "什麼是質量？", references: [] });
});

test("never locks to a model-invented reference and rejects invalid plans", () => {
  assert.deepEqual(validatedSearchPlan(result("999地特-1"), previous, "請解釋"), { searchQuery: "999地特-1", references: [] });
  assert.equal(validatedSearchPlan({ response: "truncated" }, previous, "請解釋"), null);
});
