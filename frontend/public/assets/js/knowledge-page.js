// 主要功能：提供科普知識頁目前的獨立入口與準備中文案。
// 未來加入文章查詢、分類或搜尋時，只需擴充本檔，不會影響其他介紹頁。

import "./shared/site-shell.js";
import { contentRoot, renderMessage } from "./shared/content-renderer.js";

renderMessage(contentRoot(), "科普知識專區", [
  "從生活現象認識土、風、水，練習觀察、提問與說明自己的發現。",
]);
