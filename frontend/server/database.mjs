// 主要功能：開啟 SQLite、建立及遷移資料結構，整合影片、教材、題庫、管理、頁面與 AI 資料存取。
/*
 * 這是資料存取的組裝入口：基礎建表 → 舊版欄位遷移 → 初始資料補入 → 組合各領域方法。
 * database/*.json 是初始資料，不是目前正式內容；已匯入的項目由 SQLite 保存，重啟不覆蓋老師修改。
 * 此模組回傳的物件由 server.mjs 使用；SQL 的 ? 位置以參數綁定，資料值不直接串入 SQL。
 */
// .js：可能是傳統 CommonJS，也可能是 ES Module；要看 package.json 裡是否有 "type": "module"。
// .mjs：一定會被當成 ES Module。

import { DatabaseSync } from "node:sqlite";
import { mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { seedLearningContent, learningStore } from "./learning.mjs";
import { migrateManagement, managementStore } from "./management.mjs";
import { initializePages, pageStore } from "./pages.mjs";
import { aiStore } from "./ai-store.mjs";

// 所有初始化成功才回傳存取方法；初始化失敗會關閉連線。BEGIN／COMMIT 把初始匯入當成一組操作。
export async function openVideoDatabase(dataDirectory) {
  const schema = await readFile(new URL("../database/schema.sql", import.meta.url), "utf8");
  // videos.json：sourceFolderId 是 Drive 來源資料夾；videos 內保存檔案 ID、名稱、格式與大小。
  // 這些欄位只在缺少影片 ID 時補入；封面由 ID 對應到 public/assets/images/experiments/。
  const seed = JSON.parse(
    await readFile(new URL("../database/videos.json", import.meta.url), "utf8"),
  );
  await mkdir(dataDirectory, { recursive: true });
  const database = new DatabaseSync(join(dataDirectory, "site.sqlite"));
  try {
    database.exec("PRAGMA busy_timeout = 5000;");
    database.exec(schema);
    migrateManagement(database);
    database.exec("BEGIN IMMEDIATE");
    const insert = database.prepare(`
      INSERT INTO experiment_videos
        (drive_file_id, title, filename, mime_type, size_bytes, source_folder_id, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(drive_file_id) DO NOTHING
    `);
    seed.videos.forEach((video, index) => {
      insert.run(
        video.driveFileId,
        video.title,
        video.filename,
        video.mimeType,
        video.sizeBytes,
        seed.sourceFolderId,
        index + 1,
      );
    });
    await seedLearningContent(database);
    const fixedHome = await initializePages(database);
    database.exec("COMMIT");
    const list = database.prepare(`
      SELECT id, drive_file_id AS driveFileId, title, description, filename,
        mime_type AS mimeType, size_bytes AS sizeBytes, sort_order AS sortOrder, cover_path AS coverPath
      FROM experiment_videos WHERE status = 'published' ORDER BY sort_order, id
    `);
    const management = managementStore(database);
    const pages = pageStore(database, fixedHome);
    // 目前遊戲頁尚未實作可詢問助教的任務，所以直接傳入空陣列。
    // 日後真的新增遊戲任務時，再建立對應資料來源，避免先保留沒有內容的設定檔。
    const ai = aiStore(database, []);

    // 把教材卡片的管理欄位和對應 AI 全文／同步狀態合併，讓老師在同一表單編輯。
    function enrichResource(resource) {
      if (!resource.aiMaterialId) {
        return { ...resource, fullText: "", aiIndexState: "not-created" };
      }
      try {
        const material = ai.aiFind(resource.aiMaterialId);

        return {
          ...resource,
          fullText: material.fullText,
          aiIndexState: material.indexState,
          aiIndexError: material.indexError,
        };
      } catch {
        return { ...resource, fullText: "", aiIndexState: "not-created" };
      }
    }

    return {
      ...ai,
      ...learningStore(database),
      ...management,
      ...pages,
      adminList(kind) {
        const items = management.adminList(kind);

        return kind === "resources" ? items.map(enrichResource) : items;
      },
      adminFind(kind, id) {
        const item = management.adminFind(kind, id);

        return kind === "resources" ? enrichResource(item) : item;
      },
      adminExport() {
        return {
          ...management.adminExport(),
          pages: pages.exportPages(),
          aiMaterials: ai.aiList(),
        };
      },
      listVideos() {
        return list.all().map((video) => ({
          ...video,
          coverUrl:
            video.coverPath ||
            `/assets/images/experiments/${encodeURIComponent(video.driveFileId)}.jpg`,
          previewUrl: `https://drive.google.com/file/d/${encodeURIComponent(video.driveFileId)}/preview`,
          viewUrl: `https://drive.google.com/file/d/${encodeURIComponent(video.driveFileId)}/view`,
        }));
      },
      close() {
        database.close();
      },
    };
  } catch (error) {
    database.close();
    throw error;
  }
}
