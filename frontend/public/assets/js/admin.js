// 主要功能：管理後台導覽、內容清單、表單驗證、編輯發布、題庫匯入、資料匯出與老師登出。
/*
 * 後台控制器：hash 路由 → 取得受保護 API 資料 → 清單／編輯表單 → 送出變更。
 * records、filters、page 控制目前清單；editorDirty 用來提醒尚未儲存的表單。
 * 前端驗證改善操作體驗，實際權限、網址、發布狀態及版本衝突仍由伺服器判斷。
 */
const $ = (id) => document.getElementById(id);
const sections = [
  ["overview", "◈", "內容總覽", ""],
  ["home", "🏠", "首頁最新活動管理", "計畫介紹為固定內容；這裡管理首頁的最新活動。"],
  ["experiments", "🧪", "科普實驗影片管理", "管理影片連結、簡介與顯示順序。"],
  ["resources", "📚", "教材管理", "管理章節資料夾與章節內的小教材；每筆小教材各自建立 AI 問答索引。"],
  ["activities", "📷", "活動紀錄管理", ""],
  ["honors", "🏆", "小小工程師榮譽榜管理", ""],
  ["knowledge", "💡", "科普知識專區管理", ""],
  ["questions", "❔", "知識小學堂管理", "維護五個冒險主題的題目、答案與解析。"],
  ["games", "🎮", "互動小遊戲管理", ""],
  ["about", "👋", "關於我們管理", ""],
  ["export", "↧", "資料匯出", "保存目前的內容資料，方便留存與整理。"],
];
const states = { published: "發布", draft: "下架" };
const indexStates = {
  pending: "等待建立索引",
  syncing: "正在建立索引",
  ready: "AI 索引完成",
  failed: "AI 索引失敗",
  deleted: "索引已移除",
};
const labels = { experiments: "影片", resources: "教材", questions: "題目", updates: "最新活動" };
let topics = [];
let currentSection = "overview";
let records = [];
let page = 1;
let loadNumber = 0;
let editorRecord = null;
let editorKind = null;
let editorResourceId = null;
let editorDirty = false;
let importRows = null;
let pageDirty = false;
const filters = { keyword: "", status: "", topic: "", type: "", difficulty: "" };

/**
 * 建立後台共用的純文字節點。
 * 老師輸入與 API 資料一律經過 textContent，避免管理內容形成可執行的 HTML。
 */
const node = (tag, content, className) => {
  const element = document.createElement(tag);
  if (content !== undefined) {
    element.textContent = content;
  }
  if (className) {
    element.className = className;
  }

  return element;
};

/** 更新訊息區的文字、顯示狀態與錯誤樣式，供頁面和對話框共用。 */
function message(element, content = "", error = false) {
  element.textContent = content;
  element.hidden = !content;
  element.classList.toggle("error", error);
}

/** 建立不會提交表單的操作按鈕，並綁定單一 click 處理器。 */
function action(label, handler, className = "secondary") {
  const button = node("button", label, className);
  button.type = "button";
  button.addEventListener("click", handler);

  return button;
}

/** 手動重試單筆教材索引；AI 暫時額度不足時，教材內容仍安全留在 D1，不會遺失。 */
async function retryResourceMaterial(resource, material) {
  try {
    const result = await managed(`/api/admin/resources/${resource.id}/materials/${material.id}/sync`, {}, "POST");
    Object.assign(material, result.item);
    drawTable();
    message($("admin-message"), result.item.indexState === "ready" ? "AI 索引已完成。" : "索引尚未完成，請查看狀態後稍後再試。", result.item.indexState === "failed");
  } catch (error) {
    message($("admin-message"), error.message, true);
  }
}

/** 建立導覽或來源連結；外部連結的 target 與 rel 由呼叫端依用途設定。 */
function link(label, href, className = "") {
  const a = node("a", label, className);
  a.href = href;

  return a;
}

/**
 * 共用後台請求與錯誤處理。
 * 401 表示記憶體 session 已失效，立即返回登入頁；其他錯誤轉成可顯示訊息。
 * 寫入權限、Origin、欄位格式與 revision 仍由伺服器重新驗證。
 */
async function request(path, options = {}) {
  const response = await fetch(path, {
    cache: "no-store",
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });
  const result = await response.json();
  if (response.status === 401) {
    location.replace("login.html");
    throw new Error("登入已逾時，請重新登入。");
  }
  if (!response.ok) {
    throw new Error(result.error || "無法完成操作，請稍後再試。");
  }

  return result;
}

/** 將物件序列化成 JSON 後呼叫受保護 API，集中管理後台寫入格式。 */
async function managed(path, body, method = "POST") {
  return request(path, { method, body: JSON.stringify(body) });
}

/** 依目前管理區更新側欄 aria-current，讓視覺狀態與輔助技術一致。 */
function markLinks(id) {
  document.querySelectorAll("#admin-menu a").forEach((a) => {
    if (a.hash === `#${id}`) {
      a.setAttribute("aria-current", "page");
    } else {
      a.removeAttribute("aria-current");
    }
  });
}

$("admin-menu").replaceChildren(
  ...sections.map(([id, icon, title]) => {
    const a = link("", `#${id}`);
    a.append(node("span", icon), node("b", title));

    return a;
  }),
);

/** 從網址 hash 取得合法管理區；未知值回到總覽，不組合任意 API 路徑。 */
function routeId() {
  const id = location.hash.slice(1);

  return sections.some((section) => section[0] === id) ? id : "overview";
}

/**
 * 依側欄路由載入資料並選擇對應畫面。
 * loadNumber 是請求序號，使用者快速切頁時，較慢的舊回應不能覆蓋新頁面。
 * 離開頁面編輯器前也會檢查 pageDirty，避免未儲存內容無聲消失。
 */
