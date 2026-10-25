import { test } from "node:test";
import { strict as assert } from "node:assert";
import { validatedSearchPlan } from "../src/site-worker.js";

const candidates = [{ key: "ref:week25", mentionedIn: "week2-5 和 102地特-4" }, { key: "ref:102地特4", mentionedIn: "week2-5 和 102地特-4" }];
const result = (plan) => ({ response: JSON.stringify(plan) });

test("accepts a model-selected prior reference or a new conceptual query", () => {
  assert.deepEqual(validatedSearchPlan(result({ searchQuery: "102地特-4 解題步驟", materialKeys: ["ref:102地特4"], ambiguous: false }), candidates), { searchQuery: "102地特-4 解題步驟", materialKeys: ["ref:102地特4"], ambiguous: false });
  assert.deepEqual(validatedSearchPlan(result({ searchQuery: "質量是什麼", materialKeys: [], ambiguous: false }), candidates), { searchQuery: "質量是什麼", materialKeys: [], ambiguous: false });
});

test("rejects invented references and invalid model plans", () => {
  assert.equal(validatedSearchPlan(result({ searchQuery: "題目", materialKeys: ["ref:999地特1"], ambiguous: false }), candidates), null);
  assert.equal(validatedSearchPlan(result({ searchQuery: "題目", materialKeys: [], ambiguous: "false" }), candidates), null);
  assert.equal(validatedSearchPlan({ response: "truncated" }, candidates), null);
});
