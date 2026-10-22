// 主要功能：啟動本機 HTTP 網站，處理老師帳號與登入、靜態檔案白名單、前後台 API 及 AI 代理。
/*
 * 閱讀順序：先看啟動設定與資料庫，再看 session／JSON 工具，最後看 HTTP 路由。
 * 瀏覽器 → 本機 API → SQLite；需要 AI 時才由本機服務帶密鑰呼叫 Worker。
 * 帳號和正式內容放在 SITE_DATA_DIR（預設 frontend/.data），與公開 public 目錄分開。
 */
import http from "node:http";
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { randomBytes, scrypt, timingSafeEqual } from "node:crypto";
import { promisify } from "node:util";
import { openVideoDatabase } from "./database.mjs";
import { ContentError, quizTopics } from "./management.mjs";
import { createAIService, gatewayFromEnv } from "./ai.mjs";

// 路徑與公開來源在啟動時一次決定。SITE_DATA_DIR 可以把正式 SQLite、帳號檔
// 放到專案外的持久磁碟；publicDirectory 則永遠只指向可公開的靜態檔案。
const root = fileURLToPath(new URL("../", import.meta.url));
const publicDirectory = join(root, "public");
const dataDirectory = process.env.SITE_DATA_DIR || join(root, ".data");
const accountPath = join(dataDirectory, "account.json");
const port = Number(process.env.PORT || 8787);
const host = process.env.HOST || "127.0.0.1";
const siteURL = new URL(process.env.SITE_ORIGIN || `http://127.0.0.1:${port}`);

// SITE_ORIGIN 只接受乾淨的來源網址，後續用它檢查 Host 與寫入請求的 Origin。
// 禁止帳密、路徑與查詢參數，可避免部署設定看似正確卻永遠比對失敗。
if (
  !["http:", "https:"].includes(siteURL.protocol) ||
  siteURL.username ||
  siteURL.password ||
  siteURL.pathname !== "/" ||
  siteURL.search ||
  siteURL.hash
) {
  throw new Error("SITE_ORIGIN 必須是完整的網站來源網址，例如 https://school.example.org。");
}
const origin = siteURL.origin;
const videoDatabase = await openVideoDatabase(dataDirectory);
const aiService = createAIService(videoDatabase, gatewayFromEnv());

// 問答節流與索引同步狀態只存在目前程序記憶體；教材、片段及同步結果才會
// 寫入 SQLite。程序重啟後會重新掃描 pending 項目，不會遺失待同步工作。
const aiAttempts = new Map();
let aiSyncRunning = false;
let aiServerClosed = false;

// 啟動及每分鐘重試未完成的索引；旗標避免定時器與前一次同步重疊。
// 收到關閉訊號時若同步仍在進行，最後一次 finally 才關資料庫，避免中途截斷交易。
async function syncAI() {
  if (aiSyncRunning) {
    return;
  }
  aiSyncRunning = true;
  try {
    await aiService.syncPending();
  } catch {
    // 同步錯誤已由 AI 服務寫回教材狀態；保留 pending／error，下一輪會再次嘗試。
  } finally {
    aiSyncRunning = false;
    if (aiServerClosed) {
      videoDatabase.close();
    }
  }
}

const aiSyncTimer = setInterval(syncAI, 60000);
aiSyncTimer.unref();
void syncAI();
const cookieOptions = `HttpOnly; SameSite=Strict; Path=/${siteURL.protocol === "https:" ? "; Secure" : ""}`;
const hashPassword = promisify(scrypt);
const sessions = new Map();
const attempts = new Map();
const sessionDuration = 8 * 60 * 60 * 1000;
let account;
let creatingAccount = false;

// 第一次啟動沒有 account.json 是正常狀態，登入頁會改顯示建立管理員帳號；
// 其他讀檔或 JSON 錯誤必須中止啟動，避免以未知帳號狀態開放管理功能。
try {
  account = JSON.parse(await readFile(accountPath, "utf8"));
} catch (error) {
  if (error.code !== "ENOENT") {
    throw error;
  }
}