async function renderRoute() {
  if (pageDirty && !confirm("頁面有尚未儲存的修改，要離開嗎？")) {
    history.replaceState(null, "", `#${currentSection}`);

    return;
  }
  pageDirty = false;
  const serial = ++loadNumber;
  currentSection = routeId();
  const section = sections.find((item) => item[0] === currentSection);
  $("admin-title").textContent = section[2];
  $("admin-description").textContent = section[3];
  $("admin-description").hidden = !section[3];
  document.title = `${section[2]}｜老師管理區`;
  markLinks(currentSection);
  $("page-actions").replaceChildren();
  $("admin-view").replaceChildren(node("p", "正在載入內容…", "empty"));
  $("admin-view").setAttribute("aria-busy", "true");
  message($("admin-message"));
  try {
    if (currentSection === "overview") {
      const overview = await request("/api/admin/overview");
      if (serial !== loadNumber) {
        return;
      }
      topics = overview.quizTopics;
      renderOverview(overview);
    } else if (currentSection === "about") {
      const result = await request(`/api/admin/pages/${currentSection}`);
      if (serial !== loadNumber) {
        return;
      }
      renderPageEditor(result.item);
    } else if (currentSection === "home") {
      const result = await request("/api/admin/updates");
      if (serial !== loadNumber) {
        return;
      }
      records = result.items;
      page = 1;
      Object.assign(filters, { keyword: "", status: "", topic: "", type: "", difficulty: "" });
      $("page-actions").append(action("＋ 新增最新活動", () => openEditor("updates"), "primary"));
      renderList();
    } else if (currentSection === "export") {
      renderExport();
    } else if (!Object.hasOwn(labels, currentSection)) {
      $("admin-view").replaceChildren(node("p", "管理區已保留，功能尚未開放。", "empty"));
    } else {
      const kind = currentSection;
      const result = await request(`/api/admin/${kind}`);
      if (serial !== loadNumber) {
        return;
      }
      records = result.items;
      page = 1;
      Object.assign(filters, { keyword: "", status: "", topic: "", type: "", difficulty: "" });
      $("page-actions").append(
        action(kind === "resources" ? "＋ 新增章節" : `＋ 新增${labels[kind]}`, () => openEditor(kind), "primary"),
      );
      if (kind === "questions") {
        $("page-actions").append(action("匯入題庫", openImport));
      }
      renderList();
    }
  } catch (error) {
    if (serial !== loadNumber) {
      return;
    }
    $("admin-view").replaceChildren(
      node("p", "內容載入失敗。", "empty"),
      action("重新載入", renderRoute),
    );
    message($("admin-message"), error.message, true);
  } finally {
    if (serial === loadNumber) {
      $("admin-view").setAttribute("aria-busy", "false");
    }
  }
}

/** 將總覽 API 的發布／下架數量建立成摘要卡片。 */
function renderOverview(data) {
  const stats = node("div", undefined, "stats");
  for (const [index, item] of data.collections.entries()) {
    const stat = node("article", undefined, "stat");
    const heading = node("div", labels[item.kind], "stat-heading");
    heading.append(node("span", ["🧪", "📚", "❔"][index]));
    stat.append(
      heading,
      node("strong", item.published),
      node("small", `已發布 · ${item.draft} 筆下架`),
    );
    stats.append(stat);
  }
  $("admin-view").replaceChildren(stats);
}

/** 建立篩選下拉欄位，變更時更新 filters、回到第一頁並重畫資料表。 */
function filterSelect(label, key, values) {
  const select = node("select");
  select.setAttribute("aria-label", label);
  values.forEach(([value, title]) => {
    const option = node("option", title);
    option.value = value;
    select.append(option);
  });
  select.value = filters[key];
  select.addEventListener("change", () => {
    filters[key] = select.value;
    page = 1;
    drawTable();
  });

  return select;
}

/** 依目前內容類別建立搜尋列與適用的篩選器，再交由 drawTable 顯示結果。 */
function renderList() {
  const toolbar = node("div", undefined, "toolbar");
  const search = node("input");
  search.type = "search";
  search.placeholder = currentSection === "questions" ? "搜尋題目、解析…" : "搜尋標題或簡介…";
  search.setAttribute("aria-label", "搜尋內容");
  search.addEventListener("input", () => {
    filters.keyword = search.value;
    page = 1;
    drawTable();
  });
  toolbar.append(
    search,
    filterSelect("發布狀態", "status", [["", "全部狀態"], ...Object.entries(states)]),
  );
  if (currentSection === "questions") {
    toolbar.append(
      filterSelect("冒險主題", "topic", [
        ["", "全部主題"],
        ...topics.map((value) => [value, value]),
      ]),
      filterSelect("題型", "type", [
        ["", "全部題型"],
        ["選擇題", "選擇題"],
        ["是非題", "是非題"],
      ]),
      filterSelect("難度", "difficulty", [
        ["", "全部難度"],
        ...["易", "中", "難"].map((value) => [value, value]),
      ]),
    );
  }
  const table = node("div");
  table.id = "content-table";
  $("admin-view").replaceChildren(toolbar, table);
  drawTable();
}

/**
 * 先依關鍵字與 filters 過濾記憶體中的 records，再套用十二筆一頁的分頁。
 * 這些只是前端畫面狀態；伺服器仍會在讀寫時執行權限與內容驗證。
 */
