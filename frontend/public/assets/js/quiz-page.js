// 知識小學堂的獨立頁入口。
//
// quiz.html 與舊版 index.html#quiz 共用完整的題庫、評分與角色互動流程；
// 實作集中在 learning.js，避免兩套程式日後各自修改而讓畫面或題目流程不一致。
// learning.js 會依 body[data-page="quiz"] 判斷此為獨立頁，直接顯示小學堂內容。

import "./learning.js";
