/*
 * 學生學習區與知識小學堂的完整控制器：載入公開教材／題目、管理選題與冒險式作答
 * 流程、呈現回饋與回顧。瀏覽器只取得可公開的題幹與選項；正解及最終判分永遠交由
 * /api/quiz/answer 在 Worker 端處理，不能因前端修改或 localStorage 而繞過評分。
 */
const learningElement = (id) => document.getElementById(id);
const learningNode = (tag, text, className) => {
  const element = document.createElement(tag);
  if (text !== undefined) element.textContent = text;
  if (className) element.className = className;
  return element;
};
async function learningRequest(path, options) {
  if (location.protocol === "file:") throw new Error("請透過網站網址開啟此功能。");
  const response = await fetch(path, { cache: "no-store", ...options });
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "目前無法載入，請稍後再試。");
  return data;
}
let resourcesLoaded = false;
let resourcesLoading = false;
let quizLoaded = false;
let quizLoading = false;
let quizBusy = false;
let practice = [];
let practiceIndex = 0;
let practiceAnswers = [];
const selectedQuizTopics = new Set();
let quizCatalogData = null;
let quizAvailableCount = 0;
const quizMotionPreference = window.matchMedia("(prefers-reduced-motion: reduce)");
const quizAnimations = new Set();
function decorateQuizTitle(element) {
  if (element.querySelector(".quiz-jumping-letter")) return;
  const text = element.textContent;
  element.setAttribute("aria-label", text);
  element.classList.add("quiz-jumping-title");
  element.replaceChildren(...Array.from(text).map((character, index) => {
    const letter = learningNode("span", character === " " ? "\u00a0" : character, "quiz-jumping-letter");
    letter.setAttribute("aria-hidden", "true");
    letter.style.setProperty("--letter-index", index);
    return letter;
  }));
  if (element.matches(".quiz-welcome h2")) {
    const lineBreak = document.createElement("br");
    lineBreak.className = "quiz-title-break";
    element.querySelectorAll(".quiz-jumping-letter")[5]?.after(lineBreak);
  }
}
document.querySelectorAll(".quiz-welcome h2, #quiz-result-title").forEach(decorateQuizTitle);
const quizFriendLines = {
  earth: ["我是土土！山、地震和堰塞湖，都是我的探險世界！", "主題可以選不只一個喔！把想探索的都放進背包吧！", "選好主題後，背包會告訴你這次要挑戰什麼。"],
  water: ["我是小水滴！想知道城市為什麼會淹水嗎？我們一起找答案！", "下方可以調整題型、難度和題數，依照自己的步調出發！", "答錯也沒關係，每一題都有解析，我們一起學會就好！"],
  wind: ["我是風咻咻！跟著我，一起探索流動的空氣和颱風吧！", "喜歡不只一個世界嗎？可以點選好幾個主題，一起放進背包！", "選好世界、做好準備，再確認背包，就能按「開始冒險」出發囉！"],
};
const quizFriendNames = { earth: "土土", water: "小水滴", wind: "風咻咻" };
const quizFriendVisits = { earth: 0, water: 0, wind: 0 };
function speakQuizFriend(friend, message) {
  const actor = learningElement(`quiz-${friend}-friend`);
  actor.append(document.querySelector(".quiz-friend-speech"));
  learningElement("quiz-speech-speaker").textContent = quizFriendNames[friend];
  learningElement("quiz-buddy-message").textContent = message;
  document.querySelectorAll(".quiz-walking-friend").forEach(button => button.setAttribute("aria-pressed", String(button.id === `quiz-${friend}-friend`)));
  animateQuiz(document.querySelector(".quiz-friend-speech"), [{ transform: "translateY(8px)", opacity: .5 }, { transform: "translateY(0)", opacity: 1 }], { duration: 260, easing: "ease-out" });
}
learningElement("quiz-water-friend").append(document.querySelector(".quiz-friend-speech"));
// One shared trail beneath the three walking friends.
const friendStage = document.querySelector(".quiz-friends-stage");
function updateQuizViewportWidth() {
  document.documentElement.style.setProperty("--quiz-page-width", `${document.documentElement.clientWidth}px`);
}
updateQuizViewportWidth();
window.addEventListener("resize", updateQuizViewportWidth);
const friendTrail = document.createElementNS("http://www.w3.org/2000/svg", "svg");
friendTrail.classList.add("quiz-walking-trails");
friendTrail.setAttribute("aria-hidden", "true");
friendStage.prepend(friendTrail);
function drawFriendTrails() {
  const width = friendStage.clientWidth;
  if (!width) return;
  friendTrail.setAttribute("viewBox", `0 0 ${width} ${friendStage.clientHeight}`);
  const path = document.createElementNS("http://www.w3.org/2000/svg", "path");
  // 路線從舞台的左右邊界開始與結束，避免寬螢幕上看起來像少了一截。
  path.setAttribute("d", `M0,309 C${width * .3},290 ${width * .7},327 ${width},305`);
  friendTrail.replaceChildren(path);
}
new ResizeObserver(drawFriendTrails).observe(friendStage);
const headingKite = document.querySelector(".quiz-map-decor span:nth-child(2)");
headingKite.className = "quiz-heading-kite";
headingKite.setAttribute("aria-hidden", "true");
document.querySelector(".quiz-topic-heading").append(headingKite);
const quizTimelineForm = learningElement("quiz-setup");
const quizDecorAnchors = new WeakMap();
function spaceQuizDecorations() {
  if (!quizTimelineForm.getBoundingClientRect().height) return;
  const obstacles = Array.from(quizTimelineForm.querySelectorAll(
    ".quiz-topic-pick, .quiz-filters fieldset, .quiz-backpack, #quiz-start"
  )).map(element => {
    const rect = element.getBoundingClientRect();
    const padding = element.matches(".quiz-topic-pick") ? 65 : element.matches(".quiz-backpack") ? 38 : 16;
    return { left: rect.left - padding, right: rect.right + padding, top: rect.top - padding, bottom: rect.bottom + padding };
  });
  // Protect the actual lettering and arrow, while leaving the empty space beside them available.
  quizTimelineForm.querySelectorAll(".quiz-topic-heading h2, .quiz-multi-badge, .quiz-step-intro h3, .quiz-step-intro p, .quiz-flow-next, .quiz-final-step h3, .quiz-final-step p").forEach(element => {
    const range = document.createRange();
    range.selectNodeContents(element);
    Array.from(range.getClientRects()).forEach(rect => obstacles.push({ left: rect.left - 16, right: rect.right + 16, top: rect.top - 16, bottom: rect.bottom + 16 }));
  });
  const rail = quizTimelineForm.querySelector(".quiz-step-number").getBoundingClientRect();
  obstacles.push({ left: rail.left - 12, right: rail.right + 12, top: -Infinity, bottom: Infinity });
  Array.from(document.querySelectorAll(".quiz-map-decor span, .quiz-departure-decor span"))
    .sort((a, b) => Number(Boolean(b.dataset.decorZone)) - Number(Boolean(a.dataset.decorZone))).forEach(element => {
    const layer = element.offsetParent;
    if (!layer || !element.offsetWidth) return;
    const bounds = layer.getBoundingClientRect();
    if (!quizDecorAnchors.has(element)) {
      // Keep this visit's random arrangement stable during resize and selection changes.
      const clamp = value => Math.max(.04, Math.min(.94, value));
      quizDecorAnchors.set(element, {
        x: clamp(element.offsetLeft / layer.clientWidth + (Math.random() - .5) * .24),
        y: clamp(element.offsetTop / layer.clientHeight + (Math.random() - .5) * .1),
        angle: Math.random() * Math.PI * 2,
        alternatives: Array.from({ length: 100 }, () => ({ x: Math.random(), y: Math.random() })),
      });
      element.style.animationDelay = `${-Math.random() * 10}s`;
      element.style.animationDuration = `${6.5 + Math.random() * 3.5}s`;
    }
    const anchor = quizDecorAnchors.get(element);
    const preferred = { x: anchor.x * layer.clientWidth, y: anchor.y * layer.clientHeight };
    const candidates = [preferred];
    for (let radius = 32; radius <= 384; radius += 32) {
      for (let angle = 0; angle < 8; angle++) candidates.push({ x: preferred.x + Math.cos(anchor.angle + angle * Math.PI / 4) * radius, y: preferred.y + Math.sin(anchor.angle + angle * Math.PI / 4) * radius });
    }
    candidates.push(...anchor.alternatives.map(point => ({ x: point.x * layer.clientWidth, y: point.y * layer.clientHeight })));
    if (element.dataset.decorZone) {
      const firstCard = quizTimelineForm.querySelector(".quiz-prep-type").getBoundingClientRect();
      const flow = quizTimelineForm.querySelector(".quiz-flow-next").getBoundingClientRect();
      const bag = quizTimelineForm.querySelector(".quiz-backpack").getBoundingClientRect();
      const start = element.dataset.decorZone === "preparation" ? -80 : flow.top - bounds.top - 24;
      const end = element.dataset.decorZone === "preparation" ? firstCard.top - bounds.top - element.offsetHeight - 60 : bag.top - bounds.top - element.offsetHeight - 70;
      candidates.splice(0, candidates.length, ...anchor.alternatives.map(point => ({ x: (.18 + point.x * .72) * layer.clientWidth, y: start + point.y * Math.max(0, end - start) })));
    }
    // Reserve room for the full floating motion, not only its current frame.
    const motion = 58;
    const minimumY = element.dataset.decorZone === "preparation" ? -80 : element.closest(".quiz-map-decor") ? quizTimelineForm.getBoundingClientRect().top - bounds.top + motion : motion;
    const position = candidates.find(({ x, y }) => {
      const rect = { left: bounds.left + x - motion, right: bounds.left + x + element.offsetWidth + motion, top: bounds.top + y - motion, bottom: bounds.top + y + element.offsetHeight + motion };
      return x >= motion && x + element.offsetWidth + motion <= layer.clientWidth && y >= minimumY && y + element.offsetHeight + motion <= layer.clientHeight && !obstacles.some(block => rect.left < block.right && rect.right > block.left && rect.top < block.bottom && rect.bottom > block.top);
    });
    element.style.visibility = position ? "visible" : "hidden";
    if (!position) return;
    element.style.left = `${position.x}px`;
    element.style.top = `${position.y}px`;
    element.style.right = "auto";
    element.style.bottom = "auto";
    const spacing = motion + 24;
    obstacles.push({ left: bounds.left + position.x - spacing, right: bounds.left + position.x + element.offsetWidth + spacing, top: bounds.top + position.y - spacing, bottom: bounds.top + position.y + element.offsetHeight + spacing });
  });
}
const quizTimeline = document.createElementNS("http://www.w3.org/2000/svg", "svg");
quizTimeline.classList.add("quiz-story-timeline");
quizTimeline.setAttribute("aria-hidden", "true");
quizTimelineForm.prepend(quizTimeline);
function drawQuizTimeline() {
  const bounds = quizTimelineForm.getBoundingClientRect();
  if (!bounds.width || !bounds.height) return;
  const checkpoints = Array.from(quizTimelineForm.querySelectorAll(".quiz-step-number")).map(element => {
    const rect = element.getBoundingClientRect();
    return { x: rect.left - bounds.left + rect.width / 2, y: rect.top - bounds.top + rect.height / 2, radius: rect.height / 2 + 3 };
  });
  if (checkpoints.length !== 4) return;
  const rail = checkpoints[0].x;
  quizTimeline.setAttribute("viewBox", `0 0 ${bounds.width} ${bounds.height}`);
  const spine = document.createElementNS("http://www.w3.org/2000/svg", "path");
  spine.setAttribute("d", checkpoints.slice(0, -1).map((point, index) =>
    `M${rail},${point.y + point.radius} V${checkpoints[index + 1].y - checkpoints[index + 1].radius}`
  ).join(" "));
  spine.classList.add("quiz-timeline-spine");
  quizTimeline.replaceChildren(spine);
  spaceQuizDecorations();
}
new ResizeObserver(drawQuizTimeline).observe(quizTimelineForm);
window.addEventListener("resize", drawQuizTimeline);
document.fonts.ready.then(drawQuizTimeline);
new ResizeObserver(spaceQuizDecorations).observe(learningElement("quiz-start"));
for (const friend of ["earth", "water", "wind"]) {
  learningElement(`quiz-${friend}-friend`).addEventListener("click", () => {
    const lines = quizFriendLines[friend];
    speakQuizFriend(friend, lines[quizFriendVisits[friend]++ % lines.length]);
  });
}
function animateQuiz(element, frames, options) {
  if (quizMotionPreference.matches || document.hidden || learningElement("quiz-content").hidden) return;
  const animation = element.animate(frames, options);
  quizAnimations.add(animation);
  animation.finished.then(() => quizAnimations.delete(animation), () => quizAnimations.delete(animation));
}
function stopQuizAnimations() {
  for (const animation of quizAnimations) animation.cancel();
  quizAnimations.clear();
}
quizMotionPreference.addEventListener("change", () => { if (quizMotionPreference.matches) { stopQuizAnimations(); clearQuizCelebration(); } });
document.addEventListener("visibilitychange", () => { if (document.hidden) { stopQuizAnimations(); clearQuizCelebration(); } });