function drawTable() {
  const kind = currentSection === "home" ? "updates" : currentSection;
  const keyword = filters.keyword.trim().toLocaleLowerCase();
  const found = records.filter(
    (item) =>
      (!filters.status || item.status === filters.status) &&
      (!filters.topic || item.topic === filters.topic) &&
      (!filters.type || item.type === filters.type) &&
      (!filters.difficulty || item.difficulty === filters.difficulty) &&
      (!keyword ||
        [
          item.title,
          item.description,
          item.question,
          item.explanation,
          item.driveFileId,
          ...(kind === "resources" ? (item.materials || []).flatMap((material) => [material.title, material.materialType]) : []),
        ]
          .join(" ")
          .toLocaleLowerCase()
          .includes(keyword)),
  );
  const pages = Math.max(1, Math.ceil(found.length / 12));
  page = Math.min(page, pages);
  if (kind === "resources") {
    drawResourceGroups(found, pages);
    return;
  }
  const wrap = node("div", undefined, kind === "resources" ? "table-wrap resource-table-wrap" : "table-wrap");
  const table = node("table");
  table.setAttribute("aria-label", `${labels[kind]}管理清單`);
  const head = node("thead"),
    header = node("tr");
  [
    kind === "questions" ? "題目 / 主題" : kind === "resources" ? "章節 / 章節內教材" : "名稱 / 連結",
    kind === "questions" ? "題型 / 難度" : "排序",
    kind === "resources" ? "發布／AI 索引" : "狀態",
    "操作",
  ].forEach((value) => header.append(node("th", value)));
  head.append(header);
  table.append(head);
  const body = node("tbody");
  found.slice((page - 1) * 12, page * 12).forEach((item, index) => {
    if (kind === "resources" && index > 0) {
      const divider = node("tr", undefined, "resource-chapter-divider");
      const dividerCell = node("td");
      dividerCell.colSpan = 4;
      divider.append(dividerCell);
      body.append(divider);
    }
    const row = node("tr", undefined, kind === "resources" ? "resource-chapter-row" : ""),
      title = node("td");
    title.append(node("strong", item.title || item.question));
    if (kind === "questions") {
      title.append(node("small", item.topic));
    }
    if (kind === "experiments" && item.description) {
      title.append(
        node(
          "small",
          item.description.length > 120 ? item.description.slice(0, 120) + "…" : item.description,
        ),
      );
    }
    if (kind === "updates" && item.eventDate) {
      title.append(node("small", item.eventDate));
    }
    const sourceUrl =
      kind === "updates" ? item.linkUrl : kind === "experiments" ? item.viewUrl : item.folderUrl;
    if (kind !== "questions" && sourceUrl) {
      const view = link("查看來源 ↗", sourceUrl, "table-action");
      view.target = "_blank";
      view.rel = "noopener noreferrer";
      title.append(view);
    }
    const statusCell = node("td");
    statusCell.append(node("span", states[item.status], `badge ${item.status}`));
    const controls = node("td");
    controls.append(action(kind === "resources" ? "編輯章節" : "編輯", () => openEditor(kind, item.id), "table-action"));
    if (kind === "resources") {
      controls.append(action("＋ 新增小教材", () => openResourceMaterialEditor(item.id), "table-action"));
    }
    row.append(
      title,
      node("td", kind === "questions" ? `${item.type} · ${item.difficulty}` : item.sortOrder),
      statusCell,
      controls,
    );
    body.append(row);
    if (kind === "resources") {
      (item.materials || []).forEach((material) => {
        const child = node("tr", undefined, "resource-material-table-row");
        const childTitle = node("td");
        childTitle.append(
          node("span", "↳", "resource-material-table-arrow"),
          node("strong", material.title),
          node("small", material.materialType),
        );
        child.append(
          childTitle,
          node("td", "—"),
          node("td", ""),
          node("td", undefined, "resource-material-table-actions"),
        );
        child.lastElementChild.append(
          action("編輯小教材", () => openResourceMaterialEditor(item.id, material.id), "table-action"),
        );
        body.append(child);
      });
    }
  });
  table.append(body);
  wrap.append(table);
  if (!found.length) {
    wrap.append(
      node(
        "p",
        records.length
          ? "沒有符合條件的內容，試試其他篩選。"
          : `尚無${labels[kind]}，可以從新增開始。`,
        "empty",
      ),
    );
  }
  const pagination = node("div", undefined, "pagination");
  pagination.append(node("span", `共 ${found.length} 筆 · 第 ${page} / ${pages} 頁`));
  const buttons = node("div");
  const prev = action("← 上一頁", () => {
    page--;
    drawTable();
  });
  prev.disabled = page === 1;
  const next = action("下一頁 →", () => {
    page++;
    drawTable();
  });
  next.disabled = page === pages;
  buttons.append(prev, next);
  pagination.append(buttons);
  $("content-table").replaceChildren(wrap, pagination);
}

/** 將教材以章節卡片呈現，避免父子教材被表格欄位切得零散難讀。 */
function drawResourceGroups(found, pages) {
  const groups = node("div", undefined, "resource-groups");
  const visible = found.slice((page - 1) * 12, page * 12);
  visible.forEach((resource) => {
    const group = node("article", undefined, "resource-group");
    const header = node("div", undefined, "resource-group-header");
    const heading = node("div", undefined, "resource-group-heading");
    heading.append(
      node("span", `章節 ${resource.sortOrder}`, "resource-group-kicker"),
      node("h3", resource.title),
    );
    if (resource.description) {
      heading.append(node("p", resource.description, "resource-group-description"));
    }
    const meta = node("div", undefined, "resource-group-meta");
    meta.append(node("span", states[resource.status], `badge ${resource.status}`));
    const controls = node("div", undefined, "actions resource-group-actions");
    if (resource.folderUrl) {
      const source = link("Google Drive 資料夾 ↗", resource.folderUrl, "secondary");
      source.target = "_blank";
      source.rel = "noopener noreferrer";
      controls.append(source);
    }
    controls.append(
      action("編輯章節", () => openEditor("resources", resource.id), "secondary"),
      action("＋ 新增小教材", () => openResourceMaterialEditor(resource.id), "primary"),
      action("刪除章節", () => deleteResource(resource), "danger"),
    );
    header.append(heading, meta, controls);
    group.append(header);

    const materialPanel = node("details", undefined, "resource-material-panel");
    const materialHeading = node("summary", undefined, "resource-material-panel-heading");
    const materialHeadingCopy = node("span", undefined, "resource-material-panel-title");
    materialHeading.append(
      node("span", "›", "resource-material-chevron"),
      materialHeadingCopy,
      node("span", `${(resource.materials || []).length} 筆`, "resource-material-count"),
    );
    materialHeadingCopy.append(node("h4", "章節內教材"));
    materialPanel.append(materialHeading);
    if (!(resource.materials || []).length) {
      materialPanel.append(node("p", "尚未建立小教材，可從上方按鈕新增。", "resource-material-empty"));
    } else {
      const list = node("div", undefined, "resource-material-listing");
      resource.materials.forEach((material) => {
        const row = node("div", undefined, "resource-material-item");
        const detail = node("div", undefined, "resource-material-detail");
        detail.append(
          node("strong", material.title),
          node("span", material.materialType, "resource-material-type"),
        );
        const itemMeta = node("div", undefined, "resource-material-meta");
        itemMeta.append(
          node("span", indexStates[material.indexState] || "索引狀態未知", `badge ${material.indexState === "failed" ? "draft" : "published"}`),
          action("編輯", () => openResourceMaterialEditor(resource.id, material.id), "secondary"),
          action("刪除", () => deleteResourceMaterial(resource, material), "danger"),
        );
        if (["failed", "pending"].includes(material.indexState)) {
          itemMeta.insertBefore(
            action("重試索引", () => retryResourceMaterial(resource, material), "secondary"),
            itemMeta.lastElementChild,
          );
        }
        row.append(detail, itemMeta);
        list.append(row);
      });
      materialPanel.append(list);
    }
    group.append(materialPanel);
    groups.append(group);
  });
  if (!visible.length) {
    groups.append(
      node(
        "p",
        records.length ? "沒有符合條件的內容，試試其他篩選。" : "尚無教材章節，可以從新增開始。",
        "empty",
      ),
    );
  }
  const pagination = node("div", undefined, "pagination");
  pagination.append(node("span", `共 ${found.length} 個章節 · 第 ${page} / ${pages} 頁`));
  const buttons = node("div");
  const prev = action("← 上一頁", () => {
    page--;
    drawTable();
  });
  prev.disabled = page === 1;
  const next = action("下一頁 →", () => {
    page++;
    drawTable();
  });
  next.disabled = page === pages;
  buttons.append(prev, next);
  pagination.append(buttons);
  $("content-table").replaceChildren(groups, pagination);
}

