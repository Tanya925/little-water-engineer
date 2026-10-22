// 主要功能：提供互動小遊戲頁目前的獨立入口與準備中文案。
// 未來加入遊戲狀態、關卡或操作事件時，集中在本檔及 games.css 維護。

import "./shared/site-shell.js";
import { contentRoot, renderMessage } from "./shared/content-renderer.js";

renderMessage(contentRoot(), "互動小遊戲", [
  "遊戲任務持續準備中。完成知識小學堂後，也可以使用教材問答整理相關概念。",
]);
