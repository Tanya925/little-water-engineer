// 主要功能：驗證及儲存關於我們等分區頁面，讀取固定首頁介紹，管理最新活動與頁面發布狀態。
/*
 * 處理段落、章節、版型等結構化頁面內容，文字以純文字保存。
 * 首頁介紹使用固定種子內容；關於我們使用 SQLite，允許老師編輯及發布。
 * 版型名稱及欄位長度在此驗證，前端的 about-page.js 再使用共用渲染工具建立 DOM。
 */
import { readFile } from "node:fs/promises";
import { ContentError, contentStates } from "./management.mjs";

const layouts = [
  "story",
  "goals",
  "experiments",
  "challenges",
  "timeline",
  "stats",
  "team",
  "students",
  "partners",
  "cooperation",
  "kpi",
  "benefits",
  "archive",
  "contact",
];

// 所有文字在寫入資料庫前都經過這個入口。它會去除頭尾空白並限制長度；
// required 為 true 時也拒絕空字串，讓下方驗證規則不用重複處理相同細節。
const string = (value, max = 300, required = false) => {
  if (typeof value !== "string" || value.length > max || (required && !value.trim())) {
    throw new ContentError("請確認文字欄位已填寫，且長度符合限制。");
  }

  return value.trim();
};

// 段落必須是字串陣列。限制段落數及單段長度，避免錯誤匯入的資料造成
// 過大的資料庫紀錄，或讓公開頁一次產生難以閱讀的大量內容。
const paragraphs = (values) => {
  if (!Array.isArray(values) || values.length > 30) {
    throw new ContentError("每個區塊最多 30 段文字。");
  }

  return values.map((value) => string(value, 8000, true));
};

// 把後台或匯入檔提供的資料整理成唯一可儲存格式。
// 成功時回傳全新的乾淨物件；任何未知版型、重複區塊代號或超限內容都會拋出
// ContentError，因此呼叫端不可略過此函式直接寫入 sections_json。
function validate(input) {
  if (!input || !contentStates.includes(input.status)) {
    throw new ContentError("請選擇發布或下架。");
  }
  if (!Array.isArray(input.sections) || !input.sections.length || input.sections.length > 30) {
    throw new ContentError("頁面需包含 1–30 個區塊。");
  }
  const ids = new Set();
  const sections = input.sections.map((section) => {
    if (
      !section ||
      !layouts.includes(section.layout) ||
      !/^[a-z][a-z0-9-]{0,63}$/.test(section.id) ||
      ids.has(section.id)
    ) {
      throw new ContentError("區塊格式或代號不正確。");
    }
    ids.add(section.id);
    if (!Array.isArray(section.items) || section.items.length > 40) {
      throw new ContentError("每個區塊最多 40 個項目。");
    }

    return {
      id: section.id,
      layout: section.layout,
      title: string(section.title, 300, true),
      kicker: string(section.kicker || ""),
      label: string(section.label || ""),
      paragraphs: paragraphs(section.paragraphs),
      items: section.items.map((item) => ({
        title: string(item?.title, 300),
        label: string(item?.label || ""),
        icon: string(item?.icon || "", 24),
        value: string(item?.value || "", 50),
        unit: string(item?.unit || "", 50),
        paragraphs: paragraphs(item?.paragraphs),
      })),
    };
  });

  return { title: string(input.title, 200, true), sections, status: input.status };
}

// 啟動時建立頁面資料表並載入 pages.json。
// home 永遠由種子檔供應，方便版本控制；about 只在資料庫沒有紀錄時建立，
// 所以重新啟動伺服器不會覆蓋老師已經在後台修改的內容。
export async function initializePages(database) {
  database.exec(`CREATE TABLE IF NOT EXISTS site_pages (
    id TEXT PRIMARY KEY CHECK (id IN ('home', 'about')), title TEXT NOT NULL,
    sections_json TEXT NOT NULL, status TEXT NOT NULL CHECK (status IN ('published','draft')),
    revision INTEGER NOT NULL DEFAULT 1, updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`);
  // pages.json 以 home／about 為鍵；sections 內的 layout 決定版型，
  // paragraphs 保存段落，items 保存卡片資料。
  const seed = JSON.parse(
    await readFile(new URL("../database/pages.json", import.meta.url), "utf8"),
  );
  const insert = database.prepare(
    "INSERT INTO site_pages (id,title,sections_json,status) VALUES (?,?,?,'published') ON CONFLICT(id) DO NOTHING",
  );
  for (const [id, document] of Object.entries(seed).filter(([id]) => id === "about")) {
    const clean = validate({ ...document, status: "published" });
    insert.run(id, clean.title, JSON.stringify(clean.sections));
  }

  return validate({ ...seed.home, status: "published" });
}
// 集中處理頁面讀取、發布狀態、版本檢查及匯出，供前台與老師後台共用。
// fixedHome 是 initializePages 回傳並已驗證的首頁內容，不需要再向 SQLite 查詢。
export function pageStore(database, fixedHome) {
  // 將資料庫欄位轉回 API 使用的命名，並在此處集中解析 sections_json。
  // 找不到資料時使用 404，讓 HTTP 路由能回傳正確狀態碼。
  function find(id) {
    const row = database.prepare("SELECT * FROM site_pages WHERE id = ?").get(id);
    if (!row) {
      throw new ContentError("找不到此頁面。", 404);
    }

    return {
      id: row.id,
      title: row.title,
      sections: JSON.parse(row.sections_json),
      status: row.status,
      revision: row.revision,
      updatedAt: row.updated_at,
    };
  }

  return {
    // 後台目前只允許編輯 about；首頁內容仍由 pages.json 與程式版本管理。
    adminPage(id) {
      if (id !== "about") {
        throw new ContentError("此區為固定內容，不需後台編輯。", 404);
      }

      return find(id);
    },
    // 公開 API 不回傳 revision、草稿或更新時間，避免洩露管理用狀態。
    // 下架頁面回傳 null，交由路由決定顯示 404 或空狀態。
    publicPage(id) {
      const page = id === "home" ? fixedHome : find(id);

      return page.status === "published" ? { title: page.title, sections: page.sections } : null;
    },
    // 使用樂觀鎖定更新 about：前端必須帶回讀取時的 revision。
    // 若其他視窗已先儲存，UPDATE 不會命中資料列並回傳 409，防止後存者覆蓋先存者。
    savePage(id, input) {
      if (id !== "about") {
        throw new ContentError("計畫介紹為固定內容，不開放後台編輯。", 404);
      }
      find(id);
      if (!Number.isSafeInteger(input?.revision)) {
        throw new ContentError("請重新載入頁面後再儲存。", 409);
      }
      const clean = validate(input);
      const result = database
        .prepare(
          `UPDATE site_pages
           SET title = ?, sections_json = ?, status = ?,
               revision = revision + 1, updated_at = CURRENT_TIMESTAMP
           WHERE id = ? AND revision = ?`,
        )
        .run(clean.title, JSON.stringify(clean.sections), clean.status, id, input.revision);
      if (!result.changes) {
        throw new ContentError("內容已被更新，請先重新載入再編輯。", 409);
      }

      return find(id);
    },
    // 匯出只包含可編輯的資料庫頁面；固定首頁已存在 pages.json，不重複輸出。
    exportPages() {
      return [find("about")];
    },
  };
}
