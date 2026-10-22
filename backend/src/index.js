// 主要功能：提供受密鑰保護的 Cloudflare AI API，執行文字向量化、Vectorize 寫入搜尋刪除與聊天模型呼叫。
/*
 * 這是 Cloudflare Worker，與 frontend/server 的 Node.js 服務分開執行。
 * 本機網站透過 /internal/ai 呼叫四種 action；綁定由 wrangler.jsonc 注入 env。
 * AI_SERVICE_TOKEN 只在伺服器及 Worker 保存，不提供給瀏覽器；健康檢查不呼叫模型。
 */
// 所有 Worker 回應都用 JSON 並停用快取，避免管理動作或 AI 回覆被邊緣快取重用。
// status 預設為成功的 200；驗證失敗時由各分支傳入對應的 4xx／5xx。
const json = (body, status = 200) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
const EMBEDDING_MODEL = "@cf/baai/bge-m3";
const CHAT_MODEL = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

// 統一模型回覆格式：支援文字、結構化 JSON 及 choices，讓 Node.js 呼叫端收到一致的 text。
export function modelText(result) {
  // Workers AI 的結構化回覆可能已是物件，也可能採 OpenAI 相容的 choices 格式；
  // 這裡只負責取出內容，不在 Worker 端判斷回答是否正確。
  const output = result?.response ?? result?.choices?.[0]?.message?.content;
  if (typeof output === "string") {
    return output;
  }
  if (output && typeof output === "object" && !Array.isArray(output)) {
    return JSON.stringify(output);
  }

  return null;
}

// 把一批文字轉為向量；逐一確認是 1024 維有限數值，避免寫入與索引規格不符的資料。
async function embeddings(env, texts) {
  const result = await env.AI.run(EMBEDDING_MODEL, { text: texts });
  const data = result.data;
  if (
    !Array.isArray(data) ||
    data.length !== texts.length ||
    data.some((v) => !Array.isArray(v) || v.length !== 1024 || v.some((n) => !Number.isFinite(n)))
  ) {
    throw new Error("Unexpected embedding dimensions");
  }

  return data;
}

