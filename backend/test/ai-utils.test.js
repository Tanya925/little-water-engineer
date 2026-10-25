import { test } from "node:test";
import { strict as assert } from "node:assert";
import { modelJSON } from "../src/ai-utils.js";

test("accepts Qwen thinking blocks and fenced JSON without exposing reasoning", () => {
  assert.deepEqual(modelJSON({ response: '<think>private reasoning</think>\n```json\n{"sufficient":true,"answer":"質量","usedChunkIds":["a"]}\n```' }),
    { sufficient: true, answer: "質量", usedChunkIds: ["a"] });
  assert.deepEqual(modelJSON({ choices: [{ message: { content: '{"searchQuery":"質量"}' } }] }), { searchQuery: "質量" });
});

test("rejects truncated thinking or invalid JSON", () => {
  assert.equal(modelJSON({ response: '<think>unfinished {"sufficient":true}' }), null);
  assert.equal(modelJSON({ response: '{"sufficient":true' }), null);
});
