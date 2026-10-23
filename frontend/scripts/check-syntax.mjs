/*
 * 前端語法檢查器：遞迴尋找 public/assets/js 與 scripts 中的 .js／.mjs，逐一交給
 * Node.js --check。它不執行瀏覽器程式、也不驗證 DOM 或 API 行為；目的只是讓新增
 * 模組自動納入 npm run check，免得 package.json 維護一串容易漏掉的檔案清單。
 */

import { readdir } from "node:fs/promises";
import { extname, join, relative } from "node:path";
import { spawnSync } from "node:child_process";

const projectDirectory = new URL("../", import.meta.url);
const sourceDirectories = ["public/assets/js", "scripts"];
const supportedExtensions = new Set([".js", ".mjs"]);

// 遞迴掃描指定資料夾並只回傳 Node.js 能做語法檢查的程式檔。
// 使用相對於 frontend 的路徑，讓輸出的錯誤位置可直接在編輯器中開啟。
async function collectSourceFiles(directory) {
  const entries = await readdir(new URL(`${directory}/`, projectDirectory), {
    withFileTypes: true,
  });
  const files = [];

  for (const entry of entries) {
    const path = join(directory, entry.name);

    if (entry.isDirectory()) {
      files.push(...(await collectSourceFiles(path)));
    } else if (supportedExtensions.has(extname(entry.name))) {
      files.push(path);
    }
  }

  return files;
}

for (const sourceDirectory of sourceDirectories) {
  const files = await collectSourceFiles(sourceDirectory);

  for (const file of files) {
    // --check 只解析語法，不啟動 HTTP 服務或執行瀏覽器程式，因此檢查過程
    // 不需要資料庫、連線密鑰或 DOM。任一檔案失敗便沿用其退出碼停止。
    const result = spawnSync(process.execPath, ["--check", file], {
      cwd: projectDirectory,
      encoding: "utf8",
    });

    if (result.status !== 0) {
      process.stderr.write(result.stderr || result.stdout);
      process.exit(result.status || 1);
    }

    console.log(`✓ ${relative(".", file)}`);
  }
}
