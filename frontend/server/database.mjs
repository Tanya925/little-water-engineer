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
import { randomUUID } from "node:crypto";
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

    // 教材改為「章節 → 多筆小教材」後，舊版整章全文不再使用。先把舊索引
    // 標記為待刪除，讓既有同步機制確認 Vectorize 清理成功後才移除舊片段。
    database.exec("CREATE TABLE IF NOT EXISTS app_migrations (id TEXT PRIMARY KEY)");
    const materialMigration = "resource-materials-v2";
    if (!database.prepare("SELECT 1 FROM app_migrations WHERE id = ?").get(materialMigration)) {
      const legacyRows = database
        .prepare("SELECT ai_material_id AS aiMaterialId FROM teaching_resources WHERE ai_material_id != ''")
        .all();
      for (const row of legacyRows) {
        try {
          const legacy = ai.aiFind(row.aiMaterialId);
          ai.aiDelete(legacy.id, legacy.revision);
        } catch {
          // 舊連結可能已手動刪除；清除章節上的參照即可。
        }
      }
      database.exec("UPDATE teaching_resources SET ai_material_id = ''");
      database.prepare("INSERT INTO app_migrations (id) VALUES (?)").run(materialMigration);
    }
    function resourceMaterialRows(resourceId) {
      return database
        .prepare(
          `SELECT id, resource_id AS resourceId, title, material_type AS materialType,
            source_url AS sourceUrl, image_url AS imageUrl, ai_material_id AS aiMaterialId, sort_order AS sortOrder
           FROM resource_materials WHERE resource_id = ? ORDER BY sort_order, id`,
        )
        .all(resourceId);
    }

    function enrichResourceMaterial(row) {
      if (!row.aiMaterialId) {
        return { ...row, fullText: "", aiIndexState: "not-created", aiIndexError: "" };
      }
      try {
        const material = ai.aiFind(row.aiMaterialId);
        return {
          ...row,
          fullText: material.fullText,
          aiIndexState: material.indexState,
          aiIndexError: material.indexError,
        };
      } catch {
        return { ...row, fullText: "", aiIndexState: "not-created", aiIndexError: "" };
      }
    }

    // 章節本身只決定前台資料夾下載；小教材各自保存全文與 AI 索引。
    function enrichResource(resource) {
      const materials = resourceMaterialRows(resource.id).map(enrichResourceMaterial);
      return {
        ...resource,
        materials,
        aiIndexState: materials.length
          ? materials.every((item) => item.aiIndexState === "ready")
            ? "ready"
            : "pending"
          : "not-created",
      };
    }

    return {
      ...ai,
      ...learningStore(database),
      ...management,
      ...pages,
      resourceMaterialRows,
      saveResourceMaterial({ id, resourceId, title, materialType, sourceUrl, imageUrl, aiMaterialId, sortOrder }) {
        const materialId = id || `resource-material-${randomUUID()}`;
        database
          .prepare(
            `INSERT INTO resource_materials
              (id, resource_id, title, material_type, source_url, image_url, ai_material_id, sort_order, updated_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
             ON CONFLICT(id) DO UPDATE SET resource_id=excluded.resource_id, title=excluded.title,
              material_type=excluded.material_type, source_url=excluded.source_url,
              image_url=excluded.image_url,
              ai_material_id=excluded.ai_material_id, sort_order=excluded.sort_order,
              updated_at=CURRENT_TIMESTAMP`,
          )
          .run(materialId, resourceId, title, materialType, sourceUrl, imageUrl || "", aiMaterialId, sortOrder);
        return materialId;
      },
      deleteResourceMaterial(id) {
        database.prepare("DELETE FROM resource_materials WHERE id = ?").run(id);
      },
      deleteResource(id) {
        database.prepare("DELETE FROM teaching_resources WHERE id = ?").run(id);
      },
      adminList(kind) {
        const items = management.adminList(kind);

        return kind === "resources" ? items.map(enrichResource) : items;
      },
      adminFind(kind, id) {
        const item = management.adminFind(kind, id);

        return kind === "resources" ? enrichResource(item) : item;
      },
      adminExport() {
        const exported = management.adminExport();
        return {
          ...exported,
          resources: exported.resources.map(enrichResource),
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