/** 刪除整個章節及其小教材；伺服器會先清除所有對應的 AI 索引。 */
async function deleteResource(resource) {
  const count = resource.materials?.length || 0;
  if (!confirm(`確定要刪除「${resource.title}」嗎？${count ? `\n這也會刪除章節內的 ${count} 筆小教材與 AI 索引。` : ""}\n此操作無法復原。`)) {
    return;
  }
  try {
    await managed(`/api/admin/resources/${resource.id}`, {}, "DELETE");
    records = records.filter((item) => item.id !== resource.id);
    page = 1;
    drawTable();
    message($("admin-message"), "章節與其小教材已刪除。");
  } catch (error) {
    message($("admin-message"), error.message, true);
  }
}

/** 刪除單一小教材；不會影響其餘教材或所屬章節。 */
async function deleteResourceMaterial(resource, material) {
  if (!confirm(`確定要刪除小教材「${material.title}」嗎？\n對應的 AI 索引也會一併刪除，且無法復原。`)) {
    return;
  }
  try {
    await managed(`/api/admin/resources/${resource.id}/materials/${material.id}`, {}, "DELETE");
    resource.materials = (resource.materials || []).filter((item) => item.id !== material.id);
    drawTable();
    message($("admin-message"), "小教材已刪除。");
  } catch (error) {
    message($("admin-message"), error.message, true);
  }
}

/**
 * 建立編輯器欄位及提示文字。
 * options 控制輸入類型、長度、選項及必填狀態，統一不同內容類別的表單結構。
 */
function field(label, name, value = "", options = {}) {
  const holder = node("label", label, `field${options.wide ? " wide" : ""}`);
  let input;
  if (options.values) {
    input = node("select");
    options.values.forEach((entry) => {
      const [v, title] = Array.isArray(entry) ? entry : [entry, entry];
      const option = node("option", title);
      option.value = v;
      input.append(option);
    });
  } else if (options.textarea) {
    input = node("textarea");
  } else {
    input = node("input");
    input.type = options.type || "text";
  }
  input.name = name;
  input.value = value;
  input.required = Boolean(options.required);
  input.readOnly = Boolean(options.readOnly);
  if (options.max) {
    input.maxLength = options.max;
  }
  if (options.type === "number") {
    input.min = "0";
    input.max = "100000";
    input.step = "1";
  }
  if (options.hint) {
    holder.append(node("small", options.hint));
  }
  holder.append(input);

  return holder;
}

/**
 * 建立小教材的附圖清單。清單預設只顯示圖片編號與已填圖說，避免長網址破壞編輯
 * 對話框的閱讀性；每一筆都能自行展開修改，不會因為新增多張圖而變成一大排欄位。
 * 新增時先開啟編輯欄位，既有資料則維持收合。空白卡片不會在儲存時送到 API。
 */
function materialImagesEditor(images = []) {
  const holder = node("section", undefined, "material-images-editor");
  const list = node("div", undefined, "material-image-list");
  const count = node("span", "0 張", "material-images-count");

  // 刪除後重新編號並更新數量，讓圖號與畫面上的順序始終一致。
  const updateList = () => {
    const cards = [...list.querySelectorAll(".material-image-card")];
    count.textContent = `${cards.length} 張`;
    cards.forEach((card, index) => {
      card.querySelector(".material-image-number").textContent = `圖片 ${index + 1}`;
    });
  };

  // card 保留輸入欄位，即使收合也不遺失內容；收合只是介面狀態，非另一份資料。
  const addImage = (image = {}, initiallyEditing = false) => {
    const card = node("article", undefined, "material-image-card");
    const summary = node("div", undefined, "material-image-summary");
    const number = node("span", "圖片", "material-image-number");
    const title = node("strong", image.caption || "", "material-image-title");
    const url = node("input");
    url.type = "url";
    url.name = "material-image-url";
    url.maxLength = 1500;
    url.placeholder = "貼上 Google Drive 圖片連結";
    url.value = image.url || "";
    url.setAttribute("aria-label", "教材圖片 Google Drive 連結");
    const caption = node("input");
    caption.type = "text";
    caption.name = "material-image-caption";
    caption.maxLength = 300;
    caption.placeholder = "例如：圖一：平行平板流動示意";
    caption.value = image.caption || "";
    caption.setAttribute("aria-label", "教材圖片圖說或圖號");
    const fields = node("div", undefined, "material-image-fields");
    const urlLabel = node("label", "圖片連結");
    const captionLabel = node("label", "圖說／圖號");
    urlLabel.append(url);
    captionLabel.append(caption);
    const done = action("完成", () => setEditing(false), "table-action material-image-done");
    fields.append(urlLabel, captionLabel, done);

    const edit = action("編輯", () => setEditing(true), "table-action");
    const remove = action("刪除", () => {
      if (!confirm("要刪除這張教材圖片嗎？")) {
        return;
      }
      card.remove();
      updateList();
      editorDirty = true;
    }, "table-action archive");
    const controls = node("div", undefined, "material-image-actions");
    controls.append(edit, remove);
    summary.append(number, title, controls);

    const setEditing = (isEditing) => {
      fields.hidden = !isEditing;
      edit.hidden = isEditing;
      remove.hidden = isEditing;
      if (isEditing) {
        url.focus();
      }
    };
    const updateTitle = () => {
      title.textContent = caption.value.trim();
    };
    caption.addEventListener("input", updateTitle);
    card.append(summary, fields);
    list.append(card);
    setEditing(initiallyEditing);
    updateList();
  };

  const heading = node("div", undefined, "material-images-heading");
  heading.append(node("h3", "教材附圖（選填）"), count);
  const header = node("div", undefined, "material-images-header");
  header.append(
    heading,
    action("＋ 新增圖片", () => {
      addImage({}, true);
      editorDirty = true;
    }, "secondary material-image-add"),
  );
  holder.append(
    header,
    node("p", "可放習題圖、公式圖或重要圖表；學生引用這筆教材時，系統會一併顯示附圖。", "material-images-hint"),
    list,
  );
  images.forEach((image) => addImage(image));
  updateList();
  return holder;
}

