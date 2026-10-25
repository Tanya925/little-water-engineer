/*
 * Cloudflare Worker 的唯一 HTTP 入口：提供前端靜態資產、公開內容 API、老師登入與
 * 管理 API、以及教材 AI 問答。路由在本檔集中，但資料庫驗證、登入、教材索引分別
 * 委派到 d1-* 模組。任何改變資料的請求都必須同時通過 session 與 same-origin 檢查；
 * 瀏覽器從不取得 D1、Vectorize 或 Workers AI 的綁定資訊。
 */
import { modelJSON } from "./ai-utils.js";
import { authenticate, sessionFor, signIn, signOut } from "./d1-auth.js";
import { adminDelete, adminExport, adminFind, adminList, adminPage, adminSave, importQuestions, savePage } from "./d1-admin.js";
import { findNamedMaterialIds, findRelatedTitles, materialReferences, resolveAIChunks, resolveMaterialIdChunks, resolveMaterialReferenceChunks } from "./d1-ai.js";
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
const ANSWER_TOKEN_LIMIT = 800;
const DETAILED_ANSWER_TOKEN_LIMIT = 1200;
// 同一個模型同時負責搜尋問句整理與最終教材回答。集中成常數可避免兩個流程意外
// 使用不同模型，並讓日後做模型評估或切換時只需修改一處。
const TEXT_MODEL = "@cf/qwen/qwen3-30b-a3b-fp8";

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

