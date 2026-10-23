// 將目前本機 SQLite 的網站內容轉成可由 Wrangler 匯入 D1 的 SQL。
// 只讀取來源資料庫；輸出檔由呼叫端指定，完成核對後可安全刪除。
import { DatabaseSync } from "node:sqlite";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const output = process.argv[2];
if (!output) {
  throw new Error("請指定輸出 SQL 檔案路徑。");
}

const source = resolve(import.meta.dirname, "../../frontend/.data/site.sqlite");
const destination = resolve(output);
const database = new DatabaseSync(source, { readOnly: true });
const tables = [
  "experiment_videos",
  "teaching_resources",
  "resource_materials",
  "quiz_questions",
  "latest_updates",
  "site_pages",
  "ai_materials",
  "ai_chunks",
  "app_migrations",
];

function literal(value) {
  if (value === null) return "NULL";
  if (typeof value === "number") return String(value);
  return `'${String(value).replaceAll("'", "''")}'`;
}

try {
  const statements = [];
  for (const table of tables) {
    const rows = database.prepare(`SELECT * FROM ${table}`).all();
    for (const row of rows) {
      const columns = Object.keys(row);
      statements.push(
        `INSERT INTO ${table} (${columns.join(", ")}) VALUES (${columns.map((column) => literal(row[column])).join(", ")});`,
      );
    }
  }
  await mkdir(dirname(destination), { recursive: true });
  await writeFile(destination, `${statements.join("\n")}\n`, "utf8");
  console.log(`已輸出 ${statements.length} 筆資料至 ${destination}`);
} finally {
  database.close();
}
