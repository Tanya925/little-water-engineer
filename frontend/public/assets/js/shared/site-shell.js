// 公開頁共用的網站外觀。
// 各功能仍各自維護 HTML、CSS 與 JavaScript；這裡只管理全站都會出現的外觀。

const activePage = document.body.dataset.page;

document.querySelectorAll(".page-nav a[data-page-link]").forEach((link) => {
  if (link.dataset.pageLink === activePage) link.setAttribute("aria-current", "page");
});

function addFloatingBackground() {
  if (document.querySelector(".floating-background")) return;
  const decoration = document.createElement("div");
  decoration.className = "floating-background";
  decoration.setAttribute("aria-hidden", "true");
  ["💧", "☁", "🧪", "⛰", "🌬️", "💧", "☁", "⚗", "🌱", "💧", "🌬️", "☁", "🍃", "🧪", "💧", "🌱"].forEach((icon) => {
    const item = document.createElement("span");
    item.textContent = icon;
    decoration.append(item);
  });
  document.body.prepend(decoration);
}

function restoreHeader() {
  const header = document.querySelector(".page-header");
  if (!header || header.querySelector(".header")) return;
  const inner = document.createElement("div");
  inner.className = "header";
  [...header.childNodes].forEach((node) => inner.append(node));
  header.append(inner);
  header.classList.add("site-header");
  const brand = inner.querySelector(".page-brand");
  brand?.classList.add("brand");
  inner.querySelector(".page-nav")?.classList.add("quick-nav");
  if (brand && !brand.querySelector(".brand-mark")) {
    const mark = document.createElement("span");
    mark.className = "brand-mark";
    mark.setAttribute("aria-hidden", "true");
    mark.textContent = "💧";
    brand.prepend(mark);
    brand.childNodes.forEach((node) => {
      if (node.nodeType === Node.TEXT_NODE) node.textContent = node.textContent.replace("💧", "");
    });
  }
}

function restoreFooter() {
  const footer = document.querySelector(".page-footer");
  if (!footer || footer.querySelector(".footer-main")) return;
  footer.classList.add("site-footer");
  footer.innerHTML = `
    <div class="footer-main">
      <section class="footer-identity"><span class="footer-water" aria-hidden="true">💧</span><div class="footer-brand">小小水利工程師<span>養成計畫</span></div><p>從觀察、動手做，到認識防災科學。</p></section>
      <section class="footer-info"><h2>一起探索土、風與水</h2><p><span aria-hidden="true">🔎</span>從生活現象發現科學問題，再用實驗慢慢找答案。</p><p><span aria-hidden="true">🌊</span>認識水利、防災與環境，成為關心家園的小小工程師。</p></section>
      <nav class="footer-links" aria-label="頁尾導覽"><h2>快速前往</h2><a href="experiments.html">實驗影片 <span>→</span></a><a href="quiz.html">知識小學堂 <span>→</span></a><a href="about.html">關於計畫 <span>→</span></a></nav>
    </div><div class="footer-bottom">小小水利工程師養成計畫 <span>・</span> 科普 × 防災 × 動手做</div>`;
}

function createGuide(kind, name) {
  const guide = document.createElement("button");
  guide.type = "button";
  guide.className = `site-guide site-guide-${kind}`;
  guide.setAttribute("aria-label", `和${name}打招呼`);
  guide.innerHTML = `<span class="guide-shadow"></span><span class="guide-body"><i class="guide-eye guide-eye-left"></i><i class="guide-eye guide-eye-right"></i><i class="guide-smile"></i></span><span class="guide-name">${name}</span>`;
  return guide;
}

function addPageGuide() {
  if (["home", "login"].includes(activePage) || document.querySelector(".page-guide")) return;
  const introduction = document.querySelector(".page-introduction");
  if (!introduction) return;
  const guides = {
    experiments: ["wind", "風咻咻", "準備好跟著影片一起觀察了嗎？"], resources: ["earth", "土土", "教材裡藏著好多可以慢慢發現的線索！"], quiz: ["water", "小水滴", "先想一想，再挑戰題目吧！"], "ai-qa": ["water", "小水滴", "把問題說清楚，我們一起從教材找答案。"], activities: ["wind", "風咻咻", "看看大家留下了哪些精彩紀錄！"], about: ["earth", "土土", "一起認識這個計畫的故事吧！"], knowledge: ["wind", "風咻咻", "科普知識可以從生活中的小問題開始。"], honors: ["water", "小水滴", "每一次認真探索都值得鼓掌！"], games: ["earth", "土土", "準備好用玩遊戲的方式動動腦了嗎？"],
  };
  const [kind, name, line] = guides[activePage] || guides.about;
  const companion = document.createElement("aside");
  companion.className = "page-guide";
  companion.innerHTML = `<p>${line}</p>`;
  companion.append(createGuide(kind, name));
  introduction.after(companion);
}

/** 首頁保留土土、風咻咻與小水滴三位角色，停在場景裡上下互動。 */
function addHomeGuides() {
  if (activePage !== "home") return;
  const scene = document.querySelector(".hero-art");
  if (!scene || scene.querySelector(".home-guides")) return;

  const guides = document.createElement("div");
  guides.className = "home-guides";
  guides.append(createGuide("earth", "土土"), createGuide("water", "小水滴"), createGuide("wind", "風咻咻"));
  scene.append(guides);
}

addFloatingBackground();
restoreHeader();
restoreFooter();
addPageGuide();
addHomeGuides();
