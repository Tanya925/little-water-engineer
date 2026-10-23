// 主要功能：驗證老師修改的內容，處理影片、教材、題庫與最新活動的管理、發布狀態、版本及匯入匯出。
/*
 * 後台資料共用這一層驗證及存取，前端表單的限制不能代替伺服器驗證。
 * kind 決定內容類別，白名單再把它轉成資料表名稱；資料值使用 SQL 參數。
 * revision 是版本號：儲存時比對前端讀取的版本，避免較舊的表單覆蓋其他修改。
 */
import { randomUUID } from "node:crypto";
export const quizTopics = [
  "柏努利與基礎流力",
  "搶救堰塞湖",
  "大地在搖晃",
  "超級颱風眼",
  "迷你都市淹水大作戰",
];
export const contentStates = ["published", "draft"];
export class ContentError extends Error {
  constructor(message, status = 400) {
    super(message);
    this.status = status;
  }
}
const tables = {
  experiments: "experiment_videos",
  resources: "teaching_resources",
  questions: "quiz_questions",
  updates: "latest_updates",
};

/**
 * 驗證並正規化單行或長文字欄位。
 * max 以 JavaScript 字串長度計算；optional 只允許空值，不會略過型別檢查。
 */
const text = (value, label, max = 200, optional = false) => {
  if (value === undefined && optional) {
    return "";
  }
  if (typeof value !== "string" || (!optional && !value.trim()) || value.length > max) {
    throw new ContentError(`${label}必須填寫，且不可超過 ${max} 字。`);
  }

  return value.trim();
};

/** 驗證字串陣列的項目數與每項長度，供教材章節及題目來源清單共用。 */
const lines = (value, label) => {
  if (!Array.isArray(value) || value.length > 50) {
    throw new ContentError(`${label}最多 50 項。`);
  }

  return value.map((item) => text(item, label, 1000));
};

/** 將前端發布狀態限制在資料庫 CHECK 約束允許的兩個值。 */
function state(value) {
  if (!contentStates.includes(value)) {
    throw new ContentError("請選擇有效的發布狀態。");
  }

  return value;
}

/** 驗證顯示順序為合理範圍內的整數，避免 NaN 或極大值寫入資料庫。 */
function order(value) {
  if (!Number.isInteger(value) || value < 0 || value > 100000) {
    throw new ContentError("排序需為 0–100000 的整數。");
  }

  return value;
}

/**
 * 接受 Google Drive 檔案 ID 或正式分享網址，最後統一回傳檔案 ID。
 * 主機、帳密、連接埠及 ID 格式都需符合白名單，避免任意網址成為 iframe 來源。
 */
export function driveId(value) {
  let id = text(value, "影片連結或檔案 ID", 1000);
  if (id.startsWith("https://")) {
    let url;
    try {
      url = new URL(id);
    } catch {
      throw new ContentError("請填寫有效的 Google Drive 影片網址。");
    }
    if (url.hostname !== "drive.google.com" || url.username || url.password || url.port) {
      throw new ContentError("影片需使用 Google Drive 連結。");
    }
    id = /^\/file\/d\/([\w-]+)(?:\/|$)/.exec(url.pathname)?.[1] || url.searchParams.get("id") || "";
  }
  if (!/^[\w-]{10,150}$/.test(id)) {
    throw new ContentError("Google Drive 檔案 ID 格式不正確。");
  }

  return id;
}

/**
 * 依內容類別驗證輸入，並轉成資料表使用的 snake_case 欄位。
 * creating 決定是否產生新 ID；更新時的 revision 比對由 save 先行完成。
 */