function updateQuizJourney() {
  // 題目進度由文字與原生 progress 顯示，不另外放置裝飾性路線圖。
}

async function loadResources() {
  if (resourcesLoading) return;
  resourcesLoading = true;
  learningElement("resources-retry").hidden = true;
  learningElement("resources-status").textContent = "正在載入教材…";
  try {
    const { resources } = await learningRequest("/api/resources");
    learningElement("resources-list").replaceChildren(...resources.map(resource => {
      const card = learningNode("article", undefined, "resource-card");
      const icon = learningNode("span", "📂", "resource-icon");
      icon.setAttribute("aria-hidden", "true");
      const body = learningNode("div");
      const heading = learningNode("h2", resource.title);
      const link = learningNode("a", "開啟教材資料夾 ↗", "learning-primary");
      link.href = resource.folderUrl;
      link.target = "_blank";
      link.rel = "noopener noreferrer";
      body.append(heading);
      if (resource.description?.trim()) body.append(learningNode("p", resource.description));
      body.append(link);
      card.append(icon, body);
      return card;
    }));
    learningElement("resources-status").textContent = resources.length ? `共 ${resources.length} 份教材` : "目前尚無教材。";
    resourcesLoaded = true;
  } catch (error) {
    learningElement("resources-status").textContent = error.message || "教材暫時無法載入。";
    learningElement("resources-retry").hidden = false;
  } finally { resourcesLoading = false; }
}

