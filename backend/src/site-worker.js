// Cloudflare 正式網站入口：公開 API 讀 D1，AI/Vectorize 內部端點沿用既有 Worker。
import { modelText } from "./ai-utils.js";
import { authenticate, sessionFor, signIn, signOut } from "./d1-auth.js";
import { adminDelete, adminExport, adminFind, adminList, adminPage, adminSave, importQuestions, savePage } from "./d1-admin.js";
import { resolveAIChunks } from "./d1-ai.js";
import {
  deleteResourceMaterial,
  deleteResourceMaterials,
  resyncResourceMaterial,
  saveResourceMaterial,
  syncResourceMetadata,
} from "./d1-materials.js";
import {
  gradeQuestion,
  listResources,
  listUpdates,
  listVideos,
  publicPage,
  quizCatalog,
  quizQuestions,
} from "./d1-public.js";

const json = (body, status = 200, headers = {}) =>
  Response.json(body, {
    status,
    headers: {
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      ...headers,
    },
  });
const quizTopics = ["柏努利與基礎流力", "搶救堰塞湖", "大地在搖晃", "超級颱風眼", "迷你都市淹水大作戰"];

async function readJSON(request, maxLength = 4096) {
  if (!request.headers.get("content-type")?.startsWith("application/json")) {
    throw new Error("Invalid body");
  }
  const text = await request.text();
  if (text.length > maxLength) throw new Error("Body too large");
  return JSON.parse(text);
}

function sameOrigin(request, origin) {
  const value = request.headers.get("origin");
  return !value || value === origin;
}