export default {
  // Worker 只有健康檢查和內部 AI 入口。每個請求先驗證路徑、密鑰及方法，
  // 通過後才讀取本文與呼叫付費的 AI／Vectorize 綁定。
  async fetch(request, env) {
    const path = new URL(request.url).pathname;
    if (path === "/api/health" && request.method === "GET") {
      return json({ ok: true, service: "little-water-engineer-ai" });
    }
    if (path !== "/internal/ai") {
      return json({ error: "Not found" }, 404);
    }
    // 不提供瀏覽器 CORS 存取；只有網站的 Node.js 伺服器持有這組權杖。
    // 使用 timing-safe 比對在此幫助有限，因為 Cloudflare 網路延遲遠大於字串比對差異。
    if (
      !env.AI_SERVICE_TOKEN ||
      request.headers.get("Authorization") !== `Bearer ${env.AI_SERVICE_TOKEN}`
    ) {
      return json({ error: "Unauthorized" }, 401);
    }
    if (request.method !== "POST") {
      return json({ error: "Method not allowed" }, 405);
    }
    try {
      if (!request.headers.get("content-type")?.startsWith("application/json")) {
        return json({ error: "Invalid content type" }, 400);
      }
      const reader = request.body?.getReader();
      if (!reader) {
        return json({ error: "Missing body" }, 400);
      }
      const parts = [];
      let size = 0;

      // 以串流方式累計本文並在 128 KiB 立即停止，避免先 request.json() 後才發現
      // 請求過大。parts 最後才合併，確保多個網路區塊不會被誤當成獨立 JSON。
      while (true) {
        const { done, value } = await reader.read();
        if (done) {
          break;
        }
        size += value.byteLength;
        if (size > 128 * 1024) {
          await reader.cancel();

          return json({ error: "Body too large" }, 413);
        }
        parts.push(value);
      }
      const bytes = new Uint8Array(size);
      let offset = 0;
      for (const part of parts) {
        bytes.set(part, offset);
        offset += part.byteLength;
      }
      const body = JSON.parse(new TextDecoder().decode(bytes));

      // 片段 ID 由本機服務產生，格式為 32 位教材 ID、版本與序號。
      // 嚴格限制格式可避免任意 ID 被拿來覆寫或刪除索引內其他資料。
      const validId = (id) =>
        typeof id === "string" && /^[a-f0-9]{32}-\d+-\d+$/.test(id) && id.length <= 64;
      // 寫入：每段文字先取得 embedding，再以含版本的 ID 寫入指定 namespace。
      if (body.action === "upsert") {
        if (
          !Array.isArray(body.chunks) ||
          !body.chunks.length ||
          body.chunks.length > 8 ||
          body.chunks.some(
            (c) =>
              !validId(c.id) ||
              typeof c.text !== "string" ||
              !c.text.trim() ||
              c.text.length > 2000,
          )
        ) {
          return json({ error: "Invalid chunks" }, 400);
        }
        const values = await embeddings(
          env,
          body.chunks.map((c) => c.text),
        );
        const result = await env.VECTORIZE.upsert(
          body.chunks.map((c, i) => ({
            id: c.id,
            values: values[i],
            namespace: env.VECTOR_NAMESPACE || "water-materials-v1",
          })),
        );

        return json({ mutationId: result.mutationId });
      }
      // 刪除：由本機同步流程提供舊片段 ID，最多一批 100 筆；不是刪除整個索引。
      if (body.action === "delete") {
        if (
          !Array.isArray(body.ids) ||
          !body.ids.length ||
          body.ids.length > 100 ||
          !body.ids.every(validId)
        ) {
          return json({ error: "Invalid IDs" }, 400);
        }
        const result = await env.VECTORIZE.deleteByIds(body.ids);

        return json({ mutationId: result.mutationId });
      }
      // 搜尋：問題先向量化，取前 50 個候選；門檻、版本和來源驗證交回本機服務。
      if (body.action === "query") {
        if (typeof body.text !== "string" || !body.text.trim() || body.text.length > 4000) {
          return json({ error: "Invalid query" }, 400);
        }
        const values = await embeddings(env, [body.text]);
        const result = await env.VECTORIZE.query(values[0], {
          topK: 50,
          returnValues: false,
          returnMetadata: "none",
          namespace: env.VECTOR_NAMESPACE || "water-materials-v1",
        });

        return json({ matches: result.matches.map(({ id, score }) => ({ id, score })) });
      }
      // 生成：只接收本機服務組好的 system／user 兩則訊息，不由瀏覽器直接指定規則。
      if (body.action === "chat") {
        if (
          !Array.isArray(body.messages) ||
          body.messages.length !== 2 ||
          body.messages[0]?.role !== "system" ||
          body.messages[1]?.role !== "user" ||
          body.messages.some((m) => typeof m.content !== "string" || m.content.length > 30000)
        ) {
          return json({ error: "Invalid messages" }, 400);
        }
        const result = await env.AI.run(CHAT_MODEL, {
          messages: body.messages,
          max_tokens: 1800,
          temperature: 0.15,
        });
        const text = modelText(result);
        if (!text) {
          throw new Error("Missing model response");
        }

        return json({ text });
      }

      return json({ error: "Unknown action" }, 400);
    } catch (error) {
      const code =
        /\b(?:10\d{3}|[45]\d{2,3})\b/.exec(String(error?.message || ""))?.[0] || "unknown";
      console.error(
        "AI request failed",
        error instanceof Error ? error.name : "UnknownError",
        "code",
        code,
      );

      return json(
        { error: error instanceof SyntaxError ? "Invalid JSON" : "AI service unavailable" },
        error instanceof SyntaxError ? 400 : 503,
      );
    }
  },
};