async function loadQuizCatalog() {
  if (quizLoading) return;
  quizLoading = true;
  learningElement("quiz-retry").hidden = true;
  try {
    const catalog = await learningRequest("/api/quiz/catalog");
    quizCatalogData = catalog;
    if (!catalog.total) {
      learningElement("quiz-status").textContent = "新的科學冒險正在準備中，晚點再來找我們吧！";
      learningElement("quiz-setup").hidden = true;
      quizLoaded = true;
      return;
    }
    for (const [id, values] of [["quiz-type", catalog.types], ["quiz-difficulty", catalog.difficulties]]) {
      const select = learningElement(id);
      select.append(...values.map(value => {
        const option = learningNode("option", value);
        option.value = value;
        return option;
      }));
    }
    document.querySelectorAll(".quiz-setting-choices").forEach(group => {
      const select = learningElement(group.dataset.setting);
      group.replaceChildren(...Array.from(select.options).map(option => {
        const label = option.value === "all" ? "全部" : option.value === "" ? "全部" : option.textContent;
        const button = learningNode("button", label, "quiz-setting-choice");
        button.type = "button";
        button.dataset.value = option.value;
        button.setAttribute("aria-pressed", String(option.value === select.value));
        button.addEventListener("click", () => {
          select.value = option.value;
          select.dispatchEvent(new Event("change", { bubbles: true }));
        });
        return button;
      }));
      if (!select.dataset.choicesBound) {
        select.addEventListener("change", () => {
          group.querySelectorAll("button").forEach(button => button.setAttribute("aria-pressed", String(button.dataset.value === select.value)));
        });
        select.dataset.choicesBound = "true";
      }
    });
    learningElement("quiz-bank-count").textContent = `${catalog.topics.length} 個主題 · ${catalog.total} 道科學謎題`;
    const topicWorlds = {
      "柏努利與基礎流力": [1, "💨"], "搶救堰塞湖": [2, "🏞️"], "大地在搖晃": [3, "⛰️"],
      "超級颱風眼": [4, "🌀"], "迷你都市淹水大作戰": [5, "🏙️"],
    };
    const topicCards = catalog.topics.map(topic => ({ topic, world: topicWorlds[topic]?.[0] || 1, icon: topicWorlds[topic]?.[1] || "🔎" }));
    const topicOrder = [1, 4, 3, 2, 5];
    topicCards.sort((a, b) => topicOrder.indexOf(a.world) - topicOrder.indexOf(b.world));
    learningElement("quiz-topic-picks").replaceChildren(...topicCards.map(({ topic, world, icon }) => {
      const button = learningNode("button", undefined, "quiz-topic-pick");
      button.dataset.world = world;
      const art = learningNode("span", undefined, "quiz-topic-art");
      art.setAttribute("aria-hidden", "true");
      art.append(learningNode("span", icon, "quiz-topic-symbol"));
      const copy = learningNode("span", undefined, "quiz-topic-copy");
      copy.append(learningNode("strong", topic));
      const selectionMark = learningNode("span", "✓ 已選入", "quiz-topic-check");
      selectionMark.setAttribute("aria-hidden", "true");
      button.append(art, copy, selectionMark);
      button.type = "button";
      button.dataset.topic = topic;
      button.setAttribute("aria-pressed", "false");
      button.addEventListener("click", () => {
        if (selectedQuizTopics.has(topic)) selectedQuizTopics.delete(topic);
        else selectedQuizTopics.add(topic);
        syncTopicPicks();
      });
      return button;
    }));
    learningElement("quiz-status").textContent = "";
    learningElement("quiz-setup").hidden = false;
    syncTopicPicks();
    quizLoaded = true;
  } catch (error) {
    learningElement("quiz-status").textContent = error.message || "題庫暫時無法載入。";
    learningElement("quiz-retry").hidden = false;
  } finally { quizLoading = false; }
}