/** 整理問句中只有學生實際提過的題號能作為精確教材身分。 */
export function validatedSearchPlan(result, previousQuestions, question) {
  const plan = modelJSON(result);
  if (!plan || typeof plan.searchQuery !== "string" || !plan.searchQuery.trim()) return null;
  const searchQuery = plan.searchQuery.trim().slice(0, 4000);
  const allowed = new Set([...previousQuestions, question].flatMap(materialReferences));
  const references = materialReferences(searchQuery).filter((reference) => allowed.has(reference));
  return { searchQuery, references };
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
        const insufficientAnswer = "目前老師提供的教材沒有足夠資訊回答這個問題。你可以試著把問題寫得更完整，例如補上教材名稱或題號，也可以換個問法，或請老師補充相關教材喔！";
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
          let references = materialReferences(question);
          let namedMaterialIds = [];
          let searchQuestion = question;
          if (!references.length) {
            const normalization = await env.AI.run(TEXT_MODEL, {
              messages: [
                { role: "system", content: "將目前問題改寫成完整教材搜尋問句。前三題只在目前問題指涉舊內容時用來補上明確名稱或題號。若前題提到多項，依目前問題描述選擇相關的一項，將它的完整題號原樣保留。若目前問題提出新主題，不要混入舊主題。例：前題『week3-2和110技師-1』，現在問『技師那題的步驟』，整理為『110技師-1解題步驟』。例：前題討論密度，現在問『導讀怎麼學』，整理為『導讀怎麼學』。不要回答或編造題號。只輸出 JSON：{\"searchQuery\":\"整理後的問句\"}。" },
                { role: "user", content: `${JSON.stringify({ question, previousQuestions })}\n/no_think` },
              ], max_tokens: 512, temperature: 0,
            });
            const plan = validatedSearchPlan(normalization, previousQuestions, question);
            if (!plan) {
              console.error("AI QA invalid search plan");
              return json({ error: "AI 無法整理問題，請稍後再試。" }, 503);
            }
            searchQuestion = plan.searchQuery;
            references = plan.references;
            if (!references.length) {
              const mentionedIds = new Set((await Promise.all([...previousQuestions, question].map((text) => findNamedMaterialIds(env.DB, text)))).flat());
              const matchedIds = await findNamedMaterialIds(env.DB, searchQuestion);
              namedMaterialIds = matchedIds.filter((id) => mentionedIds.has(id));
              if (namedMaterialIds.length > 1) namedMaterialIds = [];
            }
          }
          const hasExactMaterial = references.length > 0 || namedMaterialIds.length > 0;
          let answerPreviousQuestions = previousQuestions;
          let chunks;
          if (references.length) {
            const exactResults = await Promise.all(references.map((reference) => resolveMaterialReferenceChunks(env.DB, reference, 5)));
            chunks = exactResults.flat();
            if (namedMaterialIds.length) chunks.push(...await resolveMaterialIdChunks(env.DB, namedMaterialIds, 5));
          } else if (namedMaterialIds.length) {
            chunks = await resolveMaterialIdChunks(env.DB, namedMaterialIds, 5);
          } else {
            const embedding = await env.AI.run("@cf/baai/bge-m3", { text: [searchQuestion] });
            const values = embedding?.data?.[0];
            if (!Array.isArray(values)) throw new Error("Embedding unavailable");
            const matches = await env.VECTORIZE.query(values, { topK: 20, returnValues: false, returnMetadata: "none", namespace: env.VECTOR_NAMESPACE || "water-materials-v1" });
            const [vectorChunks, titleMatches, originalTitleMatches] = await Promise.all([
              resolveAIChunks(env.DB, matches.matches || [], 0.05, 5),
              findRelatedTitles(env.DB, searchQuestion),
              findRelatedTitles(env.DB, question),
            ]);
            // 現在問題若以多個片段明確指向唯一標題，優先讀取該教材；不要讓前文的
            // 其他主題或語意相近的片段沖淡目前問題。仍不自動附圖，因為這不是完整名稱。
            const strongest = originalTitleMatches[0];
            const distinctTitle = strongest?.score >= 3 && (!originalTitleMatches[1] || strongest.score > originalTitleMatches[1].score);
            if (distinctTitle) {
              chunks = await resolveMaterialIdChunks(env.DB, [strongest.id], 5);
              answerPreviousQuestions = [];
            } else {
              const ids = [...new Set([...originalTitleMatches, ...titleMatches].map((item) => item.id))];
              const titleChunks = await resolveMaterialIdChunks(env.DB, ids, 3);
              chunks = [...new Map([...titleChunks, ...vectorChunks].map((chunk) => [chunk.id, chunk])).values()];
            }
          }
          if (!chunks.length) {
            await persistExchange(insufficientAnswer);
            return json({ answer: insufficientAnswer, sources: [], conversationId });
          }
          // 片段 ID 一併交給回答模型。模型必須明確列出實際用到的 ID，後端才會顯示該
          // 教材的來源與圖片；因此就算 Vectorize 找到多份相似教材，也不會自動帶出別題圖。
          const materials = chunks.map((chunk) => `【片段ID：${chunk.id}｜${chunk.title}】\n${chunk.content}`).join("\n\n");
          const detailInstruction = requestsDetailedExplanation(question)
            ? "學生明確要求更詳細。請依教材原本順序，補足定義、已知條件、公式、符號、推導與每個計算步驟；不可只重複先前的重點摘要。"
            : "先說重點，再用清楚的步驟或例子教學。";
          // 「能否回答」與「如何回答」共用同一次模型呼叫：模型以原始問題、最近最多三題
          // 和實際檢索片段作判斷，回傳足夠性、答案與引用片段 ID。這取代原先獨立的
          // relevance 呼叫，既減少一次 AI 用量，也避免兩個模型判斷前後不一致。
          const result = await env.AI.run(TEXT_MODEL, { messages: [
            { role: "system", content: `你是國小高年級教材問答夥伴。只能依據提供教材回答，使用繁體中文。先判斷教材是否足夠回答「現在問題」：若不足、問題要求解讀圖片但教材文字不足、或無法以提供片段支持，輸出 {"sufficient":false,"answer":"","usedChunkIds":[]}。若足夠，輸出 {"sufficient":true,"answer":"你的完整回答","usedChunkIds":["實際使用的片段ID"]}。answer 中不得加入教材未提及的知識；usedChunkIds 只能填提供教材內、且確實支持答案的 ID。只輸出合法 JSON，不得使用 Markdown 或額外文字。${detailInstruction} 舊問題只用於理解模糊追問，現在問題優先。` },
            { role: "user", content: `最近學生問題（最多三題）：${answerPreviousQuestions.join("\n") || "（無）"}\n\n整理後搜尋問題：${searchQuestion}\n\n現在問題：${question}\n\n教材片段：\n${materials}\n/no_think` },
          ], max_tokens: requestsDetailedExplanation(question) ? DETAILED_ANSWER_TOKEN_LIMIT : ANSWER_TOKEN_LIMIT, temperature: 0.15 });
          const grounded = modelJSON(result);
          const availableChunkIds = new Set(chunks.map((chunk) => chunk.id));
          const usedChunkIds = [...new Set(Array.isArray(grounded?.usedChunkIds)
            ? grounded.usedChunkIds.filter((id) => typeof id === "string" && availableChunkIds.has(id))
            : [])];
          const answer = typeof grounded?.answer === "string" ? grounded.answer.trim() : "";
          if (!grounded || typeof grounded.sufficient !== "boolean" || (grounded.sufficient && (!answer || !usedChunkIds.length))) {
            console.error("AI QA invalid model output", { hasJSON: !!grounded, sufficient: grounded?.sufficient, hasAnswer: !!answer, validSourceCount: usedChunkIds.length, finishReason: result?.choices?.[0]?.finish_reason });
            return json({ error: "AI 回覆格式異常，請稍後再試。" }, 503);
          }
          if (!grounded.sufficient) {
            await persistExchange(insufficientAnswer);
            return json({ answer: insufficientAnswer, sources: [], conversationId });
          }
          const usedChunks = chunks.filter((chunk) => usedChunkIds.includes(chunk.id));
          // 同一份小教材可能有多個被引用片段，但回答下方只顯示一次來源。圖片只在學生
          // 明確指定教材時回傳，並且只取本次真正引用的教材，避免語意相近的其他題目附圖。
          const sources = [...new Map(usedChunks.map((chunk) => [chunk.materialId, {
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
