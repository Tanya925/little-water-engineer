/*
 * 介紹型公開頁的安全渲染底層。各頁保有各自的 API 與頁面入口，本模組只提供完全
 * 共通的 DOM 建立、載入狀態與外部連結處理；所有可變文字一律寫入 textContent，
 * 因此後台或 API 回傳值無法成為 HTML。不要在此加入特定頁面的欄位判斷。
 */

/** 建立只包含純文字的元素，避免 API 或未來後台內容被當成 HTML 執行。 */
export function makeContentElement(tag, text, className) {
  const element = document.createElement(tag);
  element.textContent = text;

  if (className) {
    element.className = className;
  }

  return element;
}

/** 取得介紹頁唯一的動態內容容器；HTML 結構錯誤時立即拋錯，方便開發時發現。 */
export function contentRoot() {
  const root = document.getElementById("content-page-root");

  if (!root) {
    throw new Error("缺少 #content-page-root 內容容器。");
  }

  return root;
}

/** 用共用文章結構顯示標題與段落，也供資料載入失敗時呈現錯誤訊息。 */
export function renderMessage(root, title, paragraphs) {
  const article = document.createElement("article");
  article.className = "editorial-page";
  article.append(makeContentElement("h2", title));

  paragraphs.forEach((paragraph) => article.append(makeContentElement("p", paragraph)));
  root.replaceChildren(article);
}

/** 統一控制動態內容載入狀態，讓讀屏軟體知道容器正在更新。 */
export function setLoading(root, loading) {
  root.setAttribute("aria-busy", String(loading));
}
