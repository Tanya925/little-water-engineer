/*
 * Cloudflare Worker 的唯一 HTTP 入口：提供前端靜態資產、公開內容 API、老師登入與
 * 管理 API、以及教材 AI 問答。路由在本檔集中，但資料庫驗證、登入、教材索引分別
 * 委派到 d1-* 模組。任何改變資料的請求都必須同時通過 session 與 same-origin 檢查；
 * 瀏覽器從不取得 D1、Vectorize 或 Workers AI 的綁定資訊。
 */
import { modelText } from "./ai-utils.js";
import { authenticate, sessionFor, signIn, signOut } from "./d1-auth.js";
import { adminDelete, adminExport, adminFind, adminList, adminPage, adminSave, importQuestions, savePage } from "./d1-admin.js";
import { findNamedMaterialIds, materialReferences, resolveAIChunks, resolveMaterialIdChunks, resolveMaterialReferenceChunks, shortMaterialReferences } from "./d1-ai.js";
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
// 問答模型的單次輸出上限。教材已先由檢索縮小範圍，不需要為每個問題保留過長的
// 生成額度；較小上限可避免少數冗長回覆快速耗盡 Workers AI 的共享額度。
const ANSWER_TOKEN_LIMIT = 360;
const DETAILED_ANSWER_TOKEN_LIMIT = 800;

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

/**
 * 只有明顯的追問才沿用最近一題的題號。例如「這個圖是什麼意思」必須繼續查剛剛的
 * 習題 1-5；全新的完整問題則不應被舊題號綁住，仍交給 AI 整理後做一般語意檢索。
 */
function isFollowUpQuestion(question) {
  return /^(?:這|那|它|圖|上面|剛剛|再|為什麼|怎麼|可以|請|幫)/.test(question.trim());
}

function conversationMaterialSelection(question, previousQuestions) {
  // 教材身分只能由學生實際輸入與既有對話決定，不能相信 AI 改寫後的搜尋句子；否則模型
  // 若自行補上一個題號，會錯誤把回答與題圖鎖到不相干教材。
  const current = materialReferences(question);
  if (current.length) return { references: current, ambiguous: false };
  const recentReferences = [...previousQuestions].reverse().flatMap(materialReferences);
  const shortReferences = shortMaterialReferences(question);
  if (shortReferences.length) {
    const candidates = [...new Set(recentReferences.filter((reference) => shortReferences.some((shortReference) => reference.endsWith(shortReference))))];
    // 相同尾碼可能是不同教材；有歧義時寧可請學生補全名稱，也不能把答案或題圖猜錯。
    return { references: candidates.length === 1 ? candidates : [], ambiguous: candidates.length > 1 };
  }
  const isFollowUp = isFollowUpQuestion(question);
  // 未指定題號的「再說詳細一點」會沿用最近一次明確題目中的所有教材；若學生只要
  // 其中一題，輸入「2-8」即可縮小範圍，不會把兩筆混為一筆。
  const uniqueRecent = [...new Set(recentReferences)];
  // 沒有題號的追問也只能在上下文只有一份教材時沿用；多份教材時無法安全判斷「那個」。
  return { references: isFollowUp && uniqueRecent.length === 1 ? uniqueRecent : [], ambiguous: isFollowUp && uniqueRecent.length > 1 };
}

