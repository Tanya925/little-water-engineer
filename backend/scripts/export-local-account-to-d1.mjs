// 將既有本機帳號的雜湊與 salt 匯出為一次性 D1 匯入檔；不輸出明碼密碼。
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const output = process.argv[2];
if (!output) throw new Error("請指定輸出 SQL 檔案路徑。");

const account = JSON.parse(
  await readFile(resolve(import.meta.dirname, "../../frontend/.data/account.json"), "utf8"),
);
if (
  typeof account.username !== "string" ||
  typeof account.salt !== "string" ||
  typeof account.hash !== "string"
) {
  throw new Error("本機帳號資料格式不正確。");
}

const quote = (value) => `'${value.replaceAll("'", "''")}'`;
await writeFile(
  resolve(output),
  `INSERT INTO teacher_accounts (username, password_hash, salt) VALUES (${quote(account.username)}, ${quote(account.hash)}, ${quote(account.salt)});\n`,
  "utf8",
);
console.log("已輸出 1 筆老師帳號雜湊資料。");