// 集中回傳 JSON，禁止快取，讓登入狀態及管理資料不會被舊回應取代。
function respond(response, status, body, headers = {}) {
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
    "X-Content-Type-Options": "nosniff",
    ...headers,
  });
  response.end(JSON.stringify(body));
}

// Cookie 只存隨機 token；實際身分與到期時間在記憶體 Map，重啟後需要重新登入。
function sessionFor(request) {
  const token = /(?:^|;\s*)teacher_session=([a-f0-9]{64})(?:;|$)/.exec(
    request.headers.cookie || "",
  )?.[1];
  const session = sessions.get(token);
  if (!session || session.expires <= Date.now()) {
    if (token) {
      sessions.delete(token);
    }

    return null;
  }

  return { ...session, token };
}

// 使用密碼學隨機 token 建立 8 小時登入狀態；HttpOnly 讓網頁程式無法讀取憑證。
function signIn(response, username) {
  const token = randomBytes(32).toString("hex");
  sessions.set(token, { username, expires: Date.now() + sessionDuration });
  respond(
    response,
    200,
    { success: true },
    {
      "Set-Cookie": `teacher_session=${token}; ${cookieOptions}; Max-Age=28800`,
    },
  );
}

// 串流累計位元組後解析 JSON；先限制大小及類型，避免不受控的請求耗盡記憶體。
async function readBody(request, limit = 4096) {
  if (!request.headers["content-type"]?.startsWith("application/json")) {
    throw new Error("Invalid body");
  }
  const chunks = [];
  let bytes = 0;
  for await (const chunk of request) {
    bytes += chunk.length;
    if (bytes > limit) {
      throw new Error("Body too large");
    }
    chunks.push(chunk);
  }

  return JSON.parse(Buffer.concat(chunks).toString("utf8"));
}

// 使用白名單提供網站檔案，帳號資料與伺服器原始碼不對外提供。
// 新增公開 HTML、CSS、JS 或圖片時必須同步加入此集合，否則即使檔案存在也會回傳 404。
const publicFiles = new Set([
  "index.html",
  "experiments.html",
  "resources.html",
  "quiz.html",
  "ai-qa.html",
  "activities.html",
  "knowledge.html",
  "honors.html",
  "games.html",
  "about.html",
  "assets/css/index.css",
  "assets/css/experiments.css",
  "assets/css/resources.css",
  "assets/css/quiz.css",
  "assets/css/ai-qa.css",
  "assets/css/activities.css",
  "assets/css/about.css",
  "assets/css/knowledge.css",
  "assets/css/honors.css",
  "assets/css/games.css",
  "assets/css/login.css",
  "assets/css/styles.css",
  "assets/css/page-shell.css",
  "assets/js/index-page.js",
  "assets/js/shared/site-shell.js",
  "assets/js/shared/content-renderer.js",
  "assets/js/about-page.js",
  "assets/js/activities-page.js",
  "assets/js/knowledge-page.js",
  "assets/js/honors-page.js",
  "assets/js/games-page.js",
  "assets/js/resources-page.js",
  "assets/js/quiz-page.js",
  "assets/js/ai-qa-page.js",
  "assets/js/experiments.js",
  "assets/css/ai.css",
  "assets/css/pages.css",
  "assets/css/learning.css",
  "assets/css/quiz-friends.css",
  "assets/js/app.js",
  "assets/js/pages.js",
  "assets/js/learning.js",
  "assets/js/ai.js",
  "assets/images/quiz-wave.svg",
  "assets/images/quiz-camp.svg",
  "assets/images/quiz-river-garden.svg",
  "assets/images/quiz-forest.svg",
  "assets/images/quiz-answer-decor.svg",
  "assets/images/quiz-sky.svg",
  "assets/images/quiz-map-texture.svg",
  ...[
    "experiments",
    "resources",
    "activities",
    "honors",
    "knowledge",
    "quiz",
    "games",
    "ai-qa",
    "about",
  ].map((page) => `assets/images/page-scenes/${page}.svg`),
  "login.html",
  "assets/js/login.js",
]);
const protectedFiles = new Set(["admin.html", "assets/js/admin.js", "assets/css/admin.css"]);
for (const video of videoDatabase.adminList("experiments")) {
  if (video.coverUrl.startsWith("/assets/")) {
    publicFiles.add(video.coverUrl.slice(1));
  }
}
const contentTypes = {
  html: "text/html; charset=utf-8",
  css: "text/css; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  jpg: "image/jpeg",
  svg: "image/svg+xml",
};

