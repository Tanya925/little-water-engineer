/*
 * 教材下載中心的公開控制器。它只向 /api/resources 取得已發布章節的標題、說明與
 * Google Drive 資料夾連結；AI 用的教材全文、片段和索引狀態都不會下送瀏覽器。
 * 外部連結由程式建立並採 noopener 開啟，失敗時提供重試但不自行猜測或快取舊資料。
 */

import "./shared/site-shell.js";

const resourcesStatus = document.getElementById("resources-status");
const resourcesList = document.getElementById("resources-list");
const resourcesRetry = document.getElementById("resources-retry");

/**
 * 建立只含純文字的 DOM 節點。
 * 教材標題與簡介來自老師後台，因此使用 textContent，避免把內容解讀成 HTML。
 */
function resourceElement(tag, text, className) {
  const element = document.createElement(tag);
  element.textContent = text;
  if (className) {
    element.className = className;
  }

  return element;
}

/**
 * 把公開教材資料轉成下載卡片。
 * 連結會在新分頁開啟，並加上 noopener，避免外部頁面取得本站的 window 物件。
 */
function renderResources(resources) {
  resourcesList.replaceChildren(
    ...resources.map((resource) => {
      const card = document.createElement("article");
      card.className = "resource-card";

      const title = resourceElement("h2", resource.title);
      const description = resourceElement(
        "p",
        resource.description || "老師已整理好這份教材，歡迎下載閱讀。",
      );
      const link = resourceElement("a", "開啟教材 ↗", "experiment-button");
      link.href = resource.folderUrl;
      link.target = "_blank";
      link.rel = "noopener noreferrer";

      card.append(title, description, link);

      return card;
    }),
  );
}

/**
 * 從公開 API 載入已發布教材。
 * 載入期間用 aria-busy 告知輔助技術；失敗時保留重試按鈕，不清除既有內容。
 */
async function loadResources() {
  resourcesRetry.hidden = true;
  resourcesStatus.textContent = "正在載入教材…";
  resourcesList.setAttribute("aria-busy", "true");

  try {
    const response = await fetch("/api/resources", { cache: "no-store" });
    const data = await response.json();
    if (!response.ok || !Array.isArray(data.resources)) {
      throw new Error("Invalid resources");
    }

    renderResources(data.resources);
    resourcesStatus.textContent = data.resources.length ? "" : "目前尚無可下載教材。";
  } catch {
    resourcesStatus.textContent = "教材暫時無法載入，請稍後再試。";
    resourcesRetry.hidden = false;
  } finally {
    resourcesList.setAttribute("aria-busy", "false");
  }
}

resourcesRetry.addEventListener("click", loadResources);
void loadResources();