function syncTopicPicks() {
  if (!quizCatalogData) return;
  document.querySelectorAll(".quiz-topic-pick").forEach(button => {
    button.setAttribute("aria-pressed", String(selectedQuizTopics.has(button.dataset.topic)));
  });
  const type = learningElement("quiz-type").value;
  const difficulty = learningElement("quiz-difficulty").value;
  quizAvailableCount = quizCatalogData.groups.filter(group => selectedQuizTopics.has(group.topic) && (!type || group.type === type) && (!difficulty || group.difficulty === difficulty)).reduce((sum, group) => sum + group.count, 0);
  const note = learningElement("quiz-selection-note");
  const topics = quizCatalogData.topics.filter(topic => selectedQuizTopics.has(topic));
  const topicLine = learningNode("div", undefined, "quiz-backpack-topics");
  topicLine.append(...(topics.length ? topics.map(topic => learningNode("span", topic, "quiz-backpack-topic")) : [learningNode("span", "先選好世界，再來整理背包吧！", "quiz-backpack-empty")]));
  const allQuestions = learningElement("quiz-count").value === "all";
  const requested = allQuestions ? quizAvailableCount : Number(learningElement("quiz-count").value);
  const settings = learningNode("div", undefined, "quiz-pass-settings");
  const actualCount = topics.length ? Math.min(requested, quizAvailableCount) : requested;
  settings.append(learningNode("span", `🎲 ${type || '選擇＋是非'}`),
    learningNode("span", `⛰️ ${difficulty || '全部難度'}`),
    learningNode("span", `🚩 ${allQuestions && !topics.length ? '全部題目' : actualCount + ' 題'}`));
  note.replaceChildren(topicLine, settings);
  learningElement("quiz-start").disabled = quizBusy || !quizAvailableCount;
  if (topics.length && !quizAvailableCount) speakQuizFriend("earth", "這組條件還沒有題目，換個難度或題型，再試一次吧！");
}

