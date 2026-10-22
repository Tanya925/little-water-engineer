// 主要功能：在教材下載中心取得老師已發布的教材，並建立安全的外部下載連結。
//
// 此頁只負責教材清單。AI 教材全文與索引仍由老師後台及伺服器處理，
// 瀏覽器不會下載或顯示未發布教材的內容。

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
