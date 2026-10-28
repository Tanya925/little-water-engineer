/*
 * 本機靜態預覽伺服器：從 frontend/public 提供網站檔案，方便確認尚未部署的版面。
 * /api/* 的 GET 請求會轉送正式 Worker，因此預覽時看到的教材與題庫仍是線上資料；
 * 這個腳本不適合作為離線測試或正式部署入口。路徑解析後必須留在 public 目錄內，
 * 避免網址中的相對路徑讀取專案其他檔案。
 */
import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, resolve, sep } from "node:path";

const root = resolve(import.meta.dirname, "../public");
const types = { ".html": "text/html", ".css": "text/css", ".js": "text/javascript", ".svg": "image/svg+xml", ".png": "image/png", ".jpg": "image/jpeg" };

createServer(async (request, response) => {
  try {
    const pathname = decodeURIComponent(new URL(request.url, "http://localhost").pathname);
    if (pathname.startsWith("/api/")) {
      // 預覽僅允許讀取公開 API；避免本機頁面意外向正式站送出寫入請求。
      if (request.method !== "GET") { response.writeHead(405).end(); return; }
      const upstream = await fetch(`https://little-water-engineer-site.ziijing2340.workers.dev${pathname}`);
      response.writeHead(upstream.status, { "content-type": upstream.headers.get("content-type") || "application/json" });
      response.end(Buffer.from(await upstream.arrayBuffer()));
      return;
    }
    const file = resolve(root, `.${pathname === "/" ? "/index.html" : pathname}`);
    // resolve 會正規化 ../；完成後再檢查根目錄，阻止路徑穿越。
    if (file !== root && !file.startsWith(root + sep)) { response.writeHead(403).end(); return; }
    const body = await readFile(file);
    response.writeHead(200, { "content-type": types[extname(file)] || "application/octet-stream" });
    response.end(body);
  } catch {
    response.writeHead(404).end("Not found");
  }
}).listen(4173, "127.0.0.1", () => process.stdout.write("Preview ready on http://127.0.0.1:4173\n"));