function setQuizBuddy(mood, message) {
  learningElement("quiz-buddy").dataset.mood = mood;
  speakQuizFriend("water", message);
}

function clearQuizCelebration() {
  document.querySelectorAll(".quiz-confetti").forEach(burst => burst.remove());
}

function celebrateQuiz(container) {
  clearQuizCelebration();
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches || learningElement("quiz-content").hidden) return;
  const burst = learningNode("div", undefined, "quiz-confetti");
  burst.setAttribute("aria-hidden", "true");
  for (let index = 0; index < 14; index++) {
    const piece = learningNode("span", ["✦", "●", "◆"][index % 3]);
    piece.style.setProperty("--piece-x", `${Math.round((index / 13 - 0.5) * 480)}px`);
    piece.style.setProperty("--piece-y", `${-55 - Math.round(Math.random() * 100)}px`);
    piece.style.setProperty("--piece-turn", `${index % 2 ? 170 : -160}deg`);
    piece.style.setProperty("--piece-color", ["#ed9b34", "#3babb3", "#9c7bd6", "#df879b"][index % 4]);
    burst.append(piece);
  }
  burst.addEventListener("animationend", event => { if (event.target === burst) burst.remove(); });
  container.append(burst);
}

function showPracticeQuestion() {
  const question = practice[practiceIndex];
  // Tell the contextual tutor which published quiz item the learner is viewing.
  // Without this event the AI launcher remains hidden even during a question.
  window.dispatchEvent(new CustomEvent("learning-context", {
    detail: { kind: "quiz", id: question.id },
  }));
  stopQuizAnimations();
  clearQuizCelebration();
  setQuizBuddy("thinking", "小水滴也在想答案！慢慢想，你一定能發現線索。 ");
  learningElement("quiz-round-message").textContent = ["💧 小水滴陪你一起動動腦！", "🔎 小小科學家，找找答案的線索！", "🌱 每想一題，知識就長大一點！"][practiceIndex % 3];
  learningElement("quiz-progress").textContent = `🔎 第 ${practiceIndex + 1} / ${practice.length} 題`;
  learningElement("quiz-score").textContent = `⭐ 答對 ${practiceAnswers.filter(result => result.correct).length} 題`;
  learningElement("quiz-progress-bar").max = practice.length;
  learningElement("quiz-progress-bar").value = practiceAnswers.length;
  learningElement("quiz-meta").textContent = `${question.topic} · ${question.type} · 難度：${question.difficulty}`;
  learningElement("quiz-question").textContent = question.question;
  animateQuiz(learningElement("quiz-round-message"), [{ transform: "scale(.8) rotate(-4deg)", opacity: 0 }, { transform: "scale(1.05) rotate(2deg)", opacity: 1 }, { transform: "none", opacity: 1 }], { duration: 600, easing: "ease-out" });
  learningElement("quiz-options").replaceChildren(...Object.entries(question.options).map(([key, text]) => {
    const label = learningNode("label", undefined, "quiz-option");
    const input = document.createElement("input");
    input.type = "radio";
    input.name = "quiz-choice";
    input.value = key;
    input.required = true;
    input.setAttribute("aria-label", question.type === "是非題" ? text : `${key}. ${text}`);
    const badge = learningNode("span", question.type === "是非題" ? (key === "O" ? "○" : "×") : key, "quiz-option-badge");
    badge.setAttribute("aria-hidden", "true");
    label.append(input, badge, learningNode("span", text));
    input.addEventListener("change", () => {
      animateQuiz(label, [{ transform: "scale(1)" }, { transform: "scale(.97)" }, { transform: "scale(1.025)" }, { transform: "scale(1)" }], { duration: 380, easing: "ease-out" });
      animateQuiz(sessionBuddy.querySelector(".buddy-drop"), [{ transform: "rotate(0)" }, { transform: "rotate(-13deg) translateY(-10px)" }, { transform: "rotate(8deg)" }, { transform: "rotate(0)" }], { duration: 650, easing: "ease-out" });
      learningElement("quiz-round-message").textContent = "選好了嗎？按下確認，一起揭曉答案！";
    });
    return label;
  }));
  learningElement("quiz-submit").hidden = false;
  learningElement("quiz-submit").disabled = false;
  learningElement("quiz-submit").textContent = "確認答案";
  learningElement("quiz-answer-error").textContent = "";
  learningElement("quiz-feedback").hidden = true;
  learningElement("quiz-feedback").replaceChildren();
  learningElement("quiz-next").hidden = true;
  window.dispatchEvent(new CustomEvent("learning-context", {
    detail: { kind: "quiz", id: question.id },
  }));
  animateQuiz(learningElement("quiz-question"), [{ opacity: 0, transform: "translateX(-18px)" }, { opacity: 1, transform: "translateX(0)" }], { duration: 450, easing: "ease-out" });
  document.querySelectorAll(".quiz-option").forEach((option, index) => {
    animateQuiz(option, [{ opacity: 0, transform: "translateY(28px) scale(.94)" }, { opacity: 1, transform: "translateY(-4px) scale(1.01)" }, { opacity: 1, transform: "none" }], { duration: 520, delay: index * 85, easing: "ease-out", fill: "backwards" });
  });
  updateQuizJourney();
  learningElement("quiz-session").scrollIntoView({ block: "start", behavior: "instant" });
  learningElement("quiz-question").focus({ preventScroll: true });
}

