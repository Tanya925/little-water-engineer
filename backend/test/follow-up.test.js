import { test } from "node:test";
import { strict as assert } from "node:assert";
import { conversationMaterialSelection, isFollowUpQuestion } from "../src/site-worker.js";

test("selects the national exam from a prior question mentioning two materials", () => {
  const previous = ["我不會week2-5和國考102地特-4，請教我"];
  assert.deepEqual(conversationMaterialSelection("國考那個解題步驟可以再詳細一點嗎", previous), { references: ["102地特4"], ambiguous: false });
  assert.deepEqual(conversationMaterialSelection("那個再詳細一點", previous), { references: [], ambiguous: true });
});

test("treats an explicit new concept as a fresh question even after multiple materials", () => {
  const previous = ["我不會week2-5和國考102地特-4"];
  assert.equal(isFollowUpQuestion("那甚麼是質量阿到底"), false);
  assert.deepEqual(conversationMaterialSelection("那甚麼是質量阿到底", previous), { references: [], ambiguous: false });
});

test("uses the latest explicit material for an ordinary follow-up", () => {
  assert.deepEqual(conversationMaterialSelection("再詳細說明", ["week2-5", "102地特-4"]), { references: ["102地特4"], ambiguous: false });
});
