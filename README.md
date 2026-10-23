# 小小水利工程師養成計畫

給國小高年級學生使用的土、風、水防災科普網站。學生可觀看影片、閱讀教材、完成題庫並向教材 AI 助教提問；老師由公開網站的登入後台管理正式內容。

> 正式網站與正式內容都在 Cloudflare：網站程式由 **Workers** 執行，內容、老師帳號與對話紀錄由 **D1** 保存，教材語意搜尋使用 **Vectorize**。本專案不再使用本機 SQLite。

## 三個最常用的操作

| 想做什麼 | 指令／位置 | 結果 |
| --- | --- | --- |
| 本機開發 | `npm start` 或 `npm run dev` | 啟動 Cloudflare Worker 開發模式，讀寫遠端 D1。終端機會顯示本機網址。 |
| 檢查程式 | `npm run check` | 檢查 Worker 與所有前端 JavaScript 語法；不會修改資料。 |
| 正式部署 | `npm --prefix backend run deploy` | 將目前 Worker 與前端靜態檔部署到 Cloudflare。 |

第一次在新電腦開發：

```powershell
npm install
npm --prefix backend install
npm start
```

本機啟動 Worker 時需要已登入 Cloudflare 的 Wrangler 權限；它會直接連到正式 D1。因此測試新增、修改或刪除內容前，請使用下架草稿或測試資料，避免改動老師正在使用的正式內容。

## 正式網址與資料流

```text
學生／老師瀏覽器
        ↓
Cloudflare Worker（backend/src/site-worker.js）
   ├── 前端 HTML、CSS、JS、圖片
   ├── D1：影片、章節、小教材、題庫、頁面、老師登入
   ├── Vectorize：教材語意搜尋
   └── Workers AI：整理搜尋問句、建立向量、生成教材回答
```

老師與開發者只要登入同一個公開網址，讀寫的就是同一份 D1。老師在後台儲存章節或小教材後，學生重新整理即可取得最新資料。

### AI 教材的狀態

1. 老師建立或編輯章節內小教材。
2. 全文、來源與圖片連結先安全寫入 D1。
3. Worker 在背景建立 Vectorize 索引。
4. 後台顯示「等待建立索引／正在建立／完成／失敗」。
5. AI 額度或服務暫時不可用時，教材不會遺失；老師可在該小教材按「重試索引」。

AI 回答只使用已發布且索引完成的教材。最近三則學生問題只用來理解模糊追問；目前問題仍是搜尋與回答的優先依據。

## 專案結構

```text
.
├── frontend/
│   ├── public/                    學生頁面、老師後台與瀏覽器端資產
│   ├── scripts/check-syntax.mjs   前端語法檢查工具
│   └── package.json               前端檢查指令
├── backend/
│   ├── src/                       Cloudflare Worker 與 D1 資料模組
│   ├── migrations/                D1 資料表演進紀錄
│   ├── wrangler.site.jsonc        正式 Worker、D1、AI、Vectorize 綁定
│   └── package.json               Worker 的啟動、檢查與部署指令
├── .github/workflows/             GitHub Actions 自動部署流程
├── package.json                   全專案快捷指令
└── README.md                      本說明文件
```

## 檔案用途

### `backend/src/`：正式網站後端

| 檔案 | 責任 |
| --- | --- |
| `site-worker.js` | 唯一的公開網站入口。提供靜態檔、學生 API、登入、老師後台 API 與 AI 問答路由。 |
| `d1-public.js` | 只讀取學生可見的影片、教材、活動、頁面與題庫；不把正確答案或草稿送到瀏覽器。 |
| `d1-auth.js` | 驗證老師帳號的 scrypt 雜湊密碼，建立與驗證 HttpOnly session cookie。 |
| `d1-admin.js` | 管理影片、章節、題庫、活動、關於我們頁面、內容匯出與題庫匯入；使用欄位白名單與版本衝突檢查。 |
| `d1-materials.js` | 管理章節內小教材的全文、來源、圖片、發布狀態與 Vectorize 同步／重試／刪除清理。 |
| `d1-ai.js` | 將 Vectorize 搜尋結果回到 D1 驗證，排除已下架、刪除或舊版本教材。 |
| `ai-utils.js` | 將不同 Workers AI 回應格式統一成文字；不包含資料庫或路由邏輯。 |