/** 學生要求「再說詳細一點」時，模型必須改用完整教學模式，而不是重複一段概述。 */
function requestsDetailedExplanation(question) {
  return /詳細|再說|展開|一步|步驟|推導|怎麼算|為什麼/.test(question);
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
        const insufficientAnswer = "目前老師提供的教材沒有足夠資訊回答這個問題。你可以換個問法，或請老師補充相關教材喔！";
        // 即使教材不足，學生接著仍可能問「2-7 再說明一次」。每一輪都必須用同一個
        // conversationId 留下問題，否則承接式追問會失去前一題的教材身分。
        const persistExchange = (answer) => env.DB.batch([
          env.DB.prepare("INSERT INTO ai_conversation_messages (conversation_id,role,content,created_at) VALUES (?,?,?,?)").bind(conversationId, "user", question, Date.now()),
          env.DB.prepare("INSERT INTO ai_conversation_messages (conversation_id,role,content,created_at) VALUES (?,?,?,?)").bind(conversationId, "assistant", answer, Date.now()),
        ]);
        try {
          const { results: previousRows } = await env.DB.prepare(
            "SELECT content FROM ai_conversation_messages WHERE conversation_id=? AND role='user' ORDER BY sequence DESC LIMIT 3",
          ).bind(conversationId).all();
          const previousQuestions = previousRows.reverse().map((row) => row.content);
          // 先用規則辨識教材代號。這類問題可直接由 D1 取得教材，不必先為「改寫搜尋句」
          // 再呼叫一次大模型；例如問 102地特-4 或 week2-9 現在只會消耗一次回答模型。
          const selection = conversationMaterialSelection(question, previousQuestions);
          const { references } = selection;
          if (selection.ambiguous) {
            const clarification = "我需要確認你指的是哪一份教材。請寫完整名稱，例如「week2-7」或「習題2-7」，我才不會拿錯題目或圖片來說明。";
            await persistExchange(clarification);
            return json({ answer: clarification, sources: [], conversationId });
          }
          // 除了 week／習題等結構化代號，也動態比對 D1 裡所有小教材的實際名稱。這讓
          // 老師未來新增自訂標題時不必回來修改程式；名稱比對成功後同樣以資料庫 ID
          // 鎖定教材，因此不會落入向量搜尋而混用別題圖片。
          let namedMaterialIds = references.length ? [] : await findNamedMaterialIds(env.DB, question);
          if (!namedMaterialIds.length && isFollowUpQuestion(question)) {
            const priorNamedIds = [...new Set((await Promise.all(previousQuestions.map((previousQuestion) => findNamedMaterialIds(env.DB, previousQuestion)))).flat())];
            if (priorNamedIds.length === 1) namedMaterialIds = priorNamedIds;
            if (priorNamedIds.length > 1) {
              const clarification = "我需要確認你要延續哪一份教材。請在問題中寫出該教材完整名稱，這樣我才能正確引用內容和圖片。";
              await persistExchange(clarification);
              return json({ answer: clarification, sources: [], conversationId });
            }
          }
          if (namedMaterialIds.length > 1) {
            const clarification = "這個名稱可能對應到多份教材。請補上更完整的教材名稱，我才能正確引用內容和圖片。";
            await persistExchange(clarification);
            return json({ answer: clarification, sources: [], conversationId });
          }
          const hasExactMaterial = references.length > 0 || namedMaterialIds.length > 0;
          let searchQuestion = question;
          if (!hasExactMaterial) {
            const normalization = await env.AI.run("@cf/meta/llama-3.3-70b-instruct-fp8-fast", {
              messages: [
                { role: "system", content: "將學生目前問題整理成一句適合教材搜尋的繁體中文問句。舊問題只可用來補足『這個、再說明』等模糊指稱；如果現在問題有明確題號或概念，一律以現在問題為主。只輸出 JSON：{\"searchQuery\":\"...\"}。" },
                { role: "user", content: JSON.stringify({ question, previousQuestions }) },
              ], max_tokens: 80, temperature: 0,
            });
            try {
              const parsed = JSON.parse(modelText(normalization));
              if (typeof parsed?.searchQuery === "string" && parsed.searchQuery.trim()) searchQuestion = parsed.searchQuery.trim().slice(0, 4000);
            } catch { /* 模型整理格式失敗時安全地退回原問題。 */ }
          }
          // 教材代號是比語意更精確的身分。仍會先經過 AI 取得檢索問句，但像「習題1-5」、
          // 「week2-7」、「108地特-1」或其追問，都會鎖定同一筆教材，避免相近題目混入。
          // 已鎖定教材代號時直接讀取同一筆 D1 教材；不再先做向量搜尋，因此沒有任何
          // 相似但不同題目的片段、來源或圖片可以混進這一輪。
          let chunks;
          if (references.length) {
            const exactResults = await Promise.all(references.map((reference) => resolveMaterialReferenceChunks(env.DB, reference, 5)));
            chunks = exactResults.flat();
          } else if (namedMaterialIds.length) {
            chunks = await resolveMaterialIdChunks(env.DB, namedMaterialIds, 5);
          } else {
            const embedding = await env.AI.run("@cf/baai/bge-m3", { text: [searchQuestion] });
            const values = embedding?.data?.[0];
            if (!Array.isArray(values)) throw new Error("Embedding unavailable");
            const matches = await env.VECTORIZE.query(values, { topK: 20, returnValues: false, returnMetadata: "none", namespace: env.VECTOR_NAMESPACE || "water-materials-v1" });
            chunks = await resolveAIChunks(env.DB, matches.matches || [], 0.05, 5);
          }
          if (!chunks.length) {
            await persistExchange(insufficientAnswer);
            return json({ answer: insufficientAnswer, sources: [], conversationId });
          }
          const materials = chunks.map((chunk) => `【${chunk.title}】\n${chunk.content}`).join("\n\n");
          // 精確代號已在 D1 驗證為同一份已發布教材；不再交給相關性模型猜測它是否足夠，
          // 避免像 102地特-4 明明有完整題目與解法卻被誤判為教材不足。一般語意搜尋才需
          // 這道保守關卡，以避免無關片段被模型勉強拿來回答。
          let sufficient = hasExactMaterial;
          if (!sufficient) {
            const relevance = await env.AI.run("@cf/meta/llama-3.3-70b-instruct-fp8-fast", {
              messages: [
                { role: "system", content: "你是教材相關性判斷器。只依據提供教材，判斷教材是否足夠回答學生目前問題。若學生問圖片、圖示或題目，但教材文字沒有足夠說明，視為不足。只輸出 JSON：{\"sufficient\":true} 或 {\"sufficient\":false}。" },
                { role: "user", content: `學生問題：${question}\n\n教材：\n${materials}` },
              ], max_tokens: 30, temperature: 0,
            });
            try {
              sufficient = JSON.parse(modelText(relevance))?.sufficient === true;
            } catch { /* 判斷格式異常時採保守策略，不顯示可能不相關的教材與圖片。 */ }
          }
          if (!sufficient) {
            await persistExchange(insufficientAnswer);
            return json({ answer: insufficientAnswer, sources: [], conversationId });
          }
          const detailInstruction = requestsDetailedExplanation(question)
            ? "學生明確要求更詳細。請依教材原本順序，補足定義、已知條件、公式、符號、推導與每個計算步驟；不可只重複先前的重點摘要。"
            : "先說重點，再用清楚的步驟或例子教學。";
          const result = await env.AI.run("@cf/meta/llama-3.3-70b-instruct-fp8-fast", { messages: [{ role: "system", content: `你是國小高年級教材問答夥伴。只能依據提供教材回答，使用繁體中文；教材沒有提到的事要明確說明。${detailInstruction} 舊問題只用於理解模糊追問，現在的問題優先。` }, { role: "user", content: `最近學生問題：${previousQuestions.join("\n") || "（無）"}\n\n整理後搜尋問題：${searchQuestion}\n\n現在問題：${question}\n\n教材：\n${materials}` }], max_tokens: requestsDetailedExplanation(question) ? DETAILED_ANSWER_TOKEN_LIMIT : ANSWER_TOKEN_LIMIT, temperature: 0.15 });
          const answer = modelText(result);
          if (!answer) throw new Error("Missing model response");
          // 同一份小教材可能命中多個片段，但回答下方只需顯示一次來源。圖片只在題號／
          // week／國考等明確教材代號成功比對時回傳；一般語意搜尋可以引用多份文字，卻
          // 不該猜測要顯示哪一題的圖，這可根除不相干教材圖片混入的問題。
          const sources = [...new Map(chunks.map((chunk) => [chunk.materialId, {
            id: chunk.materialId,
            title: chunk.title,
            url: chunk.sourceUrl,
            images: hasExactMaterial ? chunk.images || [] : [],
            excerpts: [chunk.content.slice(0, 180)],
          }])).values()];
          await persistExchange(answer);
          return json({ answer, sources, conversationId });
        } catch (error) {
          // Workers AI 額度、速率限制、模型暫時故障原本都被吃成「無法連線」，讓老師誤以為
          // 是網站壞掉。記錄原始錯誤供 Wrangler 觀察，並只在可辨識時告知學生正確原因。
          console.error("AI QA failed", error);
          const message = String(error?.message || error || "");
          const quotaReached = /quota|rate.?limit|too many|429|limit exceeded|neurons/i.test(message);
          return json({ error: quotaReached ? "AI 今日額度或速率暫時已滿，請稍後再試。" : "AI 服務目前暫時無法回應，請稍後再試。" }, 503);
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