function validate(kind, input, creating) {
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    throw new ContentError("內容格式不正確。");
  }
  const result = { status: state(input.status) };
  if (kind !== "questions") {
    result.title = text(input.title, "標題");
    result.sort_order = order(input.sortOrder);
  }
  if (kind === "experiments") {
    result.drive_file_id = driveId(input.driveFileId);
    result.description = text(input.description || "", "影片簡介", 3000, true);
    result.filename = text(input.filename || result.title, "原始檔名", 250);
    result.mime_type = input.mimeType === "video/quicktime" ? "video/quicktime" : "video/mp4";
    result.size_bytes =
      Number.isSafeInteger(input.sizeBytes) && input.sizeBytes >= 0 ? input.sizeBytes : 0;
    result.source_folder_id = text(input.sourceFolderId || "", "來源資料夾 ID", 150, true);
    result.cover_path = text(input.coverPath || "", "封面", 150, true);
    if (
      result.cover_path &&
      !/^\/media\/covers\/[a-f0-9]{32}\.(jpg|png|webp)$/.test(result.cover_path)
    ) {
      throw new ContentError("請使用上傳的封面圖片。");
    }
  } else if (kind === "resources") {
    if (creating) {
      result.id =
        input.id === undefined ? `resource-${randomUUID()}` : text(input.id, "教材代號", 64);
    }
    result.description = text(input.description || "", "教材簡介", 3000, true);
    let url;
    try {
      url = new URL(input.folderUrl);
    } catch {
      throw new ContentError("請填寫有效的教材資料夾網址。");
    }
    if (
      url.protocol !== "https:" ||
      url.hostname !== "drive.google.com" ||
      url.username ||
      url.password ||
      url.port ||
      !/^\/drive\/(?:u\/\d+\/)?folders\/[\w-]+\/?$/.test(url.pathname)
    ) {
      throw new ContentError("教材需使用 Google Drive 資料夾連結。");
    }
    result.folder_url = url.origin + url.pathname;
    result.sections_json = JSON.stringify(lines(input.sections || [], "教材內容清單"));
  } else if (kind === "updates") {
    if (creating) {
      result.id = `update-${randomUUID()}`;
    }
    result.description = text(input.description || "", "活動簡介", 5000, true);
    result.event_date = text(input.eventDate || "", "活動日期", 10, true);
    if (
      result.event_date &&
      (!/^\d{4}-\d{2}-\d{2}$/.test(result.event_date) ||
        Number.isNaN(Date.parse(result.event_date)) ||
        new Date(result.event_date).toISOString().slice(0, 10) !== result.event_date)
    ) {
      throw new ContentError("請填寫有效的活動日期。");
    }
    result.link_url = text(input.linkUrl || "", "活動連結", 1500, true);
    if (result.link_url) {
      let url;
      try {
        url = new URL(result.link_url);
      } catch {
        throw new ContentError("請填寫完整的活動連結。");
      }
      if (!["http:", "https:"].includes(url.protocol) || url.username || url.password) {
        throw new ContentError("活動連結需使用 http 或 https 網址。");
      }
      result.link_url = url.href;
    }
  } else if (kind === "questions") {
    if (creating) {
      result.id = input.id === undefined ? `question-${randomUUID()}` : text(input.id, "題號", 64);
    }
    if (!["選擇題", "是非題"].includes(input.type)) {
      throw new ContentError("請選擇有效的題型。");
    }
    if (!quizTopics.includes(input.topic)) {
      throw new ContentError("請從現有五個冒險主題選擇。");
    }
    if (!["易", "中", "難"].includes(input.difficulty)) {
      throw new ContentError("請選擇有效的難度。");
    }
    result.type = input.type;
    result.topic = input.topic;
    result.difficulty = input.difficulty;
    result.question = text(input.question, "題目", 4000);
    const options =
      input.type === "是非題"
        ? { O: "正確", X: "錯誤" }
        : Object.fromEntries(
            ["A", "B", "C", "D"].map((key) => [
              key,
              text(input.options?.[key], `選項 ${key}`, 2000),
            ]),
          );
    const answer =
      input.type === "是非題" && typeof input.answer === "string"
        ? input.answer.slice(0, 1)
        : input.answer;
    if (!Object.hasOwn(options, answer)) {
      throw new ContentError("正確答案必須是這一題的有效選項。");
    }
    result.options_json = JSON.stringify(options);
    result.answer = answer;
    result.answer_text = options[answer];
    result.explanation = text(input.explanation, "答案解析", 8000);
    result.basis = text(input.basis || "", "題目依據", 1000, true);
    result.sources_json = JSON.stringify(lines(input.sources || [], "來源"));
  } else {
    throw new ContentError("找不到此內容類別。", 404);
  }
  if (result.id && !/^[a-zA-Z0-9_-]{1,64}$/.test(result.id)) {
    throw new ContentError("代號僅能使用英文字母、數字、底線與連字號。");
  }

  return result;
}

