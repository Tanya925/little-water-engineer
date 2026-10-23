// 主要功能：在獨立 AI 問答頁送出教材問題、顯示回答與教材來源。
//
// 對話僅存在本頁記憶體；重新整理會清除。所有回答仍由本機伺服器驗證教材
// 與來源，不會把 AI 服務憑證或老師的未發布教材交給瀏覽器。

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
 * 將一則學生或 AI 訊息加入聊天紀錄。
 * sources 由伺服器完成教材版本與發布狀態驗證後提供；前端只負責安全呈現。
 */
function addMessage(role, text, sources = []) {
  const entry = document.createElement("article");
  entry.className = `ai-message ai-message-${role}`;
  entry.append(aiNode("strong", role === "user" ? "我" : "教材小幫手"), aiNode("p", text));

  sources.filter((source) => source.imageUrl).forEach((source) => {
    const figure = document.createElement("figure");
    figure.className = "ai-source-image";
    const link = document.createElement("a");
    link.href = source.imageSourceUrl || source.imageUrl;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    const image = document.createElement("img");
    image.src = source.imageUrl;
    image.alt = `題目圖｜${source.title}`;
    image.loading = "lazy";
    link.append(image);
    figure.append(link);
    entry.append(figure);
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