async function startPractice(event) {
  event?.preventDefault();
  if (quizBusy) return;
  if (!selectedQuizTopics.size || !quizAvailableCount) {
    speakQuizFriend("water", "先選一個或幾個喜歡的主題，我們就能出發囉！");
    return;
  }
  quizBusy = true;
  learningElement("quiz-start").disabled = true;
  learningElement("quiz-again").disabled = true;
  learningElement("quiz-status").textContent = "正在準備題目…";
  try {
    const parameters = new URLSearchParams({
      type: learningElement("quiz-type").value,
      difficulty: learningElement("quiz-difficulty").value,
      count: learningElement("quiz-count").value,
    });
    selectedQuizTopics.forEach(topic => parameters.append("topic", topic));
    const data = await learningRequest("/api/quiz/questions?" + parameters);
    if (!data.questions.length) {
      learningElement("quiz-status").textContent = "這組條件目前沒有題目，請試試其他選項。";
      return;
    }
    practice = data.questions;
    practiceIndex = 0;
    practiceAnswers = [];
    learningElement("quiz-status").textContent = "";
    learningElement("quiz-setup").hidden = true;
    learningElement("quiz-results").hidden = true;
    learningElement("quiz-session").hidden = false;
    showPracticeQuestion();
  } catch (error) {
    learningElement("quiz-status").textContent = error.message || "無法準備題目，請再試一次。";
  } finally {
    quizBusy = false;
    learningElement("quiz-start").disabled = !quizAvailableCount;
    learningElement("quiz-again").disabled = false;
  }
}