// 舊資料庫可能缺少管理欄位，先檢查再補欄位，不重建或清空原資料表。
/**
 * 建立管理功能後來新增的資料表與欄位，並把舊 archived 狀態遷移為 draft。
 * 每一步都先查詢 schema，因此可在每次啟動安全重跑，不會重複新增欄位。
 */
export function migrateManagement(database) {
  database.exec(`CREATE TABLE IF NOT EXISTS resource_materials (
    id TEXT PRIMARY KEY, resource_id TEXT NOT NULL, title TEXT NOT NULL,
    material_type TEXT NOT NULL, source_url TEXT NOT NULL,
    image_url TEXT NOT NULL DEFAULT '',
    ai_material_id TEXT NOT NULL DEFAULT '', sort_order INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  ); CREATE INDEX IF NOT EXISTS resource_materials_resource ON resource_materials(resource_id, sort_order, id);`);
  database.exec(`CREATE TABLE IF NOT EXISTS latest_updates (
    id TEXT PRIMARY KEY, title TEXT NOT NULL, description TEXT NOT NULL DEFAULT '',
    event_date TEXT NOT NULL DEFAULT '', link_url TEXT NOT NULL DEFAULT '', sort_order INTEGER NOT NULL DEFAULT 0
  )`);
  for (const table of Object.values(tables)) {
    const columns = database
      .prepare(`PRAGMA table_info(${table})`)
      .all()
      .map((row) => row.name);
    if (!columns.includes("status")) {
      database.exec(
        `ALTER TABLE ${table}
         ADD COLUMN status TEXT NOT NULL DEFAULT 'published'
         CHECK(status IN ('published','draft'))`,
      );
    }
    if (!columns.includes("revision")) {
      database.exec(`ALTER TABLE ${table} ADD COLUMN revision INTEGER NOT NULL DEFAULT 1`);
    }
    if (!columns.includes("updated_at")) {
      database.exec(`ALTER TABLE ${table} ADD COLUMN updated_at TEXT NOT NULL DEFAULT ''`);
    }
    database.exec(
      `UPDATE ${table}
       SET status = 'draft', revision = revision + 1, updated_at = CURRENT_TIMESTAMP
       WHERE status = 'archived'`,
    );
  }
  if (
    !database
      .prepare("PRAGMA table_info(experiment_videos)")
      .all()
      .some((row) => row.name === "cover_path")
  ) {
    database.exec("ALTER TABLE experiment_videos ADD COLUMN cover_path TEXT NOT NULL DEFAULT ''");
  }
  if (
    !database
      .prepare("PRAGMA table_info(experiment_videos)")
      .all()
      .some((row) => row.name === "description")
  ) {
    database.exec("ALTER TABLE experiment_videos ADD COLUMN description TEXT NOT NULL DEFAULT ''");
  }
  if (
    !database
      .prepare("PRAGMA table_info(teaching_resources)")
      .all()
      .some((row) => row.name === "ai_material_id")
  ) {
    database.exec(
      "ALTER TABLE teaching_resources ADD COLUMN ai_material_id TEXT NOT NULL DEFAULT ''",
    );
  }
  if (
    !database
      .prepare("PRAGMA table_info(resource_materials)")
      .all()
      .some((row) => row.name === "image_url")
  ) {
    database.exec("ALTER TABLE resource_materials ADD COLUMN image_url TEXT NOT NULL DEFAULT ''");
  }
}

