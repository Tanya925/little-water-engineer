/*
 * 首頁的獨立 JavaScript 入口。現階段首頁沒有自己的資料請求，只需載入 site-shell
 * 以建立共用導覽與背景；未來首頁特有的動畫或 D1 公開資料應集中於此，避免在共用
 * site-shell 放入只屬於首頁的副作用。
 */

import "./shared/site-shell.js";