/**
 * 從每張卡片讀取目前值，轉成後端驗證器需要的 images 陣列。老師可先按新增再
 * 決定不填；完全空白的卡片在此移除，避免產生沒有圖片連結的無效資料。
 */
function materialImages() {
  return [...document.querySelectorAll('#editor-fields .material-image-card')]
    .map((card) => ({
      url: card.querySelector('[name="material-image-url"]')?.value.trim() || "",
      caption: card.querySelector('[name="material-image-caption"]')?.value.trim() || "",
    }))
    .filter((image) => image.url || image.caption);
}

/** 取得編輯表單指定欄位的目前字串值；欄位不存在時回傳空字串。 */
function value(name) {
  return $("editor-form").elements.namedItem(name)?.value || "";
}

/** 將 textarea 的多行文字整理成去除前後空白與空行的字串陣列。 */
function lines(value) {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);
}

/**
 * 依內容類別開啟新增或編輯視窗，並建立相符欄位。
 * 編輯既有資料時會保存 revision，送出後由伺服器偵測多人或多分頁更新衝突。
 */
async function openEditor(kind, id = null) {
  try {
    editorRecord = id === null ? null : (await request(`/api/admin/${kind}/${id}`)).item;
    editorKind = kind;
    editorResourceId = null;
    editorDirty = false;
    const item = editorRecord || {};
    $("editor-form").reset();
    $("editor-fields").replaceChildren();
    const editorLabel = kind === "resources" ? "章節" : labels[kind];
    $("editor-title").textContent = `${id === null ? "新增" : "編輯"}${editorLabel}`;
    message($("editor-message"));
    $("question-preview").hidden = kind !== "questions";
    $("question-preview").open = false;
    const fields = $("editor-fields");
    fields.append(
      field("發布狀態", "status", item.status || "draft", { values: Object.entries(states) }),
    );
    if (["experiments", "updates"].includes(kind)) {
      fields.append(
        field("顯示順序", "sortOrder", item.sortOrder ?? records.length + 1, {
          type: "number",
          required: true,
        }),
      );
    }
    if (kind !== "questions") {
      fields.append(
        field("標題", "title", item.title || "", { wide: true, required: true, max: 200 }),
      );
    }
    if (kind === "experiments") {
      fields.append(
        field("Google Drive 影片連結或檔案 ID", "driveFileId", item.driveFileId || "", {
          wide: true,
          required: true,
          max: 1000,
        }),
      );
      fields.append(
        field("影片簡介", "description", item.description || "", {
          wide: true,
          textarea: true,
          max: 3000,
          hint: "將顯示在前台影片卡片中。",
        }),
      );
    } else if (kind === "resources") {
      fields.append(
        field("Google Drive 教材資料夾連結", "folderUrl", item.folderUrl || "", {
          wide: true,
          required: true,
          type: "url",
        }),
      );
      fields.append(
        field("教材簡介", "description", item.description || "", {
          wide: true,
          textarea: true,
          max: 3000,
        }),
      );
      fields.append(
        field("顯示順序", "sortOrder", item.sortOrder ?? records.length + 1, {
          type: "number",
          required: true,
        }),
      );
    } else if (kind === "updates") {
      fields.append(field("活動日期", "eventDate", item.eventDate || "", { type: "date" }));
      fields.append(
        field("活動簡介", "description", item.description || "", {
          textarea: true,
          wide: true,
          max: 5000,
        }),
      );
      fields.append(
        field("活動連結", "linkUrl", item.linkUrl || "", {
          type: "url",
          wide: true,
          max: 1500,
          hint: "選填，有活動詳情或報名網址時再填寫。",
        }),
      );
    } else {
      fields.append(field("冒險主題", "topic", item.topic || topics[0], { values: topics }));
      fields.append(
        field("難度", "difficulty", item.difficulty || "易", { values: ["易", "中", "難"] }),
      );
      fields.append(field("題型", "type", item.type || "選擇題", { values: ["選擇題", "是非題"] }));
      fields.append(
        field("題目", "question", item.question || "", {
          wide: true,
          required: true,
          textarea: true,
          max: 4000,
        }),
      );
      const options = node("div", undefined, "option-fields");
      options.id = "option-fields";
      ["A", "B", "C", "D"].forEach((key) =>
        options.append(
          field(`選項 ${key}`, `option${key}`, item.options?.[key] || "", {
            required: true,
            max: 2000,
          }),
        ),
      );
      fields.append(options);
      fields.append(field("正確答案", "answer", "", { values: [] }));
      fields.append(
        field("答案解析", "explanation", item.explanation || "", {
          wide: true,
          required: true,
          textarea: true,
          max: 8000,
        }),
      );
      fields.append(field("題目依據", "basis", item.basis || "", { wide: true, max: 1000 }));
      fields.append(
        field("來源", "sources", (item.sources || []).join("\n"), {
          wide: true,
          textarea: true,
          hint: "每行一項，供老師查核；前台答題不顯示此欄位。",
        }),
      );
      const syncType = () => {
        const multiple = value("type") === "選擇題";
        options.hidden = !multiple;
        options.querySelectorAll("input").forEach((input) => {
          input.disabled = !multiple;
          input.required = multiple;
        });
        const answer = $("editor-form").elements.namedItem("answer");
        const previous = answer.value;
        answer.replaceChildren(
          ...(multiple ? ["A", "B", "C", "D"] : ["O", "X"]).map((key) => {
            const option = node("option", multiple ? key : key === "O" ? "O · 正確" : "X · 錯誤");
            option.value = key;

            return option;
          }),
        );
        if (Array.from(answer.options).some((option) => option.value === previous)) {
          answer.value = previous;
        }
        previewQuestion();
      };
      $("editor-form").elements.namedItem("type").addEventListener("change", syncType);
      syncType();
      if (item.answer) {
        $("editor-form").elements.namedItem("answer").value = item.answer.slice(0, 1);
      }
    }
    $("editor").showModal();
    $("editor").scrollTop = 0;
  } catch (error) {
    message($("admin-message"), error.message, true);
  }
}

