/*
 * 舊首頁 hash 路由使用的介紹頁渲染器。所有老師輸入或 API 內容皆以純文字 DOM 呈現，
 * 永不使用 innerHTML；它與新獨立頁的 content-renderer 分開維護，是為了保留既有
 * 首頁場景與段落版面，不應將其當作通用 API 顯示工具。
 */
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
  const drawKpiLines = diagram => {
    const svg = diagram.querySelector(".kpi-radial-lines");
    const hub = diagram.querySelector(".kpi-radial-hub");
    if (!svg || !hub) return;
    const frame = diagram.getBoundingClientRect();
    const hubRect = hub.getBoundingClientRect();
    const hubX = hubRect.left + hubRect.width / 2 - frame.left;
    const hubY = hubRect.top + hubRect.height / 2 - frame.top;
    diagram.querySelectorAll(".kpi-radial-node").forEach((node, index) => {
      const line = svg.children[index];
      const nodeRect = node.getBoundingClientRect();
      if (!line) return;
      line.setAttribute("x1", hubX);
      line.setAttribute("y1", hubY);
      line.setAttribute("x2", nodeRect.left + nodeRect.width / 2 - frame.left);
      line.setAttribute("y2", nodeRect.top + nodeRect.height / 2 - frame.top);
    });
  };
  const drawAllKpiLines = () => document.querySelectorAll(".kpi-radial-diagram").forEach(drawKpiLines);
  window.addEventListener("resize", drawAllKpiLines);

  function renderKpiDiagram(items, type, onItemSelect) {
    const diagram = make("section", undefined, `kpi-radial-diagram kpi-radial-${type}`);
    diagram.setAttribute("aria-label", type === "delivery" ? "具體推動項目" : "預期效益指標");
    const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
    svg.setAttribute("class", "kpi-radial-lines");
    svg.setAttribute("aria-hidden", "true");
    items.forEach(() => svg.append(document.createElementNS("http://www.w3.org/2000/svg", "line")));
    const hub = make("div", undefined, "kpi-radial-hub");
    hub.append(
      make("span", type === "delivery" ? "執行核心" : "效益驗證", "kpi-hub-kicker"),
      make("strong", type === "delivery" ? "一、具體推動項目" : "二、預期效益指標"),
      make("small", type === "delivery" ? `${items.length} 項成果` : "雙向指標"),
    );
    items.forEach((item, index) => {
      const node = make("button", undefined, `kpi-radial-node kpi-node-${index + 1}`);
      node.type = "button";
      node.setAttribute("aria-expanded", "false");
      node.append(
        make("span", "", "kpi-node-dot"),
        make("strong", item.value || "—", "kpi-node-value"),
        make("small", item.unit || "", "kpi-node-unit"),
        make("span", displayTitle(item.title || "成果項目"), "kpi-node-title"),
      );
      node.addEventListener("click", () => {
        const wasOpen = node.getAttribute("aria-expanded") === "true";
        onItemSelect(node, item, wasOpen);
      });
      diagram.append(node);
    });
    diagram.append(svg, hub);
    requestAnimationFrame(() => drawKpiLines(diagram));
    return diagram;
  }
  function renderKpiRadial(chapter, section) {
    const layout = make("div", undefined, "kpi-radial-layout");
    const deliveryItems = section.items.slice(0, 5);
    const benefitItems = section.items.slice(5);
    const details = make("aside", undefined, "kpi-details-panel");
    details.hidden = true;
    details.setAttribute("role", "status");
    const detailTitle = make("strong", undefined, "kpi-details-title");
    const close = make("button", "×", "kpi-details-close");
    close.type = "button";
    close.setAttribute("aria-label", "關閉詳細說明");
    const detailCopy = make("div", undefined, "kpi-details-copy");
    const dismiss = () => {
      details.hidden = true;
      layout.querySelectorAll(".kpi-radial-node[aria-expanded='true']").forEach(node => node.setAttribute("aria-expanded", "false"));
    };
    const selectItem = (node, item, wasOpen) => {
      dismiss();
      if (wasOpen) return;
      detailTitle.textContent = displayTitle(item.title || "成果項目");
      detailCopy.replaceChildren();
      text(detailCopy, item.paragraphs || []);
      if (!detailCopy.childElementCount) detailCopy.append(make("p", "暫無詳細說明。"));
      details.hidden = false;
      node.setAttribute("aria-expanded", "true");
    };
    close.addEventListener("click", dismiss);
    details.append(make("div", undefined, "kpi-details-heading"), detailCopy);
    details.firstElementChild.append(detailTitle, close);
    layout.addEventListener("keydown", event => { if (event.key === "Escape") dismiss(); });
    if (deliveryItems.length) layout.append(renderKpiDiagram(deliveryItems, "delivery", selectItem));
    if (benefitItems.length) layout.append(renderKpiDiagram(benefitItems, "benefits", selectItem));
    layout.append(details);
    chapter.append(layout);
  }
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
      if (id === "about") {
        heading.append(make("h3", displayTitle(section.title), "about-major-heading"));
        if (section.label) heading.append(make("h4", displayTitle(section.label), "about-minor-heading"));
      } else if (section.label && section.layout !== "experiments") {
        heading.append(make("h4", displayTitle(section.label), "chapter-subtitle"));
      }
      if (heading.childElementCount) chapter.append(heading);
      const intro = make("div", undefined, "chapter-intro"); text(intro, section.paragraphs); chapter.append(intro);
      if (section.layout === "kpi") {
        renderKpiRadial(chapter, section);
        target.append(chapter);
        continue;
      }
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
      const grid = make(section.layout === "timeline" ? "ol" : "div", undefined, "chapter-items");
      section.items.forEach((item, index) => {
        const expandable = section.layout === "experiments";
        const card = make(expandable ? "details" : section.layout === "timeline" ? "li" : "article", undefined, "editorial-item");
        if (section.layout === "kpi") card.classList.add(`kpi-item-${index + 1}`);
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
          if (item.title) {
            const itemTitle = make("h4");
            if (section.layout === "archive" && item.icon) itemTitle.append(make("span", item.icon, "archive-item-icon"), " ");
            itemTitle.append(displayTitle(item.title));
            body.append(itemTitle);
          }
          if (section.layout === "students") {
            body.append(make("p", "團隊成員：")); const list = make("ul"); item.paragraphs.forEach(p => list.append(make("li", p))); body.append(list);
          } else text(body, item.paragraphs);
          if (id === "about" && typeof item.imageUrl === "string" && item.imageUrl) {
            const photo = document.createElement("img");
            photo.className = "about-item-photo";
              photo.src = item.imageUrl;
              photo.alt = `${item.title || item.label || "計畫夥伴"}照片`;
              photo.loading = "lazy";
            card.append(photo);
          }
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
  const guideKinds = {
    experiments: ["wind", "water"], resources: ["water"], activities: ["earth", "wind"],
    honors: ["water", "earth", "wind"], knowledge: ["wind", "water"], games: ["earth", "water"],
    "ai-qa": ["water", "wind", "earth"], about: ["earth", "water"],
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
    const kinds = guideKinds[id] || ["water"];
    const track = make("div", undefined, `companion-walking-track has-${kinds.length}`);
    const road = walkingRoad("companion-road");
    track.append(road);
    kinds.forEach((guideKind, index) => {
      const lane = ["", " companion-walker-secondary", " companion-walker-tertiary"][index];
      const walker = make("div", undefined, `companion-walker${lane}`);
      const start = index === 1 ? "var(--guide-end)" : index === 2 ? "35%" : "var(--guide-start)";
      const end = index === 1 ? "var(--guide-start)" : index === 2 ? "60%" : "var(--guide-end)";
      walker.style.setProperty("--walk-from", start);
      walker.style.setProperty("--walk-to", end);
      // 每位夥伴在每次進入頁面時採不同的慢速步調，避免同步走路又不會太快。
      walker.style.setProperty("--walk-duration", `${18 + Math.floor(Math.random() * 13)}s`);
      walker.style.setProperty("--walk-delay", `${-Math.floor(Math.random() * 12)}s`);
      const speech = make("div", undefined, "companion-speech"); speech.setAttribute("role", "status"); speech.setAttribute("aria-live", "polite");
      const line = make("p", messages[id][index % messages[id].length]);
      speech.append(make("strong", names[guideKind]), line);
      let visit = index;
      walker.append(speech, friendButton(guideKind, () => { line.textContent = messages[id][++visit % messages[id].length]; }));
      track.append(walker);
    });
    ribbon.replaceChildren(track);
  }
  const heroArt = document.querySelector(".hero-art");
  heroArt.removeAttribute("aria-hidden");
  heroArt.querySelector("svg").setAttribute("aria-hidden", "true");
  const homeSpeech = make("p", "土土、風咻咻、小水滴探險隊，和你一起出發！", "home-friend-speech"); homeSpeech.setAttribute("aria-live", "polite");
  const homeLines = {
    earth: ["我是土土！一起觀察大地，認識山與土壤的力量！", "土壤遇到水，會出現哪些變化呢？", "動手試試看，從觀察中找出防災的小秘密！"],
    water: ["我是小水滴！和我一起探索水的流動，解開防災的秘密！", "水會往哪裡流？我們一起找找生活中的線索！", "想看更多實驗嗎？到實驗影片找我吧！"],
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
    ["activities", "honors"].forEach((kind) => {
      document.getElementById(`${kind}-content`).hidden = id !== kind;
    });
    if (id === "about" && pageTitles.has(id)) document.getElementById("page-title").textContent = pageTitles.get(id);
    companion(id);
    if (id === "about") load("about");
    else if (["activities", "honors"].includes(id)) loadShowcase(id);
    else if (!["experiments", "resources", "activities", "honors", "knowledge", "quiz", "games", "ai-qa"].includes(id)) { load("home"); loadUpdates(); }
  }
  let updatesLoaded = false;
  const showcaseLoaded = new Set();
  const showcasePending = new Set();
  function gallery(images, title) {
    const gallery = make("div", undefined, "showcase-gallery");
    images.slice(0, 3).forEach((src, index) => {
      const image = document.createElement("img");
      image.src = src; image.alt = `${title}精選照片 ${index + 1}`; image.loading = "lazy";
      gallery.append(image);
    });
    return gallery;
  }
  function renderShowcase(kind, records) {
    const target = document.getElementById(`${kind}-content`);
    target.replaceChildren();
    const isActivity = kind === "activities";
    if (!records.length) {
      return;
    }
    const list = make("div", undefined, `showcase-list ${kind}-list`);
    records.forEach((record) => {
      const card = make("article", undefined, "showcase-card");
      const header = make("header");
      if (isActivity && record.eventDate) { const date = make("time", record.eventDate, "showcase-date"); date.dateTime = record.eventDate; header.append(date); }
      header.append(make("h2", record.title));
      if (isActivity && record.location) header.append(make("p", `📍 ${record.location}`, "showcase-meta"));
      if (!isActivity && record.studentName) header.append(make("p", record.studentName, "showcase-meta"));
      card.append(header);
      if (record.description) card.append(make("p", record.description, "showcase-description"));
      if (!isActivity && record.designIdea) {
        const idea = make("section", undefined, "showcase-idea"); idea.append(make("h3", "設計理念"), make("p", record.designIdea)); card.append(idea);
      }
      if (record.images?.length) card.append(gallery(record.images, record.title));
      if (isActivity && record.albumUrl) { const link = make("a", "查看完整相簿 ↗", "experiment-button"); link.href = record.albumUrl; link.target = "_blank"; link.rel = "noopener noreferrer"; card.append(link); }
      list.append(card);
    });
    target.append(list);
  }
  async function loadShowcase(kind) {
    if (showcaseLoaded.has(kind) || showcasePending.has(kind)) return;
    const target = document.getElementById(`${kind}-content`); showcasePending.add(kind);
    target.replaceChildren(make("p", "正在載入內容…", "page-empty"));
    try {
      const response = await fetch(`/api/${kind}`, { cache: "no-store" }); if (!response.ok) throw new Error();
      const data = await response.json(); const records = data[kind]; if (!Array.isArray(records)) throw new Error();
      renderShowcase(kind, records); showcaseLoaded.add(kind);
    } catch {
      const retry = make("button", "重新載入", "experiment-button"); retry.type = "button"; retry.addEventListener("click", () => loadShowcase(kind));
      target.replaceChildren(make("p", "內容暫時無法載入，請稍後再試。", "page-empty"), retry);
    } finally { showcasePending.delete(kind); }
  }
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

