/*
 * 舊首頁的 hash 路由主入口：以網址 #片段切換首頁／功能區，而不重新下載 index.html。
 * 其他功能檔也監聽 hashchange 並各自控制內容載入；本檔只負責路由、導覽選取、完整
 * 功能選單與首頁逐字標語。共用 DOM id 定義於 index.html，增加功能時需同步更新此處
 * 的 features 白名單，避免任意 hash 值造成不存在頁面或未預期的 DOM 操作。
 */
const features = [
  { id: "experiments", title: "實驗影片", icon: "🧪", color: "mint" },
  { id: "resources", title: "教材下載中心", icon: "📚", color: "peach" },
  { id: "activities", title: "活動紀錄", icon: "📷", color: "blue" },
  { id: "honors", title: "小小工程師榮譽榜", icon: "🏆", color: "yellow" },
  { id: "knowledge", title: "科普知識專區", icon: "💡", color: "yellow" },
  { id: "quiz", title: "知識小學堂", icon: "❔", color: "lavender" },
  { id: "games", title: "互動小遊戲", icon: "🎮", color: "peach" },
  { id: "ai-qa", title: "AI 問答機器人", icon: "💬", color: "mint" },
  { id: "about", title: "關於我們", icon: "👋", color: "mint" },
];
// 完整功能入口集中於右上方選單。
document.getElementById("full-menu").innerHTML =
  `<a href="#home"><span aria-hidden="true">🏠</span>首頁<span class="menu-arrow">↗</span></a>` +
  features
    .map(
      (f) =>
        `<a href="#${f.id}"><span aria-hidden="true">${f.icon}</span>${f.title}<span class="menu-arrow">↗</span></a>`,
    )
    .join("");
const menu = document.getElementById("menu");
const menuButton = document.querySelector(".menu-button");
menuButton.addEventListener("click", () => {
  menu.showModal();
  menuButton.setAttribute("aria-expanded", "true");
  document.body.classList.add("menu-open");
});
menu.addEventListener("close", () => {
  menuButton.setAttribute("aria-expanded", "false");
  document.body.classList.remove("menu-open");
});
document.querySelector(".close-button").addEventListener("click", () => menu.close());
menu.addEventListener("click", (e) => {
  if (e.target === menu) {
    const r = menu.getBoundingClientRect();
    if (
      e.clientX < r.left ||
      e.clientX > r.right ||
      e.clientY < r.top ||
      e.clientY > r.bottom
    )
      menu.close();
  }
});
menu
  .querySelectorAll("a")
  .forEach((a) => a.addEventListener("click", () => menu.close()));
// 依 hash 找功能設定，更新標題、顯示區塊及 aria-current，並把焦點帶到新內容。
function renderRoute() {
  const id = location.hash.slice(1) || "home";
  const f = features.find((f) => f.id === id);
  document.getElementById("home-page").hidden = !!f;
  document.getElementById("feature-page").hidden = !f;
  document.querySelectorAll(".quick-nav a").forEach((a) => {
    if (a.hash === location.hash) a.setAttribute("aria-current", "page");
    else a.removeAttribute("aria-current");
  });
  if (f) {
    document.getElementById("page-title").textContent = f.title;
    document.getElementById("page-icon").textContent = f.icon;
    document.title = f.title + "｜小小水利工程師養成計畫";
    window.scrollTo(0, 0);
    document.getElementById("main").focus({ preventScroll: true });
  } else {
    document.title = "小小水利工程師養成計畫";
    if (id === "main") document.getElementById("main").focus({ preventScroll: true });
    else window.scrollTo(0, 0);
  }
}
window.addEventListener("hashchange", renderRoute);
renderRoute();

// 首頁循環打字：逐字輸入 → 停留 → 逐字刪除 → 切換句子。
const typewriterText = document.getElementById("typewriter-text");
const typewriterPrefix = document.getElementById("typewriter-prefix");
const typewriterBreak = document.getElementById("typewriter-break");
const homePage = document.getElementById("home-page");
const motionPreference = window.matchMedia("(prefers-reduced-motion: reduce)");
const typewriterSentences = [
  "從玩流力試驗，\n解鎖土、風、水的防災科學密碼！",
  "動手做科普實驗，\n探索水的力量！",
  "認識土、風、水，\n一起解開防災的秘密！",
].map((sentence) => Array.from(sentence));
let sentenceIndex = 0;
let characterCount = 0;
let deleting = false;
let typewriterTimer = null;
let nextDelay = 120;

// 只有首頁、分頁可見且未要求減少動態時才播放，避免背景計時器持續工作。
function typewriterIsActive() {
  return !motionPreference.matches && !document.hidden && !homePage.hidden;
}

function renderTypewriter(count) {
  const characters = typewriterSentences[sentenceIndex];
  const lineBreakIndex = characters.indexOf("\n");
  typewriterPrefix.textContent = characters
    .slice(0, Math.min(count, lineBreakIndex))
    .join("");
  typewriterBreak.hidden = count <= lineBreakIndex;
  typewriterText.textContent = characters
    .slice(lineBreakIndex + 1, count)
    .join("");
}

function scheduleTypewriter() {
  if (typewriterTimer === null && typewriterIsActive()) {
    typewriterTimer = window.setTimeout(typewriterTick, nextDelay);
  }
}

// 每一步輸入或刪除字元，再排下一次計時；停留時間與速度依目前狀態決定。
function typewriterTick() {
  typewriterTimer = null;
  if (!typewriterIsActive()) return;
  const characters = typewriterSentences[sentenceIndex];
  characterCount += deleting ? -1 : 1;
  renderTypewriter(characterCount);
  if (!deleting && characterCount === characters.length) {
    deleting = true;
    nextDelay = 2200;
  } else if (deleting && characterCount === 0) {
    deleting = false;
    sentenceIndex = (sentenceIndex + 1) % typewriterSentences.length;
    nextDelay = 450;
  } else {
    nextDelay = deleting ? 55 : 120;
  }
  scheduleTypewriter();
}

// 路由或分頁可見性變動時同步計時器；減少動態時改為完整靜態文字。
function syncTypewriter() {
  window.clearTimeout(typewriterTimer);
  typewriterTimer = null;
  if (motionPreference.matches) {
    sentenceIndex = 0;
    characterCount = 0;
    deleting = false;
    nextDelay = 120;
    renderTypewriter(typewriterSentences[0].length);
    return;
  }
  renderTypewriter(characterCount);
  scheduleTypewriter();
}

document.addEventListener("visibilitychange", syncTypewriter);
motionPreference.addEventListener("change", syncTypewriter);
new MutationObserver(syncTypewriter).observe(homePage, {
  attributes: true,
  attributeFilter: ["hidden"],
});
window.addEventListener("pagehide", () => {
  window.clearTimeout(typewriterTimer);
  typewriterTimer = null;
});
window.addEventListener("pageshow", syncTypewriter);
syncTypewriter();