/** 開啟單一小教材的編輯視窗；發布狀態由所屬章節統一控制。 */
async function openResourceMaterialEditor(resourceId, materialId = null) {
  try {
    const resource = await request(`/api/admin/resources/${resourceId}`);
    const material = materialId ? resource.item.materials?.find((item) => item.id === materialId) : null;
    if (materialId && !material) {
      throw new Error("找不到這筆小教材，請重新整理後再試。");
    }
    editorRecord = material || null;
    editorKind = "resource-material";
    editorResourceId = resourceId;
    editorDirty = false;
    const item = editorRecord || {};
    $("editor-form").reset();
    $("editor-fields").replaceChildren();
    $("editor-title").textContent = `${materialId ? "編輯" : "新增"}小教材｜${resource.item.title}`;
    message($("editor-message"));
    $("question-preview").hidden = true;
    $("question-preview").open = false;
    const fields = $("editor-fields");
    fields.append(
      node(
        "p",
        `這筆教材會獨立儲存、建立 AI 索引；發布或下架會跟隨章節目前的「${states[resource.item.status]}」狀態。`,
        "editor-hint wide",
      ),
      field("教材名稱", "title", item.title || "", { wide: true, required: true, max: 200 }),
      field("類型", "materialType", item.materialType || "講義", {
        values: ["講義", "影片", "PDF", "投影片", "其他"],
        required: true,
      }),
      field("Google Drive／文件連結", "sourceUrl", item.sourceUrl || "", {
        type: "url",
        required: true,
        wide: true,
        max: 1500,
        hint: "此連結標示這筆小教材的來源；學生下載仍會開啟章節資料夾。",
      }),
      materialImagesEditor(item.images || (item.imageUrl ? [{ url: item.imageUrl, caption: "" }] : [])),
      field("教材文字（供 AI 助教檢索）", "fullText", item.fullText || "", {
        textarea: true,
        wide: true,
        required: true,
        max: 100000,
      }),
    );
    fields.querySelector('textarea[name="fullText"]').rows = 14;
    $("editor").showModal();
    $("editor").scrollTop = 0;
  } catch (error) {
    message($("admin-message"), error.message, true);
  }
}

/**
 * 依目前表單值預覽題目、選項、正解與解析。
 * 預覽只協助老師檢查輸入，正式評分仍使用伺服器資料庫中的答案。
 */
function previewQuestion() {
  if (editorKind !== "questions") {
    return;
  }
  const preview = $("preview-content");
  preview.replaceChildren(node("h3", value("question") || "尚未填寫題目"));
  const keys = value("type") === "是非題" ? ["O", "X"] : ["A", "B", "C", "D"];
  keys.forEach((key) =>
    preview.append(
      node("p", `${key}　${key === "O" ? "正確" : key === "X" ? "錯誤" : value(`option${key}`)}`),
    ),
  );
  preview.append(
    node("strong", `正確答案：${value("answer")}`),
    node("p", value("explanation") || "尚未填寫解析"),
  );
}

$("editor-form").addEventListener("input", () => {
  editorDirty = true;
  previewQuestion();
});
$("question-preview").addEventListener("toggle", previewQuestion);

/** 有未儲存的修改才詢問老師，避免誤觸關閉造成編輯內容遺失。 */
function closeEditor() {
  if (!editorDirty || confirm("尚有未儲存的修改，要離開編輯視窗嗎？")) {
    $("editor").close();
  }
}

