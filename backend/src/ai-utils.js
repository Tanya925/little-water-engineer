/*
 * Workers AI 回應格式的邊界工具。Cloudflare 模型可能回傳 response 字串，也可能採
 * OpenAI 相容的 choices[0].message.content；本函式將兩者統一為文字，讓呼叫端只處理
 * 成功文字或 null。它不呼叫模型、不讀取 D1、也不處理金鑰，避免格式相容邏輯散落在路由。
 */
export function modelText(result) {
  const output = result?.response ?? result?.choices?.[0]?.message?.content;
  if (typeof output === "string") return output;
  if (output && typeof output === "object" && !Array.isArray(output)) return JSON.stringify(output);
  return null;
}

// Qwen3 有時會在最終內容前附上思考區塊。只移除完整的區塊，避免把截斷的
// 思考內容誤當成答案；沒有完整 JSON 時仍由呼叫端判定為服務異常。
export function modelJSON(result) {
  const text = modelText(result)?.trim();
  if (!text) return null;
  const jsonText = text.replace(/^(?:<think>[\s\S]*?<\/think>\s*)+/i, "")
    .replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "").trim();
  try {
    const parsed = JSON.parse(jsonText);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}
