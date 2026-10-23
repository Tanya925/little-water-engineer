/*
 * 「關於我們」頁的專屬入口。它只讀取 /api/pages/about 的已發布結構化內容，交由
 * content-renderer 用 textContent 建立 DOM；後台文字不可成為 HTML。頁首／背景則由
 * site-shell 初始化，故本檔不處理導覽或其他介紹頁的 API，避免內容頁互相耦合。
 */

import "./shared/site-shell.js";
import {
  contentRoot,
  makeContentElement,
  renderMessage,
  setLoading,
} from "./shared/content-renderer.js";

const root = contentRoot();

/** 將伺服器回傳的章節與項目逐層建立為純文字 DOM，不執行後台輸入的 HTML。 */
function renderAbout(page) {
  const article = document.createElement("article");
  article.className = "editorial-page";
  article.append(makeContentElement("h2", page.title));

  page.sections.forEach((section) => {
    const sectionElement = document.createElement("section");
    sectionElement.className = "editorial-chapter";
    sectionElement.append(makeContentElement("h3", section.title));

    (section.paragraphs || []).forEach((paragraph) =>
      sectionElement.append(makeContentElement("p", paragraph)),
    );

    (section.items || []).forEach((item) => {
      const itemElement = document.createElement("article");
      itemElement.className = "editorial-item";

      if (item.icon) {
        itemElement.append(makeContentElement("span", item.icon, "goal-icon"));
      }

      if (item.title) {
        itemElement.append(makeContentElement("h4", item.title));
      }

      (item.paragraphs || []).forEach((paragraph) =>
        itemElement.append(makeContentElement("p", paragraph)),
      );

      sectionElement.append(itemElement);
    });

    article.append(sectionElement);
  });

  root.replaceChildren(article);
}

/** 載入已發布的 about 頁面；失敗時保留本頁可理解的重試提示。 */
async function loadAbout() {
  setLoading(root, true);

  try {
    const response = await fetch("/api/pages/about", { cache: "no-store" });
    const data = await response.json();

    if (!response.ok || !data.page) {
      throw new Error("Missing page");
    }

    renderAbout(data.page);
  } catch {
    renderMessage(root, "內容暫時無法載入", ["請稍後重新整理頁面，再試一次。"]);
  } finally {
    setLoading(root, false);
  }
}

void loadAbout();
