(() => {
  const make = (tag, text, className) => {
    const element = document.createElement(tag);
    if (text !== undefined) element.textContent = text;
    if (className) element.className = className;
    return element;
  };
  const button = (text, handler, className = "ai-secondary") => {
    const element = make("button", text, className); element.type = "button";
    element.addEventListener("click", handler); return element;
  };
  const qa = make("section", undefined, "ai-qa-page"); qa.id = "ai-qa-content"; qa.hidden = true;
  const intro = make("div", undefined, "ai-intro");
  intro.append(make("span", "💬", "ai-intro-icon"), make("h2", "把好奇，變成新發現"),
    make("p", "你可以問老師提供的教材內容；我會依教材帶你一步步找答案。教材沒有的資訊，我會誠實告訴你。"));
  const notice = make("p", "不用填姓名。對話只保留在這次頁面中，重新整理就會清除。", "ai-note");
  qa.append(intro, notice);
  document.getElementById("feature-page").append(qa);
  const launcher = button("💡 詢問 AI 助教", () => openTutor(), "ai-launcher");
  launcher.setAttribute("aria-controls", "ai-tutor-window"); launcher.setAttribute("aria-expanded", "false"); launcher.hidden = true;
  const tutor = make("aside", undefined, "ai-tutor-window"); tutor.id = "ai-tutor-window"; tutor.hidden = true;
  tutor.setAttribute("role", "dialog"); tutor.setAttribute("aria-modal", "false"); tutor.setAttribute("aria-labelledby", "ai-tutor-title");
  const header = make("header", undefined, "ai-tutor-header"); const heading = make("div");
  const title = make("h2", "💧 AI 線上助教"); title.id = "ai-tutor-title";
  const contextLabel = make("p", "陪你找線索，一次想一小步"); heading.append(title, contextLabel);
  header.append(heading, button("✕", closeTutor)); header.lastChild.setAttribute("aria-label", "關閉 AI 助教");
  tutor.append(header); document.body.append(launcher, tutor);
  let context = null;
  let gameContext = null;
  let returnFocus = null;

  function buildChat(container, mode, greeting) {
    const toolbar = make("div", undefined, "ai-chat-toolbar");
    const clear = button("重新對話", () => { if (!state.busy) reset(); });
    // The reset control is enough context here; the introductory copy already
    // explains that answers are based on the teacher's materials.
    toolbar.append(clear);
    const log = make("div", undefined, "ai-chat-log"); log.setAttribute("role", "log"); log.setAttribute("aria-live", "polite"); log.setAttribute("aria-label", "聊天紀錄");
    const form = make("form", undefined, "ai-chat-form");
    const label = make("label", mode === "qa" ? "你想知道什麼？" : "你遇到什麼問題？");
    const input = make("textarea"); input.id = `ai-${mode}-input`; input.rows = 2; input.maxLength = 1200; input.required = true;
    input.placeholder = mode === "qa" ? "輸入你的問題…" : "告訴我你卡住的地方…";
    input.setAttribute("aria-describedby", `ai-${mode}-status`); label.htmlFor = input.id;
    const row = make("div", undefined, "ai-input-row"); const send = make("button", "送出問題 ↗", "ai-send"); send.type = "submit";
    row.append(input, send); form.append(label, row);
    const status = make("p", "", "ai-chat-status"); status.id = `ai-${mode}-status`; status.setAttribute("role", "status");
    const state = { busy: false, generation: 0, conversationId: null, controller: null, count: 0 };
    container.append(toolbar, log, form, status);
    function append(role, text, sources = []) {
      const entry = make("article", undefined, `ai-message ai-message-${role}`);

      // A visual speaker marker makes each line easy to follow without relying
      // only on colour or whether the message sits on the left or right.
      const avatar = make("span", role === "user" ? "🧑‍🎓" : "🤖", `ai-avatar ai-avatar-${role}`);
      avatar.setAttribute("aria-hidden", "true");
      const paper = make("div", undefined, "ai-message-paper");
      paper.append(make("strong", role === "user" ? "你" : mode === "qa" ? "教材問答夥伴" : "小水滴助教"), make("p", text));

      if (sources.length) {
        for (const source of sources.filter((item) => item.imageUrl)) {
          const figure = make("figure", undefined, "ai-source-image");
          const link = make("a"); link.href = source.imageSourceUrl || source.imageUrl; link.target = "_blank"; link.rel = "noopener noreferrer";
          const image = make("img"); image.src = source.imageUrl; image.alt = `題目圖｜${source.title}`; image.loading = "lazy";
          link.append(image);
          figure.append(link);
          paper.append(figure);
        }
        const sourceBox = make("div", undefined, "ai-sources"); sourceBox.append(make("strong", "依據教材"));
        for (const source of sources) {
          const a = make("a", `${source.title} ↗`); a.href = source.url; a.target = "_blank"; a.rel = "noopener noreferrer";
          sourceBox.append(a);
        }
        paper.append(sourceBox);
      }

      entry.append(avatar, paper);
      log.append(entry); log.scrollTop = log.scrollHeight;
    }
    function reset() {
      state.controller?.abort(); state.generation++; state.busy = false; state.conversationId = null; state.count = 0;
      send.disabled = false; clear.disabled = false; input.disabled = false; status.textContent = ""; input.value = "";
      log.replaceChildren(); append("assistant", greeting);
    }
    form.addEventListener("submit", async event => {
      event.preventDefault(); if (state.busy || !input.value.trim()) return;
      if (mode === "tutor" && !activeContext()) { status.textContent = "請先開始一題測驗或選擇遊戲任務，再來找我一起想喔！"; return; }
      const question = input.value.trim(); const generation = state.generation;
      const controller = new AbortController(); state.controller = controller;
      const timeout = setTimeout(() => controller.abort(), 120000);
      state.busy = true; send.disabled = true; clear.disabled = true; input.disabled = true;
      status.textContent = mode === "qa" ? "正在教材裡找線索…" : "正在想一個小提示…";
      append("user", question); input.value = "";
      try {
        const response = await fetch(`/api/ai/${mode}`, { method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ question, conversationId: state.conversationId, ...(mode === "tutor" ? { context: activeContext() } : {}) }), signal: controller.signal });
        const data = await response.json(); if (generation !== state.generation) return;
        if (!response.ok) throw new Error(data.error || "現在無法回答，請稍後再試。");
        state.conversationId = data.conversationId; append("assistant", data.answer, data.sources); status.textContent = "";
        if (++state.count >= 30) { state.conversationId = null; state.count = 0; status.textContent = "已開始新一段對話，先前訊息仍可在上方查看。"; }
      } catch (error) {
        if (generation !== state.generation) return;
        status.textContent = error.name === "AbortError" ? "這次等得有點久，請再試一次。" : error.message;
        input.value = question;
      } finally {
        clearTimeout(timeout);
        if (generation === state.generation) { state.busy = false; send.disabled = false; clear.disabled = false; input.disabled = false;
          if (mode === "qa" || !tutor.hidden) input.focus({ preventScroll: true }); }
      }
    });
    reset(); return { reset, input };
  }
  const qaChat = buildChat(qa, "qa", "你好！想問什麼呢？我會從老師提供的教材裡找線索，陪你一步步找答案。");
  const tutorChat = buildChat(tutor, "tutor", "你遇到什麼問題呢？");
  function activeContext() { return location.hash === "#quiz" ? context : location.hash === "#games" ? gameContext : null; }
  function openTutor() {
    if (!activeContext()) return;
    returnFocus = document.activeElement;
    tutor.hidden = false; launcher.hidden = true; launcher.setAttribute("aria-expanded", "true");
    contextLabel.textContent = activeContext() ? "陪你找線索，一次想一小步" : "先開始測驗或選擇遊戲任務吧！";
    tutorChat.input.focus();
  }
  function closeTutor(restore = true) {
    tutor.hidden = true; launcher.setAttribute("aria-expanded", "false"); syncTutorAvailability();
    if (restore && returnFocus?.isConnected && !returnFocus.hidden) returnFocus.focus({ preventScroll: true });
  }
  tutor.addEventListener("keydown", event => { if (event.key === "Escape") { event.stopPropagation(); closeTutor(); } });
  window.addEventListener("learning-context", event => {
    const next = event.detail?.kind === "quiz" && typeof event.detail.id === "string" ? { kind: "quiz", id: event.detail.id } : null;
    if (JSON.stringify(next) !== JSON.stringify(context)) { context = next; tutorChat.reset(); }
    contextLabel.textContent = activeContext() ? "陪你找線索，一次想一小步" : "先開始測驗或選擇遊戲任務吧！";
    syncTutorAvailability();
  });
  // Future games emit only public task identifiers. Their task text must be registered on the server.
  window.addEventListener("game-learning-context", event => {
    const next = typeof event.detail?.id === "string" && typeof event.detail?.taskId === "string" ? { kind: "game", id: event.detail.id, taskId: event.detail.taskId } : null;
    if (JSON.stringify(next) !== JSON.stringify(gameContext)) { gameContext = next; tutorChat.reset(); }
    syncTutorAvailability();
  });
  function syncTutorAvailability() {
    const available = Boolean(activeContext());
    const quizAnswerActions = document.getElementById("quiz-answer-actions");
    const quizNextActions = document.getElementById("quiz-next-actions");
    const quizNext = document.getElementById("quiz-next");
    const quizSession = document.getElementById("quiz-session");
    const inlineWithQuizAnswer = location.hash === "#quiz" && !quizSession?.hidden && Boolean(quizAnswerActions);
    const quizAnswerRevealed = inlineWithQuizAnswer && !quizNext?.hidden && Boolean(quizNextActions);
    const launcherDestination = quizAnswerRevealed ? quizNextActions : inlineWithQuizAnswer ? quizAnswerActions : document.body;
    if (launcher.parentElement !== launcherDestination) launcherDestination.append(launcher);
    launcher.classList.toggle("ai-launcher-inline", inlineWithQuizAnswer);
    if (!available) tutor.hidden = true;
    launcher.hidden = !available || !tutor.hidden;
    launcher.setAttribute("aria-expanded", String(!tutor.hidden));
  }
  function syncRoute() {
    qa.hidden = location.hash !== "#ai-qa";
    if (!["#quiz", "#games"].includes(location.hash)) tutor.hidden = true;
    syncTutorAvailability();
  }
  window.addEventListener("hashchange", () => { tutorChat.reset(); tutor.hidden = true; syncRoute(); });
  window.addEventListener("pagehide", () => { qaChat.reset(); tutorChat.reset(); });
  fetch("/api/ai/status").then(r => r.json()).then(data => {
    if (!data.configured) notice.textContent = "AI 服務連線準備中，請老師完成設定後再提問。不需要填寫姓名。";
  }).catch(() => { notice.textContent = "目前無法確認 AI 連線狀態，請稍後再試。"; });
  syncRoute();
})();