const server = http.createServer(async (request, response) => {
  try {
    // 只接受設定的網站 Host，避免其他來源透過 DNS 重綁定存取。
    if (request.headers.host !== siteURL.host) {
      return respond(response, 403, { error: "不允許的來源。" });
    }
    const url = new URL(request.url, origin);
    const session = sessionFor(request);

    // 管理路由統一先驗證登入；寫入還要核對 Origin，再分派到各內容管理方法。
    if (url.pathname.startsWith("/api/admin/")) {
      if (!session) {
        return respond(response, 401, { error: "登入已逾時，請重新登入。" });
      }
      if (!["GET", "POST", "PUT", "PATCH", "DELETE"].includes(request.method)) {
        return respond(response, 405, { error: "不支援的操作。" });
      }
      if (request.method !== "GET" && request.headers.origin !== origin) {
        return respond(response, 403, { error: "不允許的來源。" });
      }
      if (url.pathname === "/api/admin/overview" && request.method === "GET") {
        return respond(response, 200, { ...videoDatabase.adminOverview(), quizTopics });
      }
      if (url.pathname === "/api/admin/export" && request.method === "GET") {
        return respond(response, 200, videoDatabase.adminExport(), {
          "Content-Disposition": `attachment; filename="water-content-${new Date().toISOString().slice(0, 10)}.json"`,
        });
      }
      if (url.pathname === "/api/admin/ai/status" && request.method === "GET") {
        return respond(response, 200, aiService.status());
      }
      const aiMaterialMatch = /^\/api\/admin\/ai\/materials(?:\/([a-f0-9]{32}))?(\/sync)?$/.exec(
        url.pathname,
      );
      if (aiMaterialMatch) {
        const [, id, syncing] = aiMaterialMatch;
        if (syncing && id && request.method === "POST") {
          return respond(response, 200, { item: await aiService.retry(id) });
        }
        if (syncing) {
          return respond(response, 405, { error: "不支援的操作。" });
        }
        if (request.method === "GET") {
          return respond(
            response,
            200,
            id ? { item: videoDatabase.aiFind(id) } : { items: videoDatabase.aiList() },
          );
        }
        if (request.method === "POST" && !id) {
          return respond(response, 201, {
            item: await aiService.save(null, await readBody(request, 768 * 1024)),
          });
        }
        if (request.method === "PUT" && id) {
          return respond(response, 200, {
            item: await aiService.save(id, await readBody(request, 768 * 1024)),
          });
        }
        if (request.method === "DELETE" && id) {
          return respond(
            response,
            200,
            await aiService.remove(id, (await readBody(request)).revision),
          );
        }

        return respond(response, 405, { error: "不支援的操作。" });
      }
      const pageMatch = /^\/api\/admin\/pages\/(about)$/.exec(url.pathname);
      if (pageMatch) {
        if (request.method === "GET") {
          return respond(response, 200, { item: videoDatabase.adminPage(pageMatch[1]) });
        }
        if (request.method === "PUT") {
          return respond(response, 200, {
            item: videoDatabase.savePage(pageMatch[1], await readBody(request, 512 * 1024)),
          });
        }

        return respond(response, 405, { error: "不支援的操作。" });
      }
      if (url.pathname === "/api/admin/covers" && request.method === "POST") {
        const body = await readBody(request, 3 * 1024 * 1024);
        if (typeof body?.data !== "string" || !/^[A-Za-z0-9+/]+={0,2}$/.test(body.data)) {
          throw new ContentError("封面圖片格式不正確。");
        }
        const image = Buffer.from(body.data, "base64");
        const signatures = {
          "image/jpeg": image[0] === 0xff && image[1] === 0xd8 && image[2] === 0xff ? "jpg" : null,
          "image/png": image.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))
            ? "png"
            : null,
          "image/webp":
            image.toString("ascii", 0, 4) === "RIFF" && image.toString("ascii", 8, 12) === "WEBP"
              ? "webp"
              : null,
        };
        const extension = Object.hasOwn(signatures, body.mimeType)
          ? signatures[body.mimeType]
          : null;
        if (!extension || image.length < 16 || image.length > 2 * 1024 * 1024) {
          throw new ContentError("封面請使用 2 MB 以內的 JPG、PNG 或 WebP 圖片。");
        }
        const filename = `${randomBytes(16).toString("hex")}.${extension}`;
        await mkdir(join(dataDirectory, "covers"), { recursive: true });
        await writeFile(join(dataDirectory, "covers", filename), image, { flag: "wx" });
        const path = `/media/covers/${filename}`;
        videoDatabase.registerCover(path);

        return respond(response, 201, { path });
      }
      if (
        ["/api/admin/questions/import-preview", "/api/admin/questions/import"].includes(
          url.pathname,
        ) &&
        request.method === "POST"
      ) {
        const body = await readBody(request, 2 * 1024 * 1024);

        return respond(
          response,
          200,
          videoDatabase.importQuestions(body?.questions, url.pathname.endsWith("/import")),
        );
      }
      const match =
        /^\/api\/admin\/(experiments|resources|questions|updates)(?:\/([a-zA-Z0-9_-]{1,64}))?$/.exec(
          url.pathname,
        );
      if (!match) {
        return respond(response, 404, { error: "找不到此管理功能。" });
      }
      const [, kind, id] = match;
      if (request.method === "GET") {
        return respond(
          response,
          200,
          id
            ? { item: videoDatabase.adminFind(kind, id) }
            : { items: videoDatabase.adminList(kind) },
        );
      }
      if ((request.method === "POST" && !id) || (request.method === "PUT" && id)) {
        const body = await readBody(request, kind === "resources" ? 768 * 1024 : 128 * 1024);
        if (kind !== "resources") {
          return respond(response, request.method === "POST" ? 201 : 200, {
            item: videoDatabase.adminSave(kind, id || null, body),
          });
        }
        const resource = videoDatabase.adminSave("resources", id || null, body);
        const prior = resource.aiMaterialId ? videoDatabase.aiFind(resource.aiMaterialId) : null;
        // 原本只提供下載的教材仍可正常儲存；老師在相同表單加入全文後，
        // 伺服器才會另外建立可供 AI 搜尋的教材紀錄，避免舊資料被強制轉換。
        if (typeof body?.fullText !== "string" && !prior) {
          return respond(response, request.method === "POST" ? 201 : 200, { item: resource });
        }
        const material = await aiService.save(resource.aiMaterialId || null, {
          title: resource.title,
          topic: "教材下載中心",
          sourceUrl: resource.folderUrl,
          fullText: typeof body?.fullText === "string" ? body.fullText : prior?.fullText,
          status: resource.status,
          ...(prior ? { revision: prior.revision } : {}),
        });
        videoDatabase.adminSetResourceMaterial(resource.id, material.id);

        return respond(response, request.method === "POST" ? 201 : 200, {
          item: videoDatabase.adminFind("resources", resource.id),
        });
      }
      if (request.method === "PATCH" && id) {
        const body = await readBody(request);
        const item = videoDatabase.adminStatus(kind, id, body);
        if (kind === "resources" && item.aiMaterialId) {
          const prior = videoDatabase.aiFind(item.aiMaterialId);
          await aiService.save(item.aiMaterialId, {
            title: item.title,
            topic: "教材下載中心",
            sourceUrl: item.folderUrl,
            fullText: prior.fullText,
            status: item.status,
            revision: prior.revision,
          });
        }

        return respond(response, 200, { item: videoDatabase.adminFind(kind, id) });
      }

      return respond(response, 405, { error: "不支援的操作。" });
    }

    if (url.pathname === "/api/ai/status" && request.method === "GET") {
      return respond(response, 200, { configured: aiService.status().configured });
    }
    const aiChatMatch = /^\/api\/ai\/(qa|tutor)$/.exec(url.pathname);
    if (aiChatMatch) {
      if (request.method !== "POST") {
        return respond(response, 405, { error: "不支援的操作。" });
      }
      if (request.headers.origin !== origin) {
        return respond(response, 403, { error: "不允許的來源。" });
      }
      const now = Date.now(),
        key = request.socket.remoteAddress;
      for (const [ip, value] of aiAttempts) {
        if (value.until < now) {
          aiAttempts.delete(ip);
        }
      }
      const attempt = aiAttempts.get(key) || { count: 0, until: now + 60000 };
      if (attempt.count >= 15) {
        return respond(response, 429, { error: "先想一想剛才的提示，稍等一分鐘再提問喔！" });
      }
      attempt.count++;
      aiAttempts.set(key, attempt);

      return respond(
        response,
        200,
        await aiService.answer(aiChatMatch[1], await readBody(request, 12 * 1024)),
      );
    }
    if (url.pathname === "/api/updates") {
      if (request.method !== "GET") {
        return respond(response, 405, { error: "不支援的操作。" });
      }

      return respond(response, 200, { updates: videoDatabase.listUpdates() });
    }
    const publicPageMatch = /^\/api\/pages\/(home|about)$/.exec(url.pathname);
    if (publicPageMatch) {
      if (request.method !== "GET") {
        return respond(response, 405, { error: "不支援的操作。" });
      }

      return respond(response, 200, { page: videoDatabase.publicPage(publicPageMatch[1]) });
    }
    if (["/api/resources", "/api/quiz/catalog", "/api/quiz/questions"].includes(url.pathname)) {
      if (request.method !== "GET") {
        return respond(response, 405, { error: "不支援的操作。" }, { Allow: "GET" });
      }
      if (url.pathname === "/api/resources") {
        return respond(response, 200, { resources: videoDatabase.listResources() });
      }
      if (url.pathname === "/api/quiz/catalog") {
        return respond(response, 200, videoDatabase.quizCatalog());
      }
      const filters = Object.fromEntries(
        ["type", "difficulty"].map((key) => [key, url.searchParams.get(key) || ""]),
      );
      const topics = [...new Set(url.searchParams.getAll("topic").filter(Boolean))];
      const catalog = videoDatabase.quizCatalog();
      if (topics.some((topic) => !catalog.topics.includes(topic))) {
        return respond(response, 400, { error: "無效的題目篩選條件。" });
      }
      for (const [key, values] of [
        ["type", catalog.types],
        ["difficulty", catalog.difficulties],
      ]) {
        if (filters[key] && !values.includes(filters[key])) {
          return respond(response, 400, { error: "無效的題目篩選條件。" });
        }
      }
      const allQuestions = url.searchParams.get("count") === "all";
      const count = allQuestions
        ? Math.max(1, catalog.total)
        : Number(url.searchParams.get("count") || 10);
      if (!Number.isInteger(count) || count < 1 || (!allQuestions && count > 100)) {
        return respond(response, 400, { error: "題數需為 1–100 的整數。" });
      }

      return respond(response, 200, videoDatabase.quizQuestions({ ...filters, topics, count }));
    }

    // 評分獨立於取題 API：瀏覽器只提交題號與選項，答案和解析在此核對後才送出。
    if (url.pathname === "/api/quiz/answer") {
      if (request.method !== "POST") {
        return respond(response, 405, { error: "不支援的操作。" }, { Allow: "POST" });
      }
      if (request.headers.origin !== origin) {
        return respond(response, 403, { error: "不允許的來源。" });
      }
      const body = await readBody(request);
      if (!body || typeof body.id !== "string" || typeof body.choice !== "string") {
        return respond(response, 400, { error: "請選擇有效答案。" });
      }
      let result;
      try {
        result = videoDatabase.gradeQuestion(body.id, body.choice);
      } catch (error) {
        if (error.message === "Invalid choice") {
          return respond(response, 400, { error: "請選擇有效答案。" });
        }
        throw error;
      }
      if (!result) {
        return respond(response, 404, { error: "找不到這一題。" });
      }

      return respond(response, 200, result);
    }

    if (url.pathname === "/api/experiments") {
      if (request.method !== "GET") {
        return respond(response, 405, { error: "不支援的操作。" }, { Allow: "GET" });
      }

      return respond(response, 200, { videos: videoDatabase.listVideos() });
    }

    if (url.pathname === "/api/auth/status" && request.method === "GET") {
      return respond(response, 200, {
        configured: Boolean(account),
        authenticated: Boolean(session),
        username: session?.username || null,
      });
    }

    if (url.pathname.startsWith("/api/")) {
      if (request.method !== "POST") {
        return respond(response, 405, { error: "不支援的操作。" });
      }
      if (request.headers.origin !== origin) {
        return respond(response, 403, { error: "不允許的來源。" });
      }

      if (url.pathname === "/api/auth/logout") {
        if (session) {
          sessions.delete(session.token);
        }

        return respond(
          response,
          200,
          { success: true },
          {
            "Set-Cookie": `teacher_session=; ${cookieOptions}; Max-Age=0`,
          },
        );
      }
      if (!["/api/auth/setup", "/api/auth/login"].includes(url.pathname)) {
        return respond(response, 404, { error: "找不到此功能。" });
      }
      const key = request.socket.remoteAddress;
      const previous = attempts.get(key);
      if (previous?.count >= 5 && previous.until > Date.now()) {
        return respond(response, 429, { error: "嘗試次數過多，請 15 分鐘後再試。" });
      }
      const { username, password } = await readBody(request);
      if (
        typeof username !== "string" ||
        !/^[a-zA-Z0-9_.-]{3,40}$/.test(username) ||
        typeof password !== "string" ||
        password.length < 8 ||
        password.length > 256
      ) {
        return respond(response, 400, {
          error: "帳號需為 3–40 個英文字母、數字或 _ . -，密碼需為 8–256 個字元。",
        });
      }

      if (url.pathname === "/api/auth/setup") {
        if (account || creatingAccount) {
          return respond(response, 409, { error: "老師帳號已設定，請登入。" });
        }
        creatingAccount = true;
        try {
          const salt = randomBytes(32).toString("hex");
          const hash = (await hashPassword(password, salt, 64)).toString("hex");
          await mkdir(dataDirectory, { recursive: true });
          const newAccount = { username, salt, hash };
          await writeFile(accountPath, JSON.stringify(newAccount), {
            flag: "wx",
            mode: 0o600,
          });
          account = newAccount;
          signIn(response, username);
        } finally {
          creatingAccount = false;
        }

        return;
      }

      if (!account) {
        return respond(response, 409, { error: "請先設定老師帳號。" });
      }
      // 在非同步密碼驗證前記錄次數，避免並行請求繞過限制。
      const latestAttempt = attempts.get(key);
      const current =
        latestAttempt && latestAttempt.until > Date.now()
          ? latestAttempt
          : { count: 0, until: Date.now() + 15 * 60 * 1000 };
      if (current.count >= 5) {
        return respond(response, 429, { error: "嘗試次數過多，請 15 分鐘後再試。" });
      }
      current.count += 1;
      attempts.set(key, current);
      const candidate = await hashPassword(password, account.salt, 64);
      if (
        !timingSafeEqual(candidate, Buffer.from(account.hash, "hex")) ||
        username !== account.username
      ) {
        return respond(response, 401, { error: "帳號或密碼不正確。" });
      }
      attempts.delete(key);
      if (session) {
        sessions.delete(session.token);
      }

      return signIn(response, username);
    }

    if (!["GET", "HEAD"].includes(request.method)) {
      return respond(response, 405, { error: "不支援的操作。" });
    }
    if (url.pathname.startsWith("/media/covers/")) {
      const filename = /^\/media\/covers\/([a-f0-9]{32}\.(jpg|png|webp))$/.exec(url.pathname);
      if (!filename || (!session && !videoDatabase.coverVisible(url.pathname))) {
        return respond(response, 404, { error: "找不到封面。" });
      }
      let image;
      try {
        image = await readFile(join(dataDirectory, "covers", filename[1]));
      } catch (error) {
        if (error.code === "ENOENT") {
          return respond(response, 404, { error: "找不到封面。" });
        }
        throw error;
      }
      response.writeHead(200, {
        "Content-Type": { jpg: "image/jpeg", png: "image/png", webp: "image/webp" }[filename[2]],
        "Cache-Control": "no-store",
        "X-Content-Type-Options": "nosniff",
      });

      return response.end(request.method === "HEAD" ? undefined : image);
    }
    const file = url.pathname === "/" ? "index.html" : url.pathname.slice(1);
    if (protectedFiles.has(file) && !session) {
      if (file === "admin.html") {
        response.writeHead(303, { Location: "/login.html", "Cache-Control": "no-store" });

        return response.end();
      }

      return respond(response, 401, { error: "請先登入。" });
    }
    if (!publicFiles.has(file) && !protectedFiles.has(file)) {
      return respond(response, 404, { error: "找不到頁面。" });
    }
    const body = await readFile(join(publicDirectory, file));
    response.writeHead(200, {
      "Content-Type": contentTypes[file.split(".").pop()],
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "same-origin",
      "X-Frame-Options": "DENY",
      "Content-Security-Policy": [
        "default-src 'self'",
        "script-src 'self'",
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data:",
        "connect-src 'self'",
        "frame-src https://drive.google.com",
        "frame-ancestors 'none'",
        "form-action 'self'",
        "base-uri 'self'",
      ].join("; "),
    });
    response.end(request.method === "HEAD" ? undefined : body);
  } catch (error) {
    respond(
      response,
      error instanceof ContentError
        ? error.status
        : error instanceof SyntaxError ||
            error.message === "Invalid body" ||
            error.message === "Body too large"
          ? 400
          : 500,
      { error: error instanceof ContentError ? error.message : "無法完成操作，請稍後再試。" },
    );
  }
});

server.listen(port, host, () =>
  console.log(`網站已啟動：${origin}\n老師登入：${origin}/login.html`),
);
for (const signal of ["SIGINT", "SIGTERM"]) {
  process.on(signal, () => server.close());
}
server.on("close", () => {
  aiServerClosed = true;
  clearInterval(aiSyncTimer);
  if (!aiSyncRunning) {
    videoDatabase.close();
  }
});
server.on("error", (error) => {
  console.error(
    error.code === "EADDRINUSE" ? `連接埠 ${port} 已使用，請確認網站是否已啟動。` : error.message,
  );
  process.exitCode = 1;
});