$("editor-close").addEventListener("click", closeEditor);
$("editor-cancel").addEventListener("click", closeEditor);
$("editor").addEventListener("cancel", (event) => {
  event.preventDefault();
  closeEditor();
});
$("editor-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const kind = editorKind;
  const previous = editorRecord;
  const button = $("editor-save");
  button.disabled = true;
  button.textContent = "儲存中…";
  message($("editor-message"));
  try {
    if (kind === "resource-material") {
      const payload = {
        title: value("title"),
        materialType: value("materialType"),
        sourceUrl: value("sourceUrl"),
        images: materialImages(),
        fullText: value("fullText"),
      };
      const result = await managed(
        `/api/admin/resources/${editorResourceId}/materials${previous ? `/${previous.id}` : ""}`,
        payload,
        previous ? "PUT" : "POST",
      );
      const resource = records.find((item) => item.id === editorResourceId);
      if (resource) {
        const index = (resource.materials || []).findIndex((item) => item.id === result.item.id);
        if (index < 0) {
          resource.materials = [...(resource.materials || []), result.item];
        } else {
          resource.materials[index] = result.item;
        }
      }
      editorDirty = false;
      $("editor").close();
      if (currentSection === "resources") {
        drawTable();
      }
      return;
    }
    const payload = { ...previous, status: value("status") };
    if (kind !== "questions") {
      Object.assign(payload, { title: value("title"), sortOrder: Number(value("sortOrder")) });
    }
    if (kind === "experiments") {
      Object.assign(payload, {
        driveFileId: value("driveFileId"),
        description: value("description"),
      });
    } else if (kind === "resources") {
      Object.assign(payload, {
        folderUrl: value("folderUrl"),
        description: value("description"),
      });
    } else if (kind === "updates") {
      Object.assign(payload, {
        eventDate: value("eventDate"),
        description: value("description"),
        linkUrl: value("linkUrl"),
      });
    } else {
      Object.assign(payload, {
        topic: value("topic"),
        type: value("type"),
        difficulty: value("difficulty"),
        question: value("question"),
        options: Object.fromEntries(
          ["A", "B", "C", "D"].map((key) => [key, value(`option${key}`)]),
        ),
        answer: value("answer"),
        explanation: value("explanation"),
        basis: value("basis"),
        sources: lines(value("sources")),
      });
    }
    const result = await managed(
      `/api/admin/${kind}${previous ? `/${previous.id}` : ""}`,
      payload,
      previous ? "PUT" : "POST",
    );
    editorDirty = false;
    $("editor").close();
    if (currentSection === kind || (currentSection === "home" && kind === "updates")) {
      const index = records.findIndex((item) => item.id === result.item.id);
      if (index < 0) {
        records.push(result.item);
      } else {
        records[index] = result.item;
      }
      records.sort((a, b) =>
        kind === "questions"
          ? String(a.id).localeCompare(String(b.id))
          : a.sortOrder - b.sortOrder ||
            (kind === "experiments"
              ? Number(a.id) - Number(b.id)
              : String(a.id).localeCompare(String(b.id))),
      );
      drawTable();
    }
    const saved =
      kind === "resources"
        ? "章節已儲存；請從列表的「新增小教材」建立教材內容。"
        : `內容已儲存${result.item.status === "published" ? "並發布；重新整理前台即可看到更新" : "為下架狀態，前台不顯示"}。`;
    message($("admin-message"), saved);
  } catch (error) {
    message($("editor-message"), error.message, true);
  } finally {
    button.disabled = false;
    button.textContent = "儲存內容";
  }
});

/** 建立資料匯出說明與下載入口；JSON 內容由需登入的伺服器端點產生。 */
function renderExport() {
  const panel = node("section", undefined, "panel");
  panel.append(
    node("h2", "匯出一份目前的教學內容"),
    node(
      "p",
      "JSON 檔包含最新活動、關於我們、全部影片、教材與題庫，以及發布／下架狀態、答案與來源，可供老師留存或後續整理。",
    ),
    node(
      "p",
      "此匯出為內容清單，不含老師帳號、登入資料與封面圖片檔案。完整備份請由網站維護者保存資料目錄。",
    ),
  );
  const download = link("↧ 下載內容 JSON", "/api/admin/export", "primary");
  download.download = "";
  panel.append(download);
  $("admin-view").replaceChildren(panel);
}

/** 重設匯入預覽與提交狀態；選檔並通過伺服器預檢後才允許正式匯入。 */
function openImport() {
  importRows = null;
  $("import-form").reset();
  $("import-submit").disabled = true;
  message($("import-message"));
  $("import-dialog").showModal();
}

$("import-close").addEventListener("click", () => $("import-dialog").close());
$("import-file").addEventListener("change", () => {
  importRows = null;
  $("import-submit").disabled = true;
  message($("import-message"));
});
$("import-example").textContent = JSON.stringify(
  [
    {
      id: "NEW01",
      type: "選擇題",
      topic: "柏努利與基礎流力",
      difficulty: "易",
      question: "請填寫題目",
      options: { A: "選項一", B: "選項二", C: "選項三", D: "選項四" },
      answer: "A",
      explanation: "請填寫答案解析",
      basis: "",
      sources: [],
    },
  ],
  null,
  2,
);
$("import-check").addEventListener("click", async () => {
  const button = $("import-check");
  button.disabled = true;
  importRows = null;
  $("import-submit").disabled = true;
  try {
    const file = $("import-file").files[0];
    if (!file) {
      throw new Error("請先選擇 JSON 檔案。");
    }
    if (file.size > 2 * 1024 * 1024) {
      throw new Error("檔案不可超過 2 MB。");
    }
    let data;
    try {
      data = JSON.parse(await file.text());
    } catch {
      throw new Error("JSON 格式不正確，請檢查檔案。");
    }
    const rows = Array.isArray(data) ? data : data.questions;
    const result = await managed("/api/admin/questions/import-preview", { questions: rows });
    importRows = rows;
    message(
      $("import-message"),
      `檢查完成：${result.count} 題，主題包含 ${result.topics.join("、")}。確認後將以「下架」狀態儲存。`,
    );
    $("import-submit").disabled = false;
  } catch (error) {
    message($("import-message"), error.message, true);
  } finally {
    button.disabled = false;
  }
});
$("import-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  if (!importRows) {
    return;
  }
  $("import-submit").disabled = true;
  try {
    const result = await managed("/api/admin/questions/import", { questions: importRows });
    $("import-dialog").close();
    await renderRoute();
    message(
      $("admin-message"),
      `已匯入 ${result.count} 題，均為下架狀態。請檢查答案與解析後再發布。`,
    );
  } catch (error) {
    message($("import-message"), error.message, true);
    $("import-submit").disabled = false;
  }
});
$("logout-button").addEventListener("click", async () => {
  $("logout-button").disabled = true;
  try {
    await managed("/api/auth/logout", {});
    location.replace("login.html");
  } catch (error) {
    message($("admin-message"), error.message, true);
    $("logout-button").disabled = false;
  }
});
window.addEventListener("hashchange", renderRoute);

/**
 * 確認登入狀態後才解除 body 的 hidden，設定老師名稱並載入目前路由。
 * 這可避免未登入時短暫顯示管理介面，但真正保護仍由伺服器完成。
 */
