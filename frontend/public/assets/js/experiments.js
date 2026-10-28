/*
 * 實驗影片的公開控制器。清單來自 /api/experiments，搜尋只在已取得的公開資料
 * 上執行；封面由本站資產提供，Drive 播放器只在學生點選後才建立 iframe。關閉視窗
 * 或離開頁面必須移除 iframe，避免背景播放與不必要的第三方連線持續存在。
 */

const experimentsContent = document.getElementById("experiments-content");
const experimentsGrid = document.getElementById("experiments-grid");
const experimentsMessage = document.getElementById("experiments-message");
const experimentsCount = document.getElementById("experiments-count");
const experimentSearch = document.getElementById("experiment-search");
const experimentsRetry = document.getElementById("experiments-retry");
const player = document.getElementById("experiment-player");
const playerFrame = document.getElementById("player-frame");
let videos = null;
let loading = false;

/**
 * 先填入影片標題及 Drive 預覽網址，再開啟播放對話框。
 * iframe 只在學生點擊時建立，關閉後會移除，避免影片在背景繼續播放。
 */
function openExperiment(video) {
  document.getElementById("player-title").textContent = video.title;
  document.getElementById("player-link").href = video.viewUrl;
  const iframe = document.createElement("iframe");
  iframe.src = video.previewUrl;
  iframe.title = video.title + "｜實驗影片";
  iframe.allow = "fullscreen";
  iframe.allowFullscreen = true;
  iframe.referrerPolicy = "no-referrer";
  playerFrame.replaceChildren(iframe);
  player.showModal();
}

/**
 * 依搜尋字串過濾已載入的影片，再以 DOM 建立卡片。
 * 封面載入失敗時退回預設播放圖示；標題、說明和搜尋文字都不當成 HTML。
 */
function renderExperiments() {
  if (!videos) {
    return;
  }
  const keyword = experimentSearch.value.trim().toLocaleLowerCase();
  const visible = videos.filter((video) => video.title.toLocaleLowerCase().includes(keyword));
  experimentsCount.textContent = keyword
    ? `找到 ${visible.length} / ${videos.length} 部影片`
    : `共 ${videos.length} 部實驗影片`;
  experimentsMessage.textContent = !videos.length
    ? "目前尚無實驗影片。"
    : !visible.length
      ? "找不到符合的影片，請試試其他名稱。"
      : "";
  experimentsMessage.hidden = visible.length > 0;
  experimentsGrid.replaceChildren(
    ...visible.map((video) => {
      const card = document.createElement("article");
      card.className = "experiment-card";
      const play = document.createElement("button");
      play.type = "button";
      play.className = "experiment-cover";
      play.setAttribute("aria-label", "播放「" + video.title + "」");
      if (video.coverUrl) {
        const image = document.createElement("img");
        image.className = "experiment-cover-image";
        image.alt = "";
        image.width = 960;
        image.height = 540;
        image.loading = "lazy";
        image.decoding = "async";
        image.addEventListener("load", () => play.classList.add("has-cover"));
        image.addEventListener("error", () => {
          image.remove();
          play.classList.remove("has-cover");
        });
        image.src = video.coverUrl;
        play.append(image);
      }
      const icon = document.createElement("span");
      icon.className = "experiment-play-icon";
      icon.textContent = "▶";
      icon.setAttribute("aria-hidden", "true");
      const cue = document.createElement("span");
      cue.className = "experiment-cover-cue";
      cue.textContent = "觀看實驗";
      play.append(icon, cue);
      play.addEventListener("click", () => openExperiment(video));
      const body = document.createElement("div");
      body.className = "experiment-card-body";
      const label = document.createElement("span");
      label.className = "experiment-label";
      label.textContent = "實驗影片";
      const title = document.createElement("h2");
      title.textContent = video.title;
      body.append(label, title);
      if (video.description) {
        const description = document.createElement("p");
        description.className = "experiment-description";
        description.textContent = video.description;
        body.append(description);
      }
      card.append(play, body);

      return card;
    }),
  );
}

/**
 * 首次進入才載入影片資料，成功結果保留在記憶體供再次切換使用。
 * loading 防止重複請求；file: 預覽無法呼叫 API，因此顯示專用提示。
 */
async function loadExperiments() {
  if (loading) {
    return;
  }
  loading = true;
  experimentsRetry.hidden = true;
  experimentsMessage.hidden = false;
  experimentsMessage.textContent = "正在載入影片…";
  experimentsGrid.setAttribute("aria-busy", "true");
  try {
    if (location.protocol === "file:") {
      throw new Error("File preview");
    }
    const response = await fetch("/api/experiments", { cache: "no-store" });
    if (!response.ok) {
      throw new Error("Unavailable");
    }
    const data = await response.json();
    if (!Array.isArray(data.videos)) {
      throw new Error("Invalid videos");
    }
    videos = data.videos;
    renderExperiments();
  } catch {
    experimentsMessage.textContent =
      location.protocol === "file:"
        ? "請透過網站網址開啟，即可載入實驗影片。"
        : "影片暫時無法載入，請稍後再試。";
    experimentsRetry.hidden = false;
  } finally {
    loading = false;
    experimentsGrid.setAttribute("aria-busy", "false");
  }
}

/**
 * 相容舊首頁的 hash 路由，也支援新的 experiments.html 實體頁。
 * 離開舊路由時會關閉播放器；實體頁則在載入後立即取得影片。
 */
function syncExperimentsRoute() {
  const standalonePage = document.body.dataset.page === "experiments";
  const active = standalonePage || location.hash === "#experiments";
  experimentsContent.hidden = !active;
  if (active && videos === null) {
    loadExperiments();
  }
  if (!active && player.open) {
    player.close();
  }
}

experimentSearch.addEventListener("input", renderExperiments);
experimentsRetry.addEventListener("click", loadExperiments);
document.getElementById("player-close").addEventListener("click", () => player.close());
player.addEventListener("close", () => playerFrame.replaceChildren());
window.addEventListener("pagehide", () => {
  if (player.open) {
    player.close();
  }
});
window.addEventListener("hashchange", syncExperimentsRoute);
syncExperimentsRoute();
