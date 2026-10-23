/*
 * 科普知識頁的預留入口。此頁尚未建立文章表或搜尋 API，暫以共用渲染器顯示說明；
 * 未來文章分類、全文搜尋和卡片載入應從本檔串接專屬公開 API，保持與教材下載及
 * AI 檢索資料分離。
 */

import "./shared/site-shell.js";
import { contentRoot, renderMessage } from "./shared/content-renderer.js";

renderMessage(contentRoot(), "科普知識專區", [
  "從生活現象認識土、風、水，練習觀察、提問與說明自己的發現。",
]);
