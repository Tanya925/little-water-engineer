// Workers AI 回應格式工具：將不同模型的文字或 OpenAI 相容 choices 格式統一為可處理文字。
// 此檔沒有路由、密鑰或資料庫責任，讓正式整站 Worker 不必保留舊的內部 AI API。
export function modelText(result) {
  const output = result?.response ?? result?.choices?.[0]?.message?.content;
  if (typeof output === "string") return output;
  if (output && typeof output === "object" && !Array.isArray(output)) return JSON.stringify(output);
  return null;
}
