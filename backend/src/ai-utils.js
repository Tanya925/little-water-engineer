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