/**
 * 將資料庫欄位轉成前端使用的 camelCase 物件。
 * JSON 欄位在離開資料層前統一還原，避免 UI 重複處理序列化格式。
 */
function decode(kind, row) {
  const common = {
    id: row.id,
    status: row.status,
    revision: row.revision,
    updatedAt: row.updated_at,
  };
  if (kind === "experiments") {
    return {
      ...common,
      title: row.title,
      description: row.description,
      driveFileId: row.drive_file_id,
      filename: row.filename,
      mimeType: row.mime_type,
      sizeBytes: row.size_bytes,
      sourceFolderId: row.source_folder_id,
      sortOrder: row.sort_order,
      coverPath: row.cover_path,
      coverUrl:
        row.cover_path || `/assets/images/experiments/${encodeURIComponent(row.drive_file_id)}.jpg`,
      viewUrl: `https://drive.google.com/file/d/${encodeURIComponent(row.drive_file_id)}/view`,
    };
  }
  if (kind === "resources") {
    return {
      ...common,
      title: row.title,
      folderUrl: row.folder_url,
      description: row.description,
      sections: JSON.parse(row.sections_json),
      sortOrder: row.sort_order,
      aiMaterialId: row.ai_material_id || "",
    };
  }
  if (kind === "updates") {
    return {
      ...common,
      title: row.title,
      description: row.description,
      eventDate: row.event_date,
      linkUrl: row.link_url,
      sortOrder: row.sort_order,
    };
  }

  return {
    ...common,
    type: row.type,
    topic: row.topic,
    difficulty: row.difficulty,
    question: row.question,
    options: JSON.parse(row.options_json),
    answer: row.answer,
    answerText: row.answer_text,
    explanation: row.explanation,
    basis: row.basis,
    sources: JSON.parse(row.sources_json),
  };
}

/**
 * 以同一 SQLite 連線建立後台資料存取介面。
 * tableFor 是動態資料表名稱的唯一入口，只有 tables 白名單中的類別能進入 SQL；
 * 實際內容值則全部使用預備敘述參數，不能直接拼入查詢字串。
 */