async function submitPracticeAnswer(event) {
  event.preventDefault();
  if (quizBusy || practiceAnswers.length > practiceIndex) return;
  const selected = document.querySelector('input[name="quiz-choice"]:checked');
  if (!selected) return;
  quizBusy = true;
  learningElement("quiz-submit").disabled = true;
  learningElement("quiz-submit").textContent = "正在核對…";
  learningElement("quiz-answer-error").textContent = "";
  const choice = selected.value;
  const question = practice[practiceIndex];
  document.querySelectorAll('input[name="quiz-choice"]').forEach(input => { input.disabled = true; });
  try {
    const result = await learningRequest("/api/quiz/answer", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ id: question.id, choice }),
    });
    practiceAnswers.push(result);
    document.querySelectorAll('input[name="quiz-choice"]').forEach(input => {
      if (input.value === result.answer) {
        input.parentElement.classList.add("is-answer");
        input.parentElement.append(learningNode("span", result.correct ? "✓ 你答對了" : "✓ 正確答案", "quiz-option-status"));
      } else if (input.value === choice) {
        input.parentElement.classList.add("is-wrong");
        input.parentElement.append(learningNode("span", "× 你的答案", "quiz-option-status"));
      }
    });
    const feedback = learningElement("quiz-feedback");
    feedback.replaceChildren(
      learningNode("h3", result.correct ? "答對了！你發現科學的秘密了！" : "沒關係，我們一起學起來！"),
      learningNode("p", `正確答案：${question.type === "選擇題" ? result.answer + '. ' : ''}${result.answerText}`),
      learningNode("p", result.explanation),
    );
    feedback.dataset.result = result.correct ? "correct" : "learn";
    feedback.hidden = false;
    setQuizBuddy(result.correct ? "happy" : "cheer", result.correct ? "耶！我們又解開一個科學謎題！" : "每次嘗試都會進步，小水滴陪你一起學！");
    learningElement("quiz-round-message").textContent = result.correct ? "🌟 擊掌！這一題成功解鎖！" : "💧 新知識收進口袋，下一題一起加油！";
    if (result.correct) celebrateQuiz(feedback);
    learningElement("quiz-score").textContent = `⭐ 答對 ${practiceAnswers.filter(answer => answer.correct).length} 題`;
    learningElement("quiz-progress-bar").value = practiceAnswers.length;
    updateQuizJourney();
    animateQuiz(learningElement("quiz-score"), [{ transform: "scale(1)" }, { transform: "scale(1.15)" }, { transform: "scale(1)" }], { duration: 500, easing: "ease-out" });
    learningElement("quiz-submit").hidden = true;
    learningElement("quiz-next").textContent = practiceIndex + 1 === practice.length ? "查看練習成果 →" : "下一題 →";
    learningElement("quiz-next").hidden = false;
    window.dispatchEvent(new CustomEvent("learning-context", {
      detail: { kind: "quiz", id: question.id },
    }));
    animateQuiz(learningElement("quiz-next"), [{ transform: "translateY(0)" }, { transform: "translateY(-5px)" }, { transform: "translateY(0)" }], { duration: 650, iterations: 2, easing: "ease-in-out" });
  } catch (error) {
    learningElement("quiz-answer-error").textContent = error.message || "無法核對答案，請再試一次。";
    document.querySelectorAll('input[name="quiz-choice"]').forEach(input => { input.disabled = false; });
  } finally {
    quizBusy = false;
    learningElement("quiz-submit").disabled = false;
    learningElement("quiz-submit").textContent = "確認答案";
  }
}

