// 主要功能：載入並呈現老師後台已發布的活動紀錄。
// 本頁只處理 /api/updates；日期、說明與外部連結都以安全 DOM 節點建立。

import "./shared/site-shell.js";
import {
  contentRoot,
  makeContentElement,
  renderMessage,
  setLoading,
} from "./shared/content-renderer.js";

const root = contentRoot();

/** 建立活動卡片；外部連結另開分頁時加入 noopener，避免新頁控制原頁。 */
function renderActivities(updates) {
  const article = document.createElement("article");
  article.className = "editorial-page";
  article.append(makeContentElement("h2", "活動紀錄"));

  if (!updates.length) {
    article.append(makeContentElement("p", "目前尚無活動紀錄。"));
  }

  updates.forEach((update) => {
    const item = document.createElement("section");
    item.className = "editorial-item";
    item.append(makeContentElement("h3", update.title));

    if (update.eventDate) {
      item.append(makeContentElement("p", update.eventDate, "item-label"));
    }

    if (update.description) {
      item.append(makeContentElement("p", update.description));
    }

    if (update.linkUrl) {
      const link = makeContentElement("a", "查看活動連結 ↗", "experiment-button");
      link.href = update.linkUrl;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      item.append(link);
    }

    article.append(item);
  });

  root.replaceChildren(article);
}

/** 取得活動清單；非陣列回應視為服務錯誤，不嘗試猜測資料格式。 */
async function loadActivities() {
  setLoading(root, true);

  try {
    const response = await fetch("/api/updates", { cache: "no-store" });
    const data = await response.json();

    if (!response.ok || !Array.isArray(data.updates)) {
      throw new Error("Missing updates");
    }

    renderActivities(data.updates);
  } catch {
    renderMessage(root, "活動暫時無法載入", ["請稍後重新整理頁面，再試一次。"]);
  } finally {
    setLoading(root, false);
  }
}

void loadActivities();
