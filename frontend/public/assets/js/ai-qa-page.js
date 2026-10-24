/*
 * 獨立教材 AI 問答頁。conversationId 僅保留在本頁記憶體以協助伺服器理解追問，
 * 重新整理即清除；瀏覽器只取得已驗證的回答、來源及附圖，不會持有 AI 金鑰、向量
 * 或未發布教材。訊息一律以 textContent 建立，避免模型回應或教材圖說造成 XSS。
 */

import "./shared/site-shell.js";

const aiForm = document.getElementById("ai-qa-form");
const aiInput = document.getElementById("ai-question");
const aiStatus = document.getElementById("ai-status");
const aiLog = document.getElementById("ai-log");
let conversationId = null;

/**
 * 建立對話介面使用的純文字節點。
 * 模型回答與教材引文都視為不可信資料，不能使用 innerHTML 顯示。
 */
function aiNode(tag, text, className) {
  const element = document.createElement(tag);
  element.textContent = text;
  if (className) {
    element.className = className;
  }

  return element;
}

/**
 * 將一則學生或 AI 訊息加入聊天紀錄。sources 已由伺服器確認教材版本、發布狀態
 * 與索引狀態；前端只安全呈現文字、來源與附圖。新版以 source.images 顯示多張圖，
 * 同時保留 imageUrl 的讀取分支，讓舊對話或快取的 API 回應仍能呈現單張圖片。
 * 圖片連結另以 noopener 開啟，避免外部 Drive 頁面取得本站視窗控制權。
 */
function addMessage(role, text, sources = []) {
  const entry = document.createElement("article");
  entry.className = `ai-message ai-message-${role}`;
  entry.append(aiNode("strong", role === "user" ? "我" : "教材小幫手"), aiNode("p", text));

  sources.forEach((source) => {
    const images = Array.isArray(source.images) ? source.images : source.imageUrl ? [{ url: source.imageUrl, caption: "" }] : [];
    images.forEach((item) => {
      const figure = document.createElement("figure");
      figure.className = "ai-source-image";
      const link = document.createElement("a");
      link.href = item.url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      const image = document.createElement("img");
      // API 對 Google Drive /view 連結另外提供可作為 img.src 的縮圖網址；原始連結
      // 僅保留給點擊開啟。縮圖無法讀取時直接移除 figure，避免畫面顯示破圖和網址。
      image.src = item.previewUrl || item.url;
      image.alt = item.caption || `教材圖片｜${source.title}`;
      image.loading = "lazy";
      image.addEventListener("error", () => figure.remove());
      link.append(image);
      figure.append(link);
      if (item.caption) figure.append(aiNode("figcaption", item.caption));
      entry.append(figure);
    });
  });

  if (sources.length) {
    const sourceBox = aiNode("div", undefined, "ai-sources");
    sourceBox.append(aiNode("strong", "依據教材"));
    sources.forEach((source) => {
      const link = document.createElement("a");
      link.href = source.url;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      link.textContent = `${source.title} ↗`;
      sourceBox.append(link);
    });
    entry.append(sourceBox);
  }

  aiLog.append(entry);
  entry.scrollIntoView({ block: "nearest", behavior: "smooth" });
}

// 送出問題時暫停輸入，避免同一個 conversationId 同時存在多個尚未完成的請求。
aiForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const question = aiInput.value.trim();
  if (!question) {
    return;
  }

  const submit = aiForm.querySelector("button");
  submit.disabled = true;
  aiInput.disabled = true;
  aiStatus.textContent = "正在教材裡找線索…";
  addMessage("user", question);

  try {
    // 瀏覽器只把問題和暫時對話代號送到本機 API；AI 金鑰不會出現在前端。
    const response = await fetch("/api/ai/qa", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ question, conversationId }),
    });
    const data = await response.json();
    if (!response.ok) {
      throw new Error(data.error);
    }

    conversationId = data.conversationId;
    addMessage("assistant", data.answer, data.sources || []);
    aiInput.value = "";
    aiStatus.textContent = "";
  } catch (error) {
    aiStatus.textContent = error.message || "目前無法回答，請稍後再試。";
  } finally {
    submit.disabled = false;
    aiInput.disabled = false;
    aiInput.focus();
  }
});
