/*
 * 互動小遊戲的預留入口。目前沒有遊戲資料或玩家紀錄 API，僅利用共用渲染器顯示
 * 安全的準備中文案；未來的關卡狀態、計分與操作事件都應在本檔實作，避免把臨時
 * 遊戲邏輯塞進首頁路由或共用內容工具。
 */

import "./shared/site-shell.js";
import { contentRoot, renderMessage } from "./shared/content-renderer.js";

renderMessage(contentRoot(), "互動小遊戲", [
  "遊戲任務持續準備中。完成知識小學堂後，也可以使用教材問答整理相關概念。",
]);