export function managementStore(database) {
  function tableFor(kind) {
    if (!Object.hasOwn(tables, kind)) {
      throw new ContentError("找不到此內容類別。", 404);
    }

    return tables[kind];
  }

  function list(kind) {
    return database
      .prepare(
        `SELECT * FROM ${tableFor(kind)} ORDER BY ${kind === "questions" ? "id" : "sort_order, id"}`,
      )
      .all()
      .map((row) => decode(kind, row));
  }

  function find(kind, id) {
    const row = database.prepare(`SELECT * FROM ${tableFor(kind)} WHERE id = ?`).get(id);
    if (!row) {
      throw new ContentError("找不到這筆內容，請重新整理。", 404);
    }

    return decode(kind, row);
  }

  // 先驗證輸入及 revision 再寫入；版本衝突回傳錯誤，要求重新載入最新內容。
  function save(kind, id, input) {
    const table = tableFor(kind),
      creating = id === null;
    if (!creating) {
      const current = find(kind, id);
      if (input?.revision !== current.revision) {
        throw new ContentError("這筆內容已被更新，請關閉編輯視窗後重新開啟。", 409);
      }
      input = { ...current, ...input };
    }
    const values = validate(kind, input, creating);
    if (
      values.cover_path &&
      !database.prepare("SELECT 1 FROM managed_covers WHERE path = ?").get(values.cover_path)
    ) {
      throw new ContentError("找不到這張封面，請重新上傳。");
    }
    try {
      const keys = Object.keys(values);
      if (creating) {
        const inserted = database
          .prepare(
            `INSERT INTO ${table} (${keys.join(",")}, updated_at)
             VALUES (${keys.map(() => "?").join(",")}, CURRENT_TIMESTAMP)`,
          )
          .run(...Object.values(values));
        id = values.id || Number(inserted.lastInsertRowid);
      } else {
        database
          .prepare(
            `UPDATE ${table}
             SET ${keys.map((key) => `${key} = ?`).join(",")},
                 revision = revision + 1,
                 updated_at = CURRENT_TIMESTAMP
             WHERE id = ?`,
          )
          .run(...Object.values(values), id);
      }
    } catch (error) {
      if (error.message.includes("UNIQUE constraint")) {
        throw new ContentError(
          "代號或 Drive 檔案已存在，請從清單編輯原有內容（含封存項目）。",
          409,
        );
      }
      throw error;
    }

    return find(kind, id);
  }

  database.exec("CREATE TABLE IF NOT EXISTS managed_covers (path TEXT PRIMARY KEY)");

  return {
    adminList: list,
    adminFind: find,
    adminSave: save,
    adminSetResourceMaterial(id, materialId) {
      const current = find("resources", id);
      database
        .prepare(
          "UPDATE teaching_resources SET ai_material_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?",
        )
        .run(materialId, id);

      return find("resources", current.id);
    },
    listUpdates() {
      return list("updates")
        .filter((item) => item.status === "published")
        .map(({ title, description, eventDate, linkUrl }) => ({
          title,
          description,
          eventDate,
          linkUrl,
        }));
    },
    adminStatus(kind, id, input) {
      tableFor(kind);
      const current = find(kind, id);
      if (input?.revision !== current.revision) {
        throw new ContentError("這筆內容已被更新，請重新整理。", 409);
      }
      database
        .prepare(
          `UPDATE ${tables[kind]} SET status = ?, revision = revision + 1, updated_at = CURRENT_TIMESTAMP WHERE id = ?`,
        )
        .run(state(input.status), id);

      return find(kind, id);
    },
    adminOverview() {
      return {
        collections: Object.entries(tables)
          .filter(([kind]) => kind !== "updates")
          .map(([kind, table]) => ({
            kind,
            ...Object.fromEntries(
              contentStates.map((status) => [
                status,
                database
                  .prepare(`SELECT count(*) AS count FROM ${table} WHERE status = ?`)
                  .get(status).count,
              ]),
            ),
          })),
        topics: quizTopics.map((topic) => ({
          topic,
          count: database
            .prepare(
              "SELECT count(*) AS count FROM quiz_questions WHERE topic = ? AND status = 'published'",
            )
            .get(topic).count,
        })),
      };
    },
    adminExport() {
      return {
        format: "little-water-engineer-content",
        version: 1,
        exportedAt: new Date().toISOString(),
        experiments: list("experiments"),
        resources: list("resources"),
        questions: list("questions"),
        updates: list("updates"),
      };
    },
    registerCover(path) {
      database.prepare("INSERT INTO managed_covers (path) VALUES (?)").run(path);
    },
    coverVisible(path) {
      return Boolean(
        database
          .prepare("SELECT 1 FROM experiment_videos WHERE cover_path = ? AND status = 'published'")
          .get(path),
      );
    },
    importQuestions(input, commit = false) {
      if (!Array.isArray(input) || !input.length || input.length > 1000) {
        throw new ContentError("請匯入 1–1000 題的 JSON 陣列。");
      }
      const ids = new Set();
      const rows = input.map((row) => {
        const value = {
          ...row,
          id: text(row?.id, "匯入題號", 64),
          sources: row?.sources || [],
          status: "draft",
        };
        validate("questions", value, true);
        if (ids.has(value.id)) {
          throw new ContentError(`匯入檔有重複題號：${value.id}`);
        }
        ids.add(value.id);
        if (database.prepare("SELECT 1 FROM quiz_questions WHERE id = ?").get(value.id)) {
          throw new ContentError(`題號 ${value.id} 已存在；請修改原題或使用新的題號。`);
        }

        return value;
      });
      if (commit) {
        database.exec("BEGIN IMMEDIATE");
        try {
          rows.forEach((row) => save("questions", null, row));
          database.exec("COMMIT");
        } catch (error) {
          database.exec("ROLLBACK");
          throw error;
        }
      }

      return {
        count: rows.length,
        topics: [...new Set(rows.map((row) => row.topic))],
        imported: commit,
      };
    },
  };
}
