/*
 * 知識小學堂的獨立頁入口。quiz.html 與舊首頁的 #quiz 共用 learning.js，以確保題目
 * 抽取、伺服器評分、角色互動與回顧流程不會分叉。learning.js 依 body[data-page="quiz"]
 * 決定此頁初始顯示方式；本檔刻意不重複任何測驗邏輯。
 */

import "./learning.js?v=20261028-36";
