// 主要功能：提供榮譽榜目前的獨立入口與準備中文案。
// 未來加入名單、學習成果卡或篩選時，只會修改本頁程式。

import "./shared/site-shell.js";
import { contentRoot, renderMessage } from "./shared/content-renderer.js";

renderMessage(contentRoot(), "小小工程師榮譽榜", [
  "每一位願意觀察、動手做與再試一次的小小工程師，都值得被看見。",
]);