function showPracticeResults() {
  window.dispatchEvent(new CustomEvent("learning-context", { detail: null }));
  learningElement("quiz-session").hidden = true;
  learningElement("quiz-results").hidden = false;
  const correct = practiceAnswers.filter(result => result.correct).length;
  setQuizBuddy("happy", "完成探險啦！每一次動腦，都是了不起的發現！");
  learningElement("quiz-result-score").textContent = `${Math.round(correct / practice.length * 100)} 分`;
  learningElement("quiz-result-message").textContent = `完成 ${practice.length} 題，答對 ${correct} 題、答錯 ${practice.length - correct} 題。回顧解析，讓科學知識更熟悉！`;
  learningElement("quiz-review").replaceChildren(...practice.map((question, index) => {
    const result = practiceAnswers[index];
    const details = learningNode("details");
    details.append(learningNode("summary", `${result.correct ? '✓ 答對' : '✗ 答錯'}｜${index + 1}. ${question.question}`),
      learningNode("p", `你的答案：${question.options[result.choice]}\n正確答案：${result.answerText}`),
      learningNode("p", result.explanation));
    return details;
  }));
  learningElement("quiz-result-title").focus();
  celebrateQuiz(learningElement("quiz-results"));
}

function resetPractice() {
  if (quizBusy) return;
  window.dispatchEvent(new CustomEvent("learning-context", { detail: null }));
  learningElement("quiz-setup").hidden = false;
  learningElement("quiz-session").hidden = true;
  learningElement("quiz-results").hidden = true;
  learningElement("quiz-status").textContent = "";
  clearQuizCelebration();
  setQuizBuddy("ready", "下一趟想探索什麼呢？小水滴準備好出發了！");
  document.querySelector('.quiz-topic-pick[aria-pressed="true"]')?.focus();
}
function syncLearningRoute() {
  // index.html 同時承載教材和測驗兩個舊路由；獨立的 quiz.html 則永遠顯示測驗。
  // 這樣保留舊網址的相容性，也讓一頁一個 HTML 時不必複製兩套測驗流程。
  const standaloneQuizPage = document.body.dataset.page === "quiz";
  const resourceContent = learningElement("resources-content");
  const quizContent = learningElement("quiz-content");
  const resourceRoute = !standaloneQuizPage && location.hash === "#resources";
  const quizRoute = standaloneQuizPage || location.hash === "#quiz";

  if (resourceContent) resourceContent.hidden = !resourceRoute;
  if (quizContent) quizContent.hidden = !quizRoute;
  learningElement("page-title").classList.remove("quiz-jumping-title");
  learningElement("page-title").removeAttribute("aria-label");
  if (!quizRoute) { clearQuizCelebration(); stopQuizAnimations(); }
  if (resourceRoute && !resourcesLoaded) loadResources();
  if (quizRoute && !quizLoaded) loadQuizCatalog();
}
learningElement("resources-retry")?.addEventListener("click", loadResources);
learningElement("quiz-retry").addEventListener("click", loadQuizCatalog);
learningElement("quiz-setup").addEventListener("submit", startPractice);
learningElement("quiz-answer-form").addEventListener("submit", submitPracticeAnswer);
learningElement("quiz-next").addEventListener("click", () => {
  practiceIndex += 1;
  if (practiceIndex < practice.length) showPracticeQuestion();
  else showPracticeResults();
});
learningElement("quiz-again").addEventListener("click", startPractice);
learningElement("quiz-reset").addEventListener("click", resetPractice);
learningElement("quiz-count").addEventListener("change", syncTopicPicks);
learningElement("quiz-type").addEventListener("change", syncTopicPicks);
learningElement("quiz-difficulty").addEventListener("change", syncTopicPicks);
window.addEventListener("hashchange", syncLearningRoute);
syncLearningRoute();


