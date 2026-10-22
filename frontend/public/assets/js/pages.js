// Editorial content is plain text throughout; teacher input never becomes HTML.
(() => {
  const make = (tag, text, className) => {
    const element = document.createElement(tag);
    if (text !== undefined) element.textContent = text;
    if (className) element.className = className;
    return element;
  };
  const displayTitle = value => value.replace(/^(?:[一二三四五六七八九十]+[、．.]|\d+[.．、])\s*/, "");
  const text = (parent, paragraphs) => paragraphs.forEach(paragraph => {
    const p = make("p");
    const motto = "「聽得明白、學得輕鬆、玩得快樂」";
    if (paragraph.includes(motto)) {
      const [before, after] = paragraph.split(motto);
      p.append(before, make("strong", motto), after || "");
    } else p.textContent = paragraph;
    parent.append(p);
  });
  const art = (item, index, challenge = false) => {
    const visual = make("div", undefined, `editorial-art art-${index % 4}${challenge ? " challenge-art" : ""}`);
    visual.setAttribute("aria-hidden", "true");
    visual.append(make("span", item.icon || ["🌱", "💧", "🌬️", "⛰️"][index % 4]));
    return visual;
  };
  const reveal = root => {
    const items = root.querySelectorAll(".editorial-chapter, .editorial-item, .module-overview");
    if (!("IntersectionObserver" in window)) { items.forEach(item => item.classList.add("is-visible")); return; }
    const observer = new IntersectionObserver(entries => entries.forEach(entry => {
      if (!entry.isIntersecting) return;
      entry.target.classList.add("is-visible");
      observer.unobserve(entry.target);
    }), { threshold: .12 });
    items.forEach(item => { item.classList.add("scroll-reveal"); observer.observe(item); });
  };
  function renderDocument(target, document, id) {
    target.replaceChildren();
    if (!document) { target.append(make("p", "內容整理中，請稍後再來看看。", "page-empty")); return; }
    const sections = document.sections.filter(section => section.layout !== "challenges");
    for (const section of sections) {
      const chapter = make("section", undefined, `editorial-chapter layout-${section.layout}`); chapter.dataset.chapter = section.id;
      chapter.tabIndex = -1;
      chapter.setAttribute("aria-label", displayTitle(section.title));
      const heading = make("header", undefined, "chapter-heading");
      if (section.label && section.layout !== "experiments") heading.append(make("h4", displayTitle(section.label), "chapter-subtitle"));
      if (heading.childElementCount) chapter.append(heading);
      const intro = make("div", undefined, "chapter-intro"); text(intro, section.paragraphs); chapter.append(intro);
      if (section.layout === "experiments") {
        const overview = make("div", undefined, "module-overview");
        for (const [layout, label] of [["experiments", "基礎流力試驗"], ["challenges", "防災工程挑戰"]]) {
          const module = document.sections.find(s => s.layout === layout);
          if (!module) continue;
          const block = make("div");
          const header = make("div", undefined, "module-column-heading"); header.append(make("strong", String(module.items.length)), make("h4", label)); block.append(header);
          const marquee = make("div", undefined, "module-marquee");
          const track = make("div", undefined, "module-marquee-track");
          for (let copy = 0; copy < 2; copy += 1) {
            const list = make("ul");
            if (copy) list.setAttribute("aria-hidden", "true");
            module.items.forEach(item => {
              const row = make("li");
              row.append(make("span", item.icon || "✦", "module-item-icon"), make("span", displayTitle(item.title)));
              list.append(row);
            });
            track.append(list);
          }
          marquee.append(track); block.append(marquee); overview.append(block);
        }
        chapter.append(overview); target.append(chapter); continue;
      }
      if (section.layout === "kpi") chapter.append(make("p", "預期量化成果｜執行期滿目標，非實際達成進度", "expected-note"));
      if (section.layout === "team") {
        const org = make("div", undefined, "team-map"); org.setAttribute("aria-label", "主持團隊關係總覽");
        section.items.forEach((item, index) => {
          const person = make("div", undefined, index === 0 ? "team-lead" : "");
          person.append(make("small", item.label), make("strong", item.title)); org.append(person);
        }); chapter.append(org);
      }
      if (section.layout === "archive") {
        const flow = make("ol", undefined, "archive-flow");
        section.items.forEach(item => flow.append(make("li", `${item.icon} ${item.title}`))); chapter.append(flow);
      }
      const grid = make(section.layout === "timeline" ? "ol" : "div", undefined, "chapter-items");
      section.items.forEach((item, index) => {
        const expandable = section.layout === "experiments";
        const card = make(expandable ? "details" : section.layout === "timeline" ? "li" : "article", undefined, "editorial-item");
        if (expandable) {
          const summary = make("summary"); summary.append(make("span", item.icon, "experiment-symbol"), make("span", item.title)); card.append(summary);
          text(card, item.paragraphs);
        } else {
          if (["story", "challenges", "partners", "benefits"].includes(section.layout)) card.append(art(item, index, section.layout === "challenges"));
          const body = make("div", undefined, "editorial-item-body");
          if (["stats", "kpi"].includes(section.layout)) {
            const number = make("div", undefined, "editorial-number"); number.append(make("strong", item.value), make("span", item.unit)); body.append(number);
          } else if (item.icon && ["goals", "cooperation"].includes(section.layout)) body.append(make("span", item.icon, "goal-icon"));
          if (item.label && section.layout !== "challenges") body.append(make("small", item.label, "item-label"));
          if (item.title) body.append(make("h4", displayTitle(item.title)));
          if (section.layout === "students") {
            body.append(make("p", "團隊成員：")); const list = make("ul"); item.paragraphs.forEach(p => list.append(make("li", p))); body.append(list);
          } else text(body, item.paragraphs);
          card.append(body);
        }
        grid.append(card);
      }); chapter.append(grid); target.append(chapter);
    }
    requestAnimationFrame(() => reveal(target));
  }
  const about = make("div", undefined, "editorial-page about-editorial"); about.id = "about-content"; about.hidden = true;
  document.querySelector(".page-heading").after(about);
  const loaded = new Set();
  const pageTitles = new Map();
  const pending = new Set();
  async function load(id) {
    if (loaded.has(id) || pending.has(id)) return;
    pending.add(id);
    const target = document.getElementById(id === "home" ? "project-content" : "about-content");
    target.setAttribute("aria-busy", "true"); target.replaceChildren(make("p", "正在載入內容…", "page-empty"));
    try {
      const response = await fetch(`/api/pages/${id}`, { cache: "no-store" });
      if (!response.ok) throw new Error();
      const { page } = await response.json(); renderDocument(target, page, id); loaded.add(id);
      if (page) pageTitles.set(id, page.title);
      if (id === "home" && page) document.getElementById("intro-title").textContent = page.title;
      if (id === "about" && page && location.hash === "#about") document.getElementById("page-title").textContent = page.title;
    } catch {
      const retry = make("button", "重新載入", "experiment-button"); retry.type = "button"; retry.addEventListener("click", () => load(id));
      target.replaceChildren(make("p", "內容暫時無法載入，請稍後再試。"), retry);
    } finally { pending.delete(id); target.setAttribute("aria-busy", "false"); }
  }

  const names = { earth: "土土", water: "小水滴", wind: "風咻咻" };
  function walkingRoad(className) {
    const road = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    road.setAttribute("class", className); road.setAttribute("viewBox", "0 0 900 40"); road.setAttribute("preserveAspectRatio", "none"); road.setAttribute("aria-hidden", "true");
    const path = document.createElementNS("http://www.w3.org/2000/svg", "path"); path.setAttribute("d", "M15 20 C270 0 580 40 885 18"); road.append(path); return road;
  }
  function character(kind) {
    const source = document.querySelector(kind === "water" ? "#quiz-water-friend .quiz-buddy" : `#quiz-${kind}-friend .${kind}-character`);
    const clone = source.cloneNode(true); clone.removeAttribute("id"); clone.querySelectorAll("[id]").forEach(e => e.removeAttribute("id")); return clone;
  }
  const messages = {
    experiments: ["一起觀察影片，猜猜實驗會發生什麼事！", "點一下影片封面的播放按鈕，就能開始看實驗囉！", "看完之後，試著說說你觀察到了什麼變化！"],
    resources: ["這裡放著老師整理好的教材，選一本想看的開始探索吧！", "先讀一小段、想一想，再回來和我分享你的新發現！", "找不到需要的教材時，可以請老師幫忙補充喔！"],
    activities: ["每一次動手嘗試，都是值得記錄的發現！", "一起期待更多科學探險的活動紀錄吧！", "你最想和朋友一起挑戰哪一個實驗呢？"],
    honors: ["好奇、提問、再試一次，都是小小工程師的本領！", "每一個認真探索的你，都值得鼓勵！", "把今天的新發現記下來，看看自己又學會了什麼！"],
    knowledge: ["帶著好奇心，一起找出土、風、水的秘密！", "想一想：生活中有哪些現象，也和流動的空氣或水有關？", "先提出自己的猜想，再找線索來驗證吧！"],
    games: ["一起在遊戲中觀察、嘗試，找出新的發現！", "遇到挑戰，換個方法再試試看！", "試試不同的選擇，觀察結果有什麼不一樣！"],
    "ai-qa": ["我是小水滴！把好奇的問題告訴我吧！", "我會從老師提供的教材裡找線索，回答後也會附上來源喔！", "教材還沒提到的事，我會老實告訴你，讓我們一起向老師請教。"],
    about: ["來認識陪著我們探索科學的老師與夥伴吧！", "土、風、水探險隊，和大家一起把科學帶進校園！", "每一場科學冒險，背後都有一起努力的老師和夥伴！"],
  };
  const ribbon = make("aside", undefined, "page-companion"); ribbon.hidden = true;
  document.querySelector(".page-heading").after(ribbon);

  // The shared banner keeps every feature page's return link, title, guide and
  // illustration together.  Keeping the structure here prevents each page
  // script from drifting into a slightly different heading layout.
  const featurePage = document.getElementById("feature-page");
  const pageBanner = make("div", undefined, "feature-banner");
  const bannerBackdrop = make("div", undefined, "feature-banner-backdrop");
  const bannerScene = make("img", undefined, "feature-banner-scene");
  const heading = featurePage.querySelector(".page-heading");
  const backLink = featurePage.querySelector(".back");
  const sceneRoutes = new Set(["experiments", "resources", "activities", "honors", "knowledge", "quiz", "games", "ai-qa", "about"]);

  bannerBackdrop.setAttribute("aria-hidden", "true");
  bannerScene.alt = "";
  bannerScene.width = 640;
  bannerScene.height = 360;
  bannerScene.setAttribute("aria-hidden", "true");

  featurePage.prepend(pageBanner);
  pageBanner.append(bannerBackdrop, bannerScene, backLink, heading, ribbon);
  function friendButton(kind, onClick) {
    const button = make("button", undefined, `site-friend site-friend-${kind}`); button.type = "button"; button.setAttribute("aria-label", `和${names[kind]}聊天`);
    button.append(character(kind), make("span", names[kind], "friend-name")); button.addEventListener("click", onClick); return button;
  }
  let lastRoute = "";
  function companion(id) {
    ribbon.hidden = !messages[id];
    if (!messages[id] || lastRoute === id) return;
    lastRoute = id;
    const kind = ({ experiments: "wind", resources: "water", activities: "earth", honors: "water", knowledge: "wind", games: "earth", "ai-qa": "water", about: "earth" })[id];
    const speech = make("div", undefined, "companion-speech"); speech.setAttribute("role", "status"); speech.setAttribute("aria-live", "polite"); let visit = 0;
    const line = make("p", messages[id][0]); speech.append(make("strong", names[kind]), line);
    const track = make("div", undefined, "companion-walking-track");
    const road = walkingRoad("companion-road");
    const walker = make("div", undefined, "companion-walker");
    walker.append(speech, friendButton(kind, () => { line.textContent = messages[id][++visit % messages[id].length]; }));
    track.append(road, walker);
    ribbon.replaceChildren(track);
  }
  const heroArt = document.querySelector(".hero-art");
  heroArt.removeAttribute("aria-hidden");
  heroArt.querySelector("svg").setAttribute("aria-hidden", "true");
  const homeSpeech = make("p", "土土、風咻咻、小水滴探險隊，和你一起出發！", "home-friend-speech"); homeSpeech.setAttribute("aria-live", "polite");
  const homeLines = {
    earth: ["我是土土！一起觀察大地，認識山與土壤的力量！", "土壤遇到水，會出現哪些變化呢？", "動手試試看，從觀察中找出防災的小秘密！"],
    water: ["我是小水滴！和我一起探索水的流動，解開防災的秘密！", "水會往哪裡流？我們一起找找生活中的線索！", "想看更多實驗嗎？到科普實驗影片找我吧！"],
    wind: ["我是風咻咻！看不見的空氣，也藏著好多科學秘密！", "輕輕吹一口氣，猜猜紙條會往哪裡跑？", "跟著土、風、水探險隊，一起把好奇變成發現！"],
  };
  const homeVisits = { earth: 0, water: 0, wind: 0 };
  const homeTalk = kind => { homeSpeech.textContent = homeLines[kind][homeVisits[kind]++ % homeLines[kind].length]; };
  for (const kind of ["earth", "wind"]) heroArt.append(friendButton(kind, () => homeTalk(kind)));
  const homeRoad = walkingRoad("home-companion-road"); heroArt.append(homeRoad);
  const waterTrigger = make("button", undefined, "home-water-trigger"); waterTrigger.type = "button"; waterTrigger.setAttribute("aria-label", "和小水滴聊天"); waterTrigger.addEventListener("click", () => homeTalk("water"));
  heroArt.append(waterTrigger, homeSpeech);
  function route() {
    const id = location.hash.slice(1) || "home";

    // A route-specific SVG restores the illustrated setting without duplicating
    // a title or a return link in every individual feature page.
    if (sceneRoutes.has(id)) {
      pageBanner.dataset.scene = id;
      bannerScene.src = `/assets/images/page-scenes/${id}.svg`;
    } else {
      delete pageBanner.dataset.scene;
      bannerScene.removeAttribute("src");
    }

    about.hidden = id !== "about";
    if (id === "about" && pageTitles.has(id)) document.getElementById("page-title").textContent = pageTitles.get(id);
    companion(id);
    if (id === "about") load("about");
    else if (!["experiments", "resources", "activities", "honors", "knowledge", "quiz", "games", "ai-qa"].includes(id)) { load("home"); loadUpdates(); }
  }
  let updatesLoaded = false;
  async function loadUpdates() {
    if (updatesLoaded) return;
    updatesLoaded = true;
    const container = document.getElementById("latest-updates");
    try {
      const response = await fetch("/api/updates", { cache: "no-store" }); if (!response.ok) throw new Error();
      const { updates } = await response.json(); container.replaceChildren();
      if (!updates.length) container.append(make("p", "最新活動準備中，敬請期待。", "updates-empty"));
      updates.forEach(item => {
        const card = make("article", undefined, "latest-update-card");
        if (item.eventDate) { const date = make("time", item.eventDate); date.dateTime = item.eventDate; card.append(date); }
        card.append(make("h3", item.title)); if (item.description) card.append(make("p", item.description));
        if (item.linkUrl) { const link = make("a", "查看活動 ↗"); link.href = item.linkUrl; link.target = "_blank"; link.rel = "noopener noreferrer"; card.append(link); }
        container.append(card);
      });
    } catch { updatesLoaded = false; const retry = make("button", "重新載入最新活動", "experiment-button"); retry.type = "button"; retry.addEventListener("click", loadUpdates); container.replaceChildren(make("p", "最新活動暫時無法載入。"), retry); }
  }
  window.addEventListener("hashchange", route); route();
})();