export default {
  async fetch(request, env, context) {
    const url = new URL(request.url);
    const { pathname } = url;

    if (!pathname.startsWith("/api/")) {
      return env.ASSETS.fetch(request);
    }
    if (request.method === "OPTIONS") {
      return new Response(null, { status: 204, headers: { Allow: "GET, POST, OPTIONS" } });
    }
    try {
      if (pathname === "/api/auth/status" && request.method === "GET") {
        const session = await sessionFor(request, env.DB);
        // 登入頁須同時知道「是否已登入」與「是否已建立老師帳號」：
        // 前者決定是否跳到後台，後者決定顯示登入或首次註冊表單。
        const account = await env.DB.prepare("SELECT count(*) AS count FROM teacher_accounts").first();
        return json({ authenticated: Boolean(session), username: session?.username || "", configured: Number(account?.count || 0) > 0 });
      }
      if (pathname === "/api/auth/logout" && request.method === "POST") {
        if (!sameOrigin(request, url.origin)) return json({ error: "Forbidden" }, 403);
        const cookie = await signOut(env.DB, request, url.protocol === "https:");
        return json({ success: true }, 200, { "Set-Cookie": cookie });
      }
      if (pathname === "/api/auth/login" && request.method === "POST") {
        if (!sameOrigin(request, url.origin)) return json({ error: "Forbidden" }, 403);
        const body = await readJSON(request);
        const account = await authenticate(env.DB, body?.username, body?.password);
        if (!account) return json({ error: "帳號或密碼錯誤。" }, 401);
        const cookie = await signIn(env.DB, account.username, url.protocol === "https:");
        return json({ success: true }, 200, { "Set-Cookie": cookie });
      }
      if (pathname.startsWith("/api/admin/")) {
        const session = await sessionFor(request, env.DB);
        if (!session) return json({ error: "登入已逾時，請重新登入。" }, 401);
        if (pathname === "/api/admin/overview" && request.method === "GET") {
          const tables = { experiments: "experiment_videos", resources: "teaching_resources", questions: "quiz_questions" };
          const collections = await Promise.all(
            Object.entries(tables).map(async ([kind, table]) => {
              const row = await env.DB.prepare(
                `SELECT sum(status = 'published') AS published, sum(status = 'draft') AS draft FROM ${table}`,
              ).first();
              return { kind, published: Number(row?.published || 0), draft: Number(row?.draft || 0) };
            }),
          );
          const topics = await Promise.all(
            quizTopics.map(async (topic) => ({
              topic,
              count: Number(
                (await env.DB.prepare("SELECT count(*) AS count FROM quiz_questions WHERE topic = ? AND status = 'published'").bind(topic).first())?.count || 0,
              ),
            })),
          );
          return json({ collections, topics: topics });
        }
        if (pathname === "/api/admin/export" && request.method === "GET") {
          return json(await adminExport(env.DB), 200, { "Content-Disposition": `attachment; filename="water-content-${new Date().toISOString().slice(0, 10)}.json"` });
        }
        const page = /^\/api\/admin\/pages\/(about)$/.exec(pathname);
        if (page) {
          if (request.method === "GET") {
            const item = await adminPage(env.DB, page[1]);
            return item ? json({ item }) : json({ error: "Not found" }, 404);
          }
          if (request.method === "PUT") {
            if (!sameOrigin(request, url.origin)) return json({ error: "Forbidden" }, 403);
            return json({ item: await savePage(env.DB, page[1], await readJSON(request, 512000)) });
          }
          return json({ error: "Method not allowed" }, 405);
        }
        if (["/api/admin/questions/import-preview", "/api/admin/questions/import"].includes(pathname) && request.method === "POST") {
          if (!sameOrigin(request, url.origin)) return json({ error: "Forbidden" }, 403);
          const body = await readJSON(request, 2 * 1024 * 1024);
          return json(await importQuestions(env.DB, body?.questions, pathname.endsWith("/import")));
        }
        const materialSync = /^\/api\/admin\/resources\/([^/]+)\/materials\/([^/]+)\/sync$/.exec(pathname);
        if (materialSync && request.method === "POST") {
          if (!sameOrigin(request, url.origin)) return json({ error: "Forbidden" }, 403);
          const [, resourceId, materialId] = materialSync;
          return json({ item: await resyncResourceMaterial(env.DB, env, resourceId, materialId) });
        }
        const material = /^\/api\/admin\/resources\/([^/]+)\/materials(?:\/([^/]+))?$/.exec(pathname);
        if (material) {
          const [, resourceId, materialId] = material;
          const resource = await adminFind(env.DB, "resources", resourceId);
          if (!resource) return json({ error: "Not found" }, 404);
          if (request.method === "GET" && materialId) {
            const found = resource.materials.find((entry) => entry.id === materialId);
            return found ? json({ item: found }) : json({ error: "Not found" }, 404);
          }
          if (request.method !== "GET" && !sameOrigin(request, url.origin)) return json({ error: "Forbidden" }, 403);
          if (request.method === "POST" && !materialId) {
            return json({ item: await saveResourceMaterial(env.DB, env, resource, null, await readJSON(request, 768000), context) }, 201);
          }
          if (request.method === "PUT" && materialId) {
            return json({ item: await saveResourceMaterial(env.DB, env, resource, materialId, await readJSON(request, 768000), context) });
          }
          if (request.method === "DELETE" && materialId) {
            await deleteResourceMaterial(env.DB, env, resourceId, materialId, context);
            return json({ deletedId: materialId });
          }
          return json({ error: "Method not allowed" }, 405);
        }
        const list = /^\/api\/admin\/(experiments|resources|questions|updates)$/.exec(pathname);
        if (list && request.method === "GET") {
          return json({ items: await adminList(env.DB, list[1]) });
        }
        const item = /^\/api\/admin\/(experiments|resources|questions|updates)(?:\/([^/]+))?$/.exec(pathname);
        if (item) {
          const [, kind, id] = item;
          if (request.method !== "GET" && !sameOrigin(request, url.origin)) return json({ error: "Forbidden" }, 403);
          if (request.method === "GET" && id) { const found = await adminFind(env.DB, kind, id); return found ? json({ item: found }) : json({ error: "Not found" }, 404); }
          if (request.method === "POST" && !id) return json({ item: await adminSave(env.DB, kind, null, await readJSON(request, 512000)) }, 201);
          if (request.method === "PUT" && id) {
            const before = kind === "resources" ? await adminFind(env.DB, kind, id) : null;
            const saved = await adminSave(env.DB, kind, id, await readJSON(request, 512000));
            if (kind === "resources" && before && (before.title !== saved.title || before.status !== saved.status)) {
              await syncResourceMetadata(env.DB, env, saved, context);
            }
            return json({ item: saved });
          }
          if (request.method === "DELETE" && id) {
            if (kind === "resources") await deleteResourceMaterials(env.DB, env, id, context);
            return json(await adminDelete(env.DB, kind, id));
          }
        }
        return json({ error: "Not found" }, 404);
      }
      if (pathname === "/api/experiments" && request.method === "GET") {
        // 前端維持既有的 { videos } 契約，避免畫面把正確資料誤判為載入失敗。
        return json({ videos: await listVideos(env.DB) });
      }
      if (pathname === "/api/ai/status" && request.method === "GET") {
        const row = await env.DB.prepare("SELECT count(*) AS count FROM ai_materials WHERE deleted=0 AND status='published' AND index_state='ready'").first();
        return json({ configured: true, hasMaterials: Number(row?.count || 0) > 0 });
      }
      if (pathname === "/api/ai/qa" && request.method === "POST") {
        if (!sameOrigin(request, url.origin)) return json({ error: "Forbidden" }, 403);
        const body = await readJSON(request, 16000);
        const question = typeof body?.question === "string" ? body.question.trim() : "";
        if (!question || question.length > 4000) return json({ error: "問題格式不正確。" }, 400);
        const conversationId = typeof body?.conversationId === "string" && /^[a-f0-9-]{16,80}$/i.test(body.conversationId)
          ? body.conversationId
          : crypto.randomUUID();
        try {
          const { results: previousRows } = await env.DB.prepare(
            "SELECT content FROM ai_conversation_messages WHERE conversation_id=? AND role='user' ORDER BY sequence DESC LIMIT 3",
          ).bind(conversationId).all();
          const previousQuestions = previousRows.reverse().map((row) => row.content);
          const normalization = await env.AI.run("@cf/meta/llama-3.3-70b-instruct-fp8-fast", {
            messages: [
              { role: "system", content: "將學生目前問題整理成一句適合教材搜尋的繁體中文問句。舊問題只可用來補足『這個、再說明』等模糊指稱；如果現在問題有明確題號或概念，一律以現在問題為主。只輸出 JSON：{\"searchQuery\":\"...\"}。" },
              { role: "user", content: JSON.stringify({ question, previousQuestions }) },
            ], max_tokens: 120, temperature: 0,
          });
          let searchQuestion = question;
          try {
            const parsed = JSON.parse(modelText(normalization));
            if (typeof parsed?.searchQuery === "string" && parsed.searchQuery.trim()) searchQuestion = parsed.searchQuery.trim().slice(0, 4000);
          } catch { /* 模型整理格式失敗時安全地退回原問題。 */ }
          const embedding = await env.AI.run("@cf/baai/bge-m3", { text: [searchQuestion] });
          const values = embedding?.data?.[0];
          if (!Array.isArray(values)) throw new Error("Embedding unavailable");
          const matches = await env.VECTORIZE.query(values, { topK: 20, returnValues: false, returnMetadata: "none", namespace: env.VECTOR_NAMESPACE || "water-materials-v1" });
          const chunks = await resolveAIChunks(env.DB, matches.matches || [], 0.05, 5);
          if (!chunks.length) return json({ answer: "目前老師提供的教材沒有足夠資訊回答這個問題。你可以換個問法，或請老師補充相關教材喔！", sources: [], conversationId: crypto.randomUUID() });
          const materials = chunks.map((chunk) => `【${chunk.title}】\n${chunk.content}`).join("\n\n");
          const result = await env.AI.run("@cf/meta/llama-3.3-70b-instruct-fp8-fast", { messages: [{ role: "system", content: "你是國小高年級教材問答夥伴。只能依據提供教材回答，使用繁體中文，先說重點，再用簡短步驟或例子教學；教材不足時直接說不足。舊問題只用於理解模糊追問，現在的問題優先。" }, { role: "user", content: `最近學生問題：${previousQuestions.join("\n") || "（無）"}\n\n整理後搜尋問題：${searchQuestion}\n\n現在問題：${question}\n\n教材：\n${materials}` }], max_tokens: 900, temperature: 0.15 });
          const answer = modelText(result);
          if (!answer) throw new Error("Missing model response");
          // 同一份小教材可能命中多個片段，但回答下方只需顯示一次教材來源與全部附圖。
          // 來源資料由 resolveAIChunks 在 D1 驗證後提供；images 僅供前端呈現，並不
          // 會併入 prompt 或改變向量檢索結果，避免圖片網址成為模型回答的依據。
          const sources = [...new Map(chunks.map((chunk) => [chunk.materialId, { id: chunk.materialId, title: chunk.title, url: chunk.sourceUrl, images: chunk.images || [], excerpts: [chunk.content.slice(0, 180)] }])).values()];
          await env.DB.batch([
            env.DB.prepare("INSERT INTO ai_conversation_messages (conversation_id,role,content,created_at) VALUES (?,?,?,?)").bind(conversationId, "user", question, Date.now()),
            env.DB.prepare("INSERT INTO ai_conversation_messages (conversation_id,role,content,created_at) VALUES (?,?,?,?)").bind(conversationId, "assistant", answer, Date.now()),
          ]);
          return json({ answer, sources, conversationId });
        } catch {
          return json({ error: "AI 服務目前無法連線，請稍後再試。" }, 503);
        }
      }
      if (pathname === "/api/resources" && request.method === "GET") {
        // 公開教材頁與學習頁皆以 { resources } 讀取資料。
        return json({ resources: await listResources(env.DB) });
      }
      if (pathname === "/api/updates" && request.method === "GET") {
        return json({ updates: await listUpdates(env.DB) });
      }
      const page = /^\/api\/pages\/(home|about)$/.exec(pathname);
      if (page && request.method === "GET") {
        const result = await publicPage(env.DB, page[1]);
        return result ? json({ page: result }) : json({ error: "Not found" }, 404);
      }
      if (pathname === "/api/quiz/catalog" && request.method === "GET") {
        return json(await quizCatalog(env.DB));
      }
      if (pathname === "/api/quiz/questions" && request.method === "GET") {
        const count = Number(url.searchParams.get("count") || 10);
        const topics = url.searchParams.getAll("topic").filter(Boolean);
        if (!Number.isInteger(count) || count < 1 || count > 100) {
          return json({ error: "Invalid count" }, 400);
        }
        return json(
          await quizQuestions(env.DB, {
            topic: url.searchParams.get("topic") || "",
            topics,
            type: url.searchParams.get("type") || "",
            difficulty: url.searchParams.get("difficulty") || "",
            count,
          }),
        );
      }
      if (pathname === "/api/quiz/answer" && request.method === "POST") {
        if (!sameOrigin(request, url.origin)) return json({ error: "Forbidden" }, 403);
        const body = await readJSON(request);
        const result = await gradeQuestion(env.DB, body?.id, body?.choice);
        return result ? json(result) : json({ error: "Not found" }, 404);
      }
      return json({ error: "Not found" }, 404);
    } catch (error) {
      const status = error instanceof SyntaxError || error?.message === "Invalid body" ? 400 : 500;
      return json({ error: status === 400 ? "Invalid request" : "Server error" }, status);
    }
  },
};
