# 小小水利工程師養成計畫

給國小高年級學生使用的土、風、水防災科普網站。學生可觀看影片、閱讀教材、完成題庫並向教材 AI 助教提問；老師由公開網站的登入後台管理正式內容。

正式網站：https://little-water-engineer-site.ziijing2340.workers.dev

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
   └── Workers AI：Qwen3 整理搜尋問句、bge-m3 建立向量、Qwen3 判斷教材是否足夠並生成具引用的回答
```

老師與開發者只要登入同一個公開網址，讀寫的就是同一份 D1。老師在後台儲存章節或小教材後，學生重新整理即可取得最新資料。

### AI 教材的狀態

1. 老師建立或編輯章節內小教材。
2. 全文、來源與可自行增減的教材圖片／圖說先安全寫入 D1。
3. Worker 在背景建立 Vectorize 索引。
4. 後台顯示「等待建立索引／正在建立／完成／失敗」。
5. AI 額度或服務暫時不可用時，教材不會遺失；老師可在該小教材按「重試索引」。

AI 回答只使用已發布且索引完成的教材。最近兩則學生問題只用來理解模糊追問；目前問題仍是搜尋與回答的優先依據。

### 學生問答流程

1. Worker 讀取目前問題及最近最多兩個學生問題。
2. 若目前問題包含完整題號，直接由 D1 讀取該教材；否則由 `@cf/qwen/qwen3-30b-a3b-fp8` 根據目前及前兩題整理搜尋問句，並判斷是否指向學生實際提過的教材。無法確定教材時請學生澄清；模型不能選擇候選清單以外的教材。
3. 一般問題再經 `@cf/baai/bge-m3` 轉成向量，交由 Vectorize 取回相近片段，並由 D1 驗證片段仍為已發布、目前版本且索引完成的教材。
4. Qwen3 以原始問題、最多兩個舊問題與最後片段，在**同一次呼叫**同時判斷教材是否足夠、生成回答，並列出實際使用的片段 ID。
5. 若教材不足，系統不顯示來源或圖片；模型格式不合法時回報服務錯誤。若足夠，僅顯示被引用教材的來源。圖片僅在指定教材時顯示，避免相似題目的圖片混入。

明確指定教材通常只需一次 Qwen3 回答呼叫；一般語意問題則依序使用一次 Qwen3 問句整理、一次 bge-m3 向量與一次 Qwen3 回答／判斷呼叫。

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
| `0004_resource_material_images.sql` | 為小教材新增多張圖片及各自圖說的儲存欄位；既有單張圖片仍相容。 |

### `frontend/public/`：瀏覽器畫面

| 類別 | 內容 |
| --- | --- |
| `index.html` | 學生網站主框架與 hash 路由容器。 |
| `admin.html`、`login.html` | 老師管理區與登入頁。資料不放在 HTML，而是由 API 載入。 |
| 其他 `*.html` | 功能入口與相容網址，例如影片、教材、題庫、AI 問答、活動與關於我們。 |
| `assets/js/` | 互動程式。`admin.js` 管理後台；`learning.js` 顯示教材／題庫；`ai.js` 與 `ai-qa-page.js` 顯示問答。 |
| `assets/css/` | 頁面與共用元件外觀。`admin.css` 是老師後台，`ai.css` 是問答元件，`learning.css` 是教材與題庫。 |
| `assets/images/` | 必要的實驗封面、角色場景、背景與裝飾圖。不要任意更名，JS 與 CSS 會以路徑引用。 |

## 逐檔功能索引

以下表格列出目前每一個受版本控制檔案的用途。圖片與 JSON 類型資產不適合在內容中插入程式註解，因此以本表作為其正式說明；程式檔則同時保有檔案開頭註解。

### 根目錄、CI 與套件設定

| 檔案 | 詳細用途 | 修改時注意 |
| --- | --- | --- |
| `package.json` | 全專案指令入口；`start`、`dev` 啟動 D1 Worker，`check` 串接前後端語法檢查。 | 不要改回啟動 SQLite；新增全專案指令才修改。 |
| `package-lock.json` | 固定根目錄 ESLint、Prettier 的精確版本。 | 僅由 `npm install` 更新，不手動編輯。 |
| `eslint.config.mjs` | JavaScript 可讀性規則，例如控制流程必須使用大括號。 | 調整程式風格規範時修改。 |
| `.prettierrc.json` | 縮排、引號、行寬等自動排版規則。 | 影響全專案格式，變更前應團隊確認。 |
| `.prettierignore` | 排除不應被 Prettier 改寫的資料或產物。 | 新增二進位／生成檔時才加入。 |
| `.gitignore` | 排除套件、Wrangler 開發資料、Cloudflare 暫存與密鑰。 | 新增私密或可重建檔時加入；不要忽略正式原始碼。 |
| `.github/workflows/deploy-cloudflare.yml` | GitHub Actions：推送 `main` 後安裝依賴、檢查語法並部署 Worker。 | 需在 GitHub 設定 `CLOUDFLARE_API_TOKEN` 才能自動部署。 |
| `README.md` | 本專案的啟動、部署、資料流與逐檔維護說明。 | 新增或刪除檔案、改資料流時同步更新。 |

### Cloudflare Worker、D1 與遷移

| 檔案 | 詳細用途 | 修改時注意 |
| --- | --- | --- |
| `backend/package.json` | Worker 的開發、部署與語法檢查指令；`start`／`dev` 會使用 `wrangler.site.jsonc`。 | 執行前須 `npm --prefix backend install`。 |
| `backend/package-lock.json` | 固定 Wrangler 及其依賴版本。 | 僅由 npm 更新。 |
| `backend/wrangler.site.jsonc` | Cloudflare 正式部署設定：Worker 名稱、靜態檔目錄、D1 ID、Workers AI、Vectorize 與 namespace。 | 綁定名稱必須與 `site-worker.js` 的 `env.DB`、`env.AI`、`env.VECTORIZE` 一致。 |
| `backend/src/site-worker.js` | 公開網站的唯一請求入口；分派學生 API、登入、老師後台、D1 存取與 AI 問答。 | 新 API 先在此加入安全路由，再放入適當的 D1 模組。 |
| `backend/src/d1-public.js` | 學生端資料查詢與作答判分；防止題庫答案在作答前外流。 | 只能回傳已發布內容；不可加入管理欄位。 |
| `backend/src/d1-auth.js` | scrypt 密碼雜湊驗證、session token 雜湊、Cookie 建立與登出清理。 | 不可改成把密碼或 token 傳回瀏覽器。 |
| `backend/src/d1-admin.js` | 老師後台的影片、章節、題庫、活動、頁面、匯出與匯入資料規則。 | SQL 表名與欄位必須維持白名單；寫入須帶 revision 防覆蓋。 |
| `backend/src/d1-materials.js` | 章節內小教材的 D1 寫入、全文分段、向量同步、重試、狀態連動與刪除清理。 | AI 暫時失敗時只能標記失敗，不能刪除教師已存教材。 |
| `backend/src/d1-ai.js` | 驗證 Vectorize 候選片段仍屬於當前、已發布且索引完成的教材。 | 任何 AI 回答前都必須經此驗證。 |
| `backend/src/ai-utils.js` | 將 Workers AI 的不同回應格式轉成文字。 | 保持無狀態；不要加入權限或資料庫邏輯。 |
| `backend/migrations/0001_site_schema.sql` | 建立第一版 D1 的內容、教材、題庫、頁面、AI 片段等核心資料表。 | 已套用的 migration 不回頭修改。 |
| `backend/migrations/0002_teacher_auth.sql` | 建立老師帳號與 session 資料表。 | 只儲存雜湊與 salt，絕不加入明碼密碼。 |
| `backend/migrations/0003_ai_conversations.sql` | 建立 AI 對話訊息資料表，保存最近脈絡。 | 不要把敏感個資放入對話欄位。 |
| `backend/migrations/0004_resource_material_images.sql` | 為小教材新增圖片清單與圖說欄位。 | 舊有 `image_url` 會保留，確保既有教材圖片不遺失。 |

### HTML 頁面

| 檔案 | 詳細用途 | 修改時注意 |
| --- | --- | --- |
| `frontend/public/index.html` | 學生網站完整主框架，含首頁、hash 功能容器、共用導覽、頁尾與主要角色結構。 | 是主要學生版型；改 DOM id／class 要同步檢查 `app.js`、`pages.js`、`learning.js`、`ai.js`。 |
| `frontend/public/admin.html` | 老師管理區的側欄、資料容器、編輯 dialog 與題庫匯入 dialog。 | id 與 `admin.js` 綁定；登入仍由 API 真正保護。 |
| `frontend/public/login.html` | 老師登入畫面與登入表單。 | 不放帳密或 D1 資訊；行為在 `login.js`。 |
| `frontend/public/ai-qa.html` | 獨立 AI 教材問答入口與對話容器。 | 回答與來源只能以 DOM 安全建立。 |
| `frontend/public/experiments.html` | 實驗影片功能入口。 | 與 `experiments.js`、`experiments.css` 成對維護。 |
| `frontend/public/resources.html` | 教材章節下載功能入口。 | 學生只讀公開 `/api/resources`，不直接讀 D1。 |
| `frontend/public/quiz.html` | 知識小學堂獨立入口。 | 正確答案不可寫在 HTML。 |
| `frontend/public/activities.html` | 活動紀錄獨立入口。 | 活動資料由 `activities-page.js` 取得。 |
| `frontend/public/about.html` | 關於我們獨立入口。 | 內容由 D1 `site_pages` 載入。 |
| `frontend/public/knowledge.html` | 科普知識預留入口。 | 未來文章功能應集中在同名 JS/CSS，不要塞回首頁。 |
| `frontend/public/honors.html` | 榮譽榜預留入口。 | 未來名單與成果資料應另建受保護 API。 |
| `frontend/public/games.html` | 互動遊戲預留入口。 | 未來遊戲狀態與得分應由伺服器驗證。 |

### JavaScript

| 檔案 | 詳細用途 | 修改時注意 |
| --- | --- | --- |
| `assets/js/app.js` | 控制主網站 hash 路由、導覽狀態、首頁切換與文字效果。 | 路由名稱需與 `index.html` 容器一致。 |
| `assets/js/pages.js` | 載入介紹型內容、切換頁面場景插圖並控制角色互動。 | 場景檔名須對應 `page-scenes/`。 |
| `assets/js/learning.js` | 載入教材與冒險題庫、控制選題、作答、解析與結果畫面。 | 只使用公開題目與 `/api/quiz/answer` 判分結果。 |
| `assets/js/ai.js` | 主網站內的教材 AI 與浮動助教介面。 | 不可在前端放模型權杖或教材全文。 |
| `assets/js/admin.js` | 老師後台的路由、列表、編輯器、小教材、索引重試、匯入、匯出與登入逾時處理。 | API 寫入格式需與 `d1-admin.js`、`d1-materials.js` 同步。 |
| `assets/js/login.js` | 查詢登入狀態、送出登入資料並導向後台。 | 密碼僅 POST 至同源 API，不存 localStorage。 |
| `assets/js/experiments.js` | 讀取、搜尋、建立影片卡片與播放器。 | Drive ID 同時決定影片連結與本機封面檔名。 |
| `assets/js/resources-page.js` | 建立公開教材章節卡片與資料夾連結。 | 只顯示已發布章節。 |
| `assets/js/quiz-page.js` | 獨立小學堂的選題、作答與解析流程。 | 任何答案判定都應交由 API。 |
| `assets/js/ai-qa-page.js` | 獨立 AI 問答頁的訊息、等待狀態與來源顯示。 | 對話 ID 僅作脈絡識別，不能當帳號。 |
| `assets/js/about-page.js` | 取得並渲染關於我們 D1 內容。 | 使用共用安全 DOM 工具。 |
| `assets/js/activities-page.js` | 取得並渲染公開活動。 | 外部活動連結需加安全 rel。 |
| `assets/js/index-page.js` | 首頁拆頁入口與導覽標示。 | 大型首頁互動應集中於此。 |
| `assets/js/knowledge-page.js` | 科普知識預告與未來文章功能入口。 | 新增文章 API 時由此發起。 |
| `assets/js/honors-page.js` | 榮譽榜預告與未來成果功能入口。 | 避免直接公開學生個資。 |
| `assets/js/games-page.js` | 遊戲預告與未來關卡功能入口。 | 得分不可僅由前端判定。 |
| `assets/js/shared/content-renderer.js` | 介紹頁共用安全 DOM 建立、訊息與載入狀態工具。 | 老師輸入一律用 `textContent`。 |
| `assets/js/shared/site-shell.js` | 公開頁共用導覽目前頁標示。 | 保持輕量，不放頁面商業邏輯。 |
| `frontend/scripts/check-syntax.mjs` | 遞迴以 Node `--check` 檢查前端 JS／MJS。 | 新增前端程式資料夾才需調整掃描目錄。 |
| `frontend/scripts/generate-page-scenes.mjs` | 以固定 SVG 模板重建九張功能頁場景圖。 | 僅在重建場景時手動執行。 |

### CSS

| 檔案 | 詳細用途 | 修改時注意 |
| --- | --- | --- |
| `assets/css/styles.css` | 全站色彩、字體、按鈕、連結與可及性焦點的基礎規則。 | 真正跨頁共用才放這裡。 |
| `assets/css/page-shell.css` | 公開頁頁首、導覽、最大寬度與頁尾外框。 | 改全站外框時使用。 |
| `assets/css/pages.css` | 首頁與介紹型頁面的章節、卡片、場景及響應式版面。 | 不放教材或聊天專屬樣式。 |
| `assets/css/learning.css` | 影片、教材、題庫等學習元件共用外觀。 | 學習元件跨頁共用時修改。 |
| `assets/css/quiz-friends.css` | 知識小學堂角色、地圖、動畫與冒險視覺。 | 依賴 quiz SVG 資產路徑。 |
| `assets/css/ai.css` | AI 對話泡泡、來源、輸入區與等待狀態共用外觀。 | 不改變訊息的安全文字插入方式。 |
| `assets/css/admin.css` | 老師後台完整桌面／手機版面、清單、dialog 與教材收合卡。 | 與 `admin.html`／`admin.js` class 同步。 |
| `assets/css/login.css` | 老師登入卡片、表單與錯誤訊息。 | 只影響登入頁。 |
| `assets/css/index.css` | 首頁拆頁入口樣式。 | 大型首頁設計仍多由共用樣式控制。 |
| `assets/css/experiments.css` | 影片頁入口樣式。 | 配合影片搜尋與卡片。 |
| `assets/css/resources.css` | 教材下載頁入口樣式。 | 配合教材清單與空狀態。 |
| `assets/css/quiz.css` | 獨立題庫頁入口樣式。 | 配合設定、題目與結果區。 |
| `assets/css/ai-qa.css` | 獨立 AI 問答頁入口樣式。 | 匯入／搭配 `ai.css`。 |
| `assets/css/activities.css` | 活動紀錄頁入口樣式。 | 未來活動卡片調整位置。 |
| `assets/css/about.css` | 關於我們頁入口樣式。 | 內容來自 D1，不應依文字硬編排。 |
| `assets/css/knowledge.css` | 科普知識頁入口樣式。 | 未來文章列表專用。 |
| `assets/css/honors.css` | 榮譽榜頁入口樣式。 | 未來成果與篩選專用。 |
| `assets/css/games.css` | 遊戲頁入口樣式。 | 未來關卡介面專用。 |

### 圖片與 SVG 資產

| 檔案／群組 | 詳細用途 | 修改時注意 |
| --- | --- | --- |
| `assets/images/experiments/1DRnZt8rmmuOBFnWg0iiNH_RYHC8TPlZL.jpg` | 「柏努力方程式簡單介紹」影片封面。 | 檔名是 Drive 檔案 ID。 |
| `assets/images/experiments/17wadmL4vVQqVJxwO9LkKLtsoOg-Zv1vv.jpg` | 「柏努力方程式 v2」影片封面。 | 檔名需維持 Drive ID。 |
| `assets/images/experiments/1ZBLo4Uyd058msT3qKS64Wi7CbeMMxhZ2.jpg` | 「吹紙條、鋁罐」影片封面。 | 同上。 |
| `assets/images/experiments/1gZHrCvRAselcHBULGCesGN-BFHpoPnvy.jpg` | 「吹垃圾袋」影片封面。 | 同上。 |
| `assets/images/experiments/145JCYy3E9gSfgCLmBPLA0RBjXCkBWT4S.jpg` | 「吹風機吹乒乓球」影片封面。 | 同上。 |
| `assets/images/experiments/1TuAt9DwyR29AlIinBpCb0dRIc3VhJvzq.jpg` | 「吸塵器」影片封面。 | 同上。 |
| `assets/images/experiments/1mXoC6xlKfzht4mAo8FbdUh6liFFBBWtL.jpg` | 「長短噴嘴」影片封面。 | 同上。 |
| `assets/images/experiments/1DNqOPU6a_ba8JuuzAFFu5-E9X3418UKI.jpg` | 「表面張力」影片封面。 | 同上。 |
| `assets/images/experiments/14AjsIEw_tSzXvzylOjEECKlDTUf3zRbD.jpg` | 「虹吸現象」影片封面。 | 同上。 |
| `assets/images/page-scenes/about.svg` | 關於我們頁上方夥伴場景。 | `pages.js` 以頁面名稱載入。 |
| `assets/images/page-scenes/activities.svg` | 活動紀錄頁上方相機場景。 | 檔名不可更動。 |
| `assets/images/page-scenes/ai-qa.svg` | AI 問答頁上方機器人場景。 | 檔名不可更動。 |
| `assets/images/page-scenes/experiments.svg` | 實驗影片頁上方螢幕場景。 | 檔名不可更動。 |
| `assets/images/page-scenes/games.svg` | 遊戲頁上方手把場景。 | 檔名不可更動。 |
| `assets/images/page-scenes/honors.svg` | 榮譽榜頁上方獎盃場景。 | 檔名不可更動。 |
| `assets/images/page-scenes/knowledge.svg` | 科普知識頁上方燈泡場景。 | 檔名不可更動。 |
| `assets/images/page-scenes/quiz.svg` | 題庫頁上方題本場景。 | 檔名不可更動。 |
| `assets/images/page-scenes/resources.svg` | 教材頁上方書本場景。 | 檔名不可更動。 |
| `assets/images/quiz-wave.svg` | 首頁水波裝飾。 | 屬純視覺，不承載必要文字。 |
| `assets/images/quiz-camp.svg` | 首頁科普營地插圖。 | 由首頁／學習場景使用。 |
| `assets/images/quiz-sky.svg` | 首頁天空背景裝飾。 | 維持 SVG 可縮放特性。 |
| `assets/images/quiz-river-garden.svg` | 小學堂河流與花園裝飾。 | 由題庫場景使用。 |
| `assets/images/quiz-forest.svg` | 小學堂森林邊框裝飾。 | 配合地圖場景使用。 |
| `assets/images/quiz-forest-center.svg` | 小學堂森林中央補強裝飾。 | 與 forest.svg 一起維持。 |
| `assets/images/quiz-map-texture.svg` | 小學堂地圖底紋與路徑。 | 移除會讓冒險地圖失去背景。 |
| `assets/images/quiz-answer-decor.svg` | 題目回饋／答案區裝飾。 | 配合題庫結果畫面。 |

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