async function initialize() {
  try {
    const status = await request("/api/auth/status");
    if (!status.authenticated) {
      location.replace("login.html");

      return;
    }
    $("signed-in-user").textContent = `${status.username} · 老師管理區`;
    document.body.hidden = false;
    const overview = await request("/api/admin/overview");
    topics = overview.quizTopics;
    await renderRoute();
  } catch (error) {
    document.body.hidden = false;
    message($("admin-message"), error.message, true);
  }
}

window.addEventListener("pageshow", (event) => {
  if (event.persisted) {
    initialize();
  }
});
initialize();

/**
 * 編輯「關於我們」的結構化章節與段落。
 * structuredClone 建立獨立草稿，保留版型識別資料，儲存前不會直接改動目前 item。
 */
function renderPageEditor(item) {
  const draft = structuredClone(item);
  const form = node("form", undefined, "page-editor");
  const top = node("section", undefined, "panel page-editor-top");
  top.append(
    node("h2", "關於我們"),
    node("p", "依區塊編輯完整內容。段落之間留一空行，儲存後重新整理前台即可看到更新。"),
  );

  function inputField(label, object, key, options = {}) {
    const holder = field(label, key, object[key] || "", { ...options, max: options.max || 300 });
    holder.querySelector("input, textarea, select").addEventListener("input", (event) => {
      object[key] = event.target.value;
      pageDirty = true;
    });

    return holder;
  }

  function paragraphField(object) {
    const model = { content: object.paragraphs.join("\n\n") };
    const holder = inputField("內文（段落間空一行）", model, "content", {
      textarea: true,
      max: 240000,
      wide: true,
    });
    holder.querySelector("textarea").addEventListener("input", (event) => {
      object.paragraphs = event.target.value
        .split(/\n\s*\n/)
        .map((p) => p.trim())
        .filter(Boolean);
    });

    return holder;
  }

  top.append(
    inputField("頁面標題", draft, "title", { required: true, max: 200 }),
    inputField("發布狀態", draft, "status", { values: Object.entries(states) }),
  );
  const preview = link("查看前台 ↗", "index.html#about", "secondary");
  preview.target = "_blank";
  preview.rel = "noopener noreferrer";
  top.append(preview);
  form.append(top);
  const sectionList = node("div", undefined, "page-section-list");
  draft.sections.forEach((section, sectionIndex) => {
    const group = node("details", undefined, "page-edit-section");
    group.append(node("summary", section.title));
    const fields = node("div", undefined, "page-edit-fields");
    fields.append(
      inputField("區塊標題", section, "title", { required: true }),
      inputField("英文小標", section, "kicker"),
      inputField("副標題", section, "label"),
      paragraphField(section),
    );
    const items = node("div", undefined, "page-edit-items");

    function drawItems() {
      items.replaceChildren();
      section.items.forEach((entry, index) => {
        const block = node("fieldset", undefined, "page-edit-item");
        block.append(node("legend", entry.title || `項目 ${index + 1}`));
        block.append(inputField("項目標題", entry, "title"));
        if (section.layout !== "challenges") {
          block.append(inputField("身分／分類／工作項目", entry, "label"));
        }
        if (["stats", "kpi"].includes(section.layout)) {
          block.append(
            inputField("數值", entry, "value", { max: 50 }),
            inputField("單位", entry, "unit", { max: 50 }),
          );
        }
        if (
          [
            "story",
            "goals",
            "experiments",
            "challenges",
            "partners",
            "cooperation",
            "benefits",
            "archive",
          ].includes(section.layout)
        ) {
          block.append(
            inputField("小圖示", entry, "icon", { max: 24, hint: "可填入一個表情圖示，例如 💧。" }),
          );
        }
        block.append(paragraphField(entry));
        const controls = node("div", undefined, "actions");
        const up = action("上移", () => {
          [section.items[index - 1], section.items[index]] = [
            section.items[index],
            section.items[index - 1],
          ];
          pageDirty = true;
          drawItems();
        });
        up.disabled = index === 0;
        const down = action("下移", () => {
          [section.items[index + 1], section.items[index]] = [
            section.items[index],
            section.items[index + 1],
          ];
          pageDirty = true;
          drawItems();
        });
        down.disabled = index === section.items.length - 1;
        controls.append(
          up,
          down,
          action("移除此項目", () => {
            if (confirm("移除此項目？儲存後才會套用到前台。")) {
              section.items.splice(index, 1);
              pageDirty = true;
              drawItems();
            }
          }),
        );
        block.append(controls);
        items.append(block);
      });
    }

    drawItems();
    fields.append(
      items,
      action("＋ 新增項目", () => {
        if (section.items.length >= 40) {
          message($("admin-message"), "每區最多 40 個項目。", true);

          return;
        }
        section.items.push({
          title: "新項目",
          label: "",
          value: "",
          unit: "",
          icon: "",
          paragraphs: [],
        });
        pageDirty = true;
        drawItems();
      }),
    );
    group.append(fields);
    sectionList.append(group);
  });
  form.append(sectionList);
  const footer = node("div", undefined, "page-save-bar");
  const status = node("p", "", "page-save-message");
  status.setAttribute("role", "status");
  const save = node("button", "儲存內容", "primary");
  save.type = "submit";
  footer.append(status, save);
  form.append(footer);
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    save.disabled = true;
    save.textContent = "儲存中…";
    message(status);
    try {
      const result = await managed(`/api/admin/pages/${item.id}`, draft, "PUT");
      draft.revision = result.item.revision;
      pageDirty = false;
      message(
        status,
        draft.status === "published"
          ? "已儲存並發布，重新整理前台即可看到更新。"
          : "已儲存為下架狀態，前台不顯示此區內容。",
      );
    } catch (error) {
      message(status, error.message, true);
    } finally {
      save.disabled = false;
      save.textContent = "儲存內容";
    }
  });
  $("admin-view").replaceChildren(form);
}

window.addEventListener("beforeunload", (event) => {
  if (pageDirty) {
    event.preventDefault();
    event.returnValue = "";
  }
});
