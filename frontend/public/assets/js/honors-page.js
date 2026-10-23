/*
 * 榮譽榜的預留入口。目前不保存學生姓名或學習紀錄，故只呈現靜態鼓勵文字；未來若
 * 新增名單或成果卡，必須先定義隱私與公開同意規則，再在本檔串接專屬 API，而不要
 * 借用題庫或 AI 對話資料。
 */

import "./shared/site-shell.js";
import { contentRoot, renderMessage } from "./shared/content-renderer.js";

renderMessage(contentRoot(), "小小工程師榮譽榜", [
  "每一位願意觀察、動手做與再試一次的小小工程師，都值得被看見。",
]);