### `backend/migrations/`：D1 結構

Migration 是可依序執行的資料庫變更紀錄，不是教材內容。新資料庫必須依檔名順序套用；已部署的 migration 不要直接修改，新增結構時應建立下一號檔案。

| 檔案 | 建立內容 |
| --- | --- |
| `0001_site_schema.sql` | 影片、教材章節、小教材、題庫、活動、頁面、AI 教材與片段資料表。 |
| `0002_teacher_auth.sql` | 老師帳號與登入 session 資料表。 |
| `0003_ai_conversations.sql` | AI 對話紀錄資料表，用於保留最近提問脈絡。 |

### `frontend/public/`：瀏覽器畫面

| 類別 | 內容 |
| --- | --- |
| `index.html` | 學生網站主框架與 hash 路由容器。 |
| `admin.html`、`login.html` | 老師管理區與登入頁。資料不放在 HTML，而是由 API 載入。 |
| 其他 `*.html` | 功能入口與相容網址，例如影片、教材、題庫、AI 問答、活動與關於我們。 |
| `assets/js/` | 互動程式。`admin.js` 管理後台；`learning.js` 顯示教材／題庫；`ai.js` 與 `ai-qa-page.js` 顯示問答。 |
| `assets/css/` | 頁面與共用元件外觀。`admin.css` 是老師後台，`ai.css` 是問答元件，`learning.css` 是教材與題庫。 |
| `assets/images/` | 必要的實驗封面、角色場景、背景與裝飾圖。不要任意更名，JS 與 CSS 會以路徑引用。 |

## 老師後台與 D1

| 操作 | 寫入位置 | 學生何時看到 |
| --- | --- | --- |
| 新增／修改影片、教材章節、題庫、活動 | D1 | 資料為「發布」時，重新整理前台即可看見。 |
| 新增／修改章節內小教材 | D1 + Vectorize 背景索引 | 發布且索引完成後，可作為 AI 問答來源。 |
| 編輯關於我們 | D1 `site_pages` | 發布後重新整理頁面。 |
| 匯入題庫 | D1 `quiz_questions` | 先以「下架」存入，老師檢查並發布後才出現在學生題庫。 |
| 內容匯出 | Worker 從 D1 產生 JSON | 下載內容備份；不含密碼、session 或 Cloudflare 密鑰。 |

## 部署與 GitHub

目前公開網站由 `backend/wrangler.site.jsonc` 部署。GitHub Actions 工作流程位於 `.github/workflows/deploy-cloudflare.yml`；要讓推送 `main` 後自動部署，請在 GitHub repository secrets 建立：

```text
CLOUDFLARE_API_TOKEN
```

Token 應限縮為既有 Worker 的 **Workers Editor** 權限。Token 不可放進 `.env`、原始碼、README 或聊天室。設定完成後，推送到 `main` 會先執行檢查，再部署 Worker。

## 不應提交或手動修改的內容

| 路徑 | 原因 |
| --- | --- |
| `node_modules/`、`backend/node_modules/` | 可由 lockfile 重新安裝的第三方套件。 |
| `.wrangler/` | Wrangler 的本機開發資料。 |
| `backend/.migration-data/` | 遷移期間產生的暫時資料，可能含敏感雜湊。 |
| `.cache/` | 可重新產生的媒體處理快取。 |
| `.env`、`.dev.vars` | 密鑰或本機設定；正式版本應使用 Cloudflare secrets。 |

## 維護原則

- 正式內容只在公開老師後台修改，避免建立第二份本機資料庫。
- 不要將老師輸入、外部連結或 AI 回答以 `innerHTML` 插入畫面；使用安全 DOM API 與 `textContent`。
- 新增 D1 欄位或資料表時，建立新的 migration，不要回頭修改已部署的 migration。
- 新增公開 API 時，區分學生可讀資料與老師可管理資料；所有老師寫入都需登入、同源檢查與伺服器端驗證。
- 每次修改後執行 `npm run check`；資料庫管理功能須以暫時資料完整測試新增、讀取、修改、刪除與清理。
