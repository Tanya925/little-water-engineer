# 小小水利工程師養成計畫

給國小高年級學生使用的土、風、水防災科普網站。學生可以看實驗影片、下載教材、進行知識練習，並在老師提供教材後使用 AI 問答；老師則可從登入後台管理內容。

## 開始使用

需要 Node.js 22.13 或更新版本。

第一次下載專案時，先安裝根目錄的排版與檢查工具：

```powershell
npm install
```

只有要在本機測試或部署 Cloudflare AI Worker 時，才需要另外安裝 Worker 工具：

```powershell
npm --prefix backend install
```

這兩個指令會產生 `node_modules/`。它們只是可以隨時重新下載的第三方套件，不是專案原始碼，也不會提交到 Git；
目前工作目錄已將它們移除，讓檔案列表保持乾淨。

```powershell
npm start
```

開啟終端機顯示的網址，預設為 `http://127.0.0.1:8787`。首次進入 `login.html` 時設定老師帳號與密碼；帳號資料與 SQLite 資料庫會放在 `frontend/.data/`，此資料夾已被 Git 忽略。

常用指令：

```powershell
npm run dev    # 監看 server 檔案並重新啟動本機網站
npm run check  # 檢查前端與伺服器 JavaScript／MJS 語法
npm run format # 統一整理 HTML、CSS、JS、MJS、JSON 與 Markdown
npm run lint:layout # 補齊控制流程大括號、函式空行，再執行完整格式化
```

## 網站頁面與檔案安排

目前學生網站以 `index.html` 的 hash 路由顯示原始完整設計，確保首頁、各功能頁、土風水角色、動畫、背景與頁尾維持同一套視覺。`experiments.html`、`quiz.html` 等實體檔名仍是各功能的公開入口；開啟後會立即導向 `index.html#功能名稱`，因此舊書籤和清楚的頁面檔名都可繼續使用，也不會再顯示拆頁期間的簡化版面。

目前實際執行的前台檔案如下：

| 檔案 | 目前主要用途 |
| --- | --- |
| `index.html` | 保存已恢復的首頁、所有學生功能容器、土風水角色、測驗場景、共用頁首和完整頁尾。 |
| `app.js` | 切換 `#home`、`#experiments`、`#quiz` 等功能，更新標題、選單狀態及首頁打字效果。 |
| `pages.js` | 載入首頁與關於我們內容，建立活動／科普／榮譽等介紹頁，並控制各功能頁的引導人物與對話。 |
| `experiments.js` | 載入、搜尋及播放實驗影片。 |
| `learning.js` | 載入教材與題庫，控制三位探險角色、選題地圖、作答、評分、動畫和結果回顧。 |
| `ai.js` | 控制教材問答及測驗／遊戲中的浮動 AI 助教。 |
| `styles.css`、`pages.css`、`learning.css`、`quiz-friends.css`、`ai.css` | 依序提供全站基礎、介紹頁、學習頁、知識小學堂角色／地圖動畫及 AI 對話外觀。 |

下表記錄每個實體頁面檔及其拆分控制器原本負責的功能，方便日後逐頁移植。移植一頁時，必須先把 `index.html` 中該頁的完整 DOM、動畫與響應式樣式一起移入並做視覺比對，不能直接啟用目前的簡化骨架。

| 頁面 | 三個對應檔案 | HTML 保留的畫面骨架 | JavaScript 實際工作與資料來源 | 維護時應修改的位置 |
| --- | --- | --- | --- | --- |
| 首頁 | `index.html`、`index-page.js`、`index.css` | 計畫標題、功能卡、各功能頁連結、首頁裝飾與公開頁尾。 | `index-page.js` 載入共用導覽標示；目前不讀取 API，未來首頁互動、公告摘要或動畫都集中於此。 | 改首頁文案、卡片順序或連結：`index.html`；新增首頁互動：`index-page.js`；新增首頁外觀：`index.css`。 |
| 實驗影片 | `experiments.html`、`experiments.js`、`experiments.css` | 搜尋框、影片數量、影片卡片容器、播放對話框與重試提示。 | 呼叫公開 `/api/videos`，只顯示已發布影片；以關鍵字篩選，將 Drive 預覽網址放進播放器，嵌入失敗時保留外開連結。 | 改影片欄位、發布規則或封面：後台與 `management.mjs`；改卡片互動：`experiments.js`；改外觀：`experiments.css`。 |
| 教材下載 | `resources.html`、`resources-page.js`、`resources.css` | 教材說明、狀態文字、教材列表與重新載入按鈕。 | 呼叫 `/api/resources`，用 DOM 建立標題、主題、章節與安全的外部下載連結；處理空清單、載入中與錯誤。 | 改教材資料或發布狀態：後台／`management.mjs`；改下載卡片內容：`resources-page.js`；改樣式：`resources.css`。 |
| 知識小學堂 | `quiz.html`、`quiz-page.js`、`quiz.css` | 主題、題型、難度與題數設定表單；題目、選項、送出、下一題和解析區。 | 先讀取 `/api/quiz/catalog`，再要求題目與送出答案評分。正確答案不會先送進瀏覽器，解析只在作答後顯示。 | 改題目或答案：後台／`questions.json`；改作答流程：`quiz-page.js`；改題目畫面：`quiz.css`。 |
| AI 問答 | `ai-qa.html`、`ai-qa-page.js`、`ai-qa.css` | 對話紀錄區、問題輸入框、送出按鈕、服務狀態與教材來源區。 | 送出問題至 `/api/ai/qa`，保存本頁暫時對話代號並將回答和引用來源安全地建立為 DOM。前端沒有 AI 權杖或教材全文。 | 改聊天體驗：`ai-qa-page.js`／`ai-qa.css`；改回答規則或教材索引：`ai.mjs`、`ai-store.mjs`、`backend/src/index.js`。 |
| 活動紀錄 | `activities.html`、`activities-page.js`、`activities.css` | 活動標題、內容容器與公開頁尾。 | 呼叫 `/api/updates`，只顯示已發布活動，建立日期、描述及成果連結；資料為空或失敗時顯示對應訊息。 | 新增或下架活動：老師後台；改活動卡片欄位：`activities-page.js`；改視覺：`activities.css`。 |
| 關於我們 | `about.html`、`about-page.js`、`about.css` | 公開導覽、可被動態填入的內容容器與頁尾。 | 呼叫 `/api/pages/about` 讀取後台儲存的結構化章節；依版型建立標題、段落、清單與連結，避免將老師輸入直接當 HTML。 | 改介紹文字：後台頁面編輯器；新增內容版型：`pages.mjs`、`about-page.js`、`pages.css`；改專屬外觀：`about.css`。 |
| 科普知識 | `knowledge.html`、`knowledge-page.js`、`knowledge.css` | 已準備標題、內容容器與頁尾，供未來文章清單與搜尋介面使用。 | 目前只建立「尚未發布內容」的安全提示；日後文章 API、分類、搜尋、分頁只加入這三個同名頁面檔案與需要的 Server 模組。 | 新增此功能時，不需修改其他頁；在 `knowledge-page.js` 加載資料，在 `knowledge.css` 加專屬卡片與篩選樣式。 |
| 榮譽榜 | `honors.html`、`honors-page.js`、`honors.css` | 已準備內容容器與公開頁尾，供未來成果、學生名單與篩選使用。 | 目前只顯示安全的預告訊息，不連接資料庫；將來可在此入口加入年度、類型或成果分類。 | 真正有資料需求後才新增專用 API 與資料表；畫面、篩選與卡片維持在 `honors-*` 三個檔案。 |
| 互動小遊戲 | `games.html`、`games-page.js`、`games.css` | 已準備遊戲入口、內容容器與頁尾。 | 目前只顯示預告訊息；未來關卡狀態、計時、得分及操作事件只會放在 `games-page.js`，不會塞回首頁。 | 每種大型遊戲可再建自己的子模組或資料夾；共用外框留在 `games.css`，機密答案與評分仍交由 Server。 |
| 老師登入 | `login.html`、`login.js`、`login.css` | 首次設定與登入表單、帳號密碼欄位、說明與錯誤訊息容器。 | 先查詢登入狀態，依是否已有帳號切換首次設定或登入；送出帳密至 Server，成功後導向後台。密碼只走 HTTPS／Server，不存入瀏覽器。 | 改登入規則、Cookie 或密碼處理：`server.mjs`；改表單檢查：`login.js`；改登入畫面：`login.css`。 |
| 老師後台 | `admin.html`、`admin.js`、`admin.css` | 後台側欄、主內容區、內容編輯對話框、題目預覽與 JSON 匯入表單。 | 讀取登入狀態和管理 API，處理列表、搜尋、篩選、分頁、新增、編輯、刪除、匯入匯出及 AI 教材索引狀態。每次寫入都會送 revision 防止覆蓋別人的更新。 | 新增可管理項目通常要同步改 `admin.js`、對應 Server 模組、資料庫結構和 README；改後台版面只改 `admin.css`。 |

除 `index.html`、`login.html` 與 `admin.html` 外，各功能 HTML 目前先作為相容入口。要重新啟用真正的獨立畫面時，請以已恢復的 `index.html#該功能` 為視覺基準，完成桌面、手機、動畫與 API 測試後再移除轉址。

## AI 問答怎麼使用

AI 問答只根據老師發布並完成索引的教材回答。它不是一般網路搜尋，也不會自行補上教材沒有的資訊。

1. 複製 `ai.env.example` 為 `.env`，填入 AI Worker 服務網址與權杖。`.env` 不可提交到 Git。
2. 啟動本機網站並登入老師後台。
3. 在「教材管理」建立或編輯教材，填入完整教材文字並發布。系統會把文字切成小段，上傳向量索引。
4. 等待索引狀態為「完成」後，學生才可從 `ai-qa.html` 提問。回答會附上實際使用的教材連結與引用原文。

AI 流程的設計原則：

- **密鑰只在伺服器端：** 瀏覽器只呼叫 `/api/ai/qa`；`AI_SERVICE_TOKEN` 不會送到前端。
- **先搜尋、再回答、再查核：** 伺服器從已發布教材找片段，要求模型逐句附原文證據，再做一次事實查核。
- **教材不足時明確拒答：** 沒有足夠證據時會提示學生換個問法或請老師補充教材。
- **題目助教不洩答：** 測驗與遊戲中的 AI 助教只能給小提示，伺服器會拒絕直接答案、正確選項或完整解法。
- **保護學生隱私：** 問答介面不要求姓名；對話識別碼只保留在伺服器記憶體中，30 分鐘後過期，重新整理頁面也會清除前端對話。

> 若沒有設定 AI 環境變數，其他網站功能仍可正常使用；AI 問答會顯示服務尚未設定。

## 目錄與檔案說明

以下列出專案需要維護的原始碼、內容及設定檔。原始主視覺目前由 `index.html` 的 hash 路由提供；各功能頁的
獨立 HTML／JS／CSS 檔仍保留作為命名清楚的入口與後續移植位置。現在開啟獨立 HTML 會先回到對應 hash 頁，
所以學生只會看到已恢復的完整版本。

```text
.
├── package.json                    根目錄指令，統一啟動與檢查 frontend
├── ai.env.example                  AI 本機環境變數範例，不能放真實權杖
├── .env                            本機私密設定，已忽略，不應提交
├── .gitignore                      忽略套件、資料庫、帳號與環境變數
├── README.md                       專案使用、AI 設計與維護文件
├── frontend/
│   ├── package.json                前台伺服器指令與完整語法檢查清單
│   ├── server/
│   │   ├── server.mjs              HTTP 入口、登入、API 分派、靜態檔白名單與安全標頭
│   │   ├── database.mjs            SQLite 初始化及影片、教材、題庫、活動的資料存取
│   │   ├── management.mjs          後台內容驗證、版本控制與可管理項目的規則
│   │   ├── learning.mjs            題庫與遊戲任務的初始內容資料
│   │   ├── pages.mjs               首頁與關於我們的初始編輯內容資料
│   │   ├── ai-store.mjs            AI 教材、文字切塊、索引狀態與向量結果驗證
│   │   └── ai.mjs                  AI Worker 呼叫、檢索問答、證據查核與助教防洩答流程
│   ├── database/
│   │   ├── schema.sql              SQLite 資料表與索引定義
│   │   ├── videos.json             初始實驗影片資料
│   │   ├── resources.json          初始教材下載資料
│   │   ├── questions.json          初始題庫資料
│   │   └── pages.json              初始首頁／關於我們內容
│   ├── public/
│       ├── index.html              原始完整學生網站；包含首頁、功能頁容器、角色、共同頁尾與 hash 路由
│       ├── experiments.html        實驗影片的獨立頁面
│       ├── resources.html          教材下載的獨立頁面
│       ├── quiz.html               知識小學堂的獨立頁面
│       ├── ai-qa.html              AI 教材問答的獨立頁面
│       ├── activities.html         活動紀錄的獨立頁面
│       ├── about.html              關於我們的獨立頁面
│       ├── knowledge.html          科普知識的獨立頁面
│       ├── honors.html             榮譽榜的獨立頁面
│       ├── games.html              互動小遊戲的獨立頁面
│       ├── login.html              老師登入／首次設定頁面
│       ├── admin.html              需登入的老師管理頁面
│       └── assets/
│           ├── css/
│           │   ├── <頁面>.css      每個 HTML 直接載入的同名頁面入口
│           │   ├── styles.css      頁面入口匯入的基礎視覺元件
│           │   ├── page-shell.css  頁面入口匯入的共用頁首、導覽與頁尾
│           │   ├── learning.css    教材、題庫與影片共用元件
│           │   ├── pages.css       首頁與介紹頁共用內容元件
│           │   └── ai.css          AI 對話共用元件
│           ├── js/
│           │   ├── shared/         導覽與安全 DOM 建立等無頁面狀態工具
│           │   ├── index-page.js   首頁入口
│           │   ├── app.js          原始完整網站的 hash 路由、選單與首頁打字效果
│           │   ├── pages.js        原始介紹內容、九頁場景背景及土風水角色互動
│           │   ├── learning.js     原始教材下載、冒險選題、作答、解析及結果回顧
│           │   ├── ai.js           原始 AI 問答頁與測驗中的浮動助教
│           │   ├── experiments.js  影片清單、搜尋與播放器
│           │   ├── resources-page.js 教材下載頁資料載入與卡片建立
│           │   ├── quiz-page.js    獨立小學堂的出題、作答與解析流程
│           │   ├── ai-qa-page.js   獨立 AI 問答頁的對話與來源呈現
│           │   ├── about-page.js   關於我們內容載入
│           │   ├── activities-page.js 活動資料載入
│           │   ├── knowledge-page.js 科普知識入口
│           │   ├── honors-page.js  榮譽榜入口
│           │   ├── games-page.js   互動遊戲入口
│           │   ├── login.js        登入與首次帳號設定流程
│           │   └── admin.js        後台清單、編輯器、匯入與 AI 教材管理
│           └── images/             靜態插圖、九頁角色場景、小學堂背景與實驗影片封面
│   └── scripts/
│       └── generate-page-scenes.mjs  重新產生九張功能頁 SVG 場景
└── backend/
    ├── package.json                Cloudflare Worker 開發、部署與檢查指令
    ├── package-lock.json           Worker 開發依賴的鎖定版本，安裝時應一併保留
    ├── wrangler.jsonc              原 AI Worker、向量索引與環境綁定設定
    ├── wrangler.site.jsonc         正式整站 Worker：靜態資產、D1、AI、Vectorize 綁定
    ├── ai-secrets.example          Worker 所需機密資料範例
    ├── migrations/                 可重複執行的 D1 資料表遷移，依檔名順序套用
    ├── scripts/                    僅在遷移時使用的本機 SQLite／帳號匯出工具
    └── src/
        ├── index.js                原 AI Worker：向量新增、刪除、查詢與模型呼叫
        ├── site-worker.js          現行 Cloudflare 整站入口與 API 路由
        ├── d1-public.js            學生公開資料的 D1 讀取層
        ├── d1-auth.js              老師登入、session 與權限檢查
        ├── d1-admin.js             老師後台的 D1 清單與內容管理規則
        └── d1-ai.js                Vectorize 搜尋結果的 D1 教材驗證層
```

### 註解與資料檔的約定

每個會被執行或解讀的原始碼、樣式、SQL、部署設定與工作流程檔，都在檔案開頭註明「主要功能」與它不應承擔的責任；這是讓維護者能快速判斷應修改哪裡的第一層說明。JSON、`package-lock.json` 與圖片／SVG 資產不能任意插入註解，否則會破壞資料格式、套件校驗或瀏覽器載入；這些檔案的逐檔用途改由本 README 的表格記錄。換言之，程式內註解說明執行責任與安全邊界，README 說明所有檔案（含不可加註解的資料與資產）的維護用途。

### 根目錄與開發設定檔

| 檔案 | 主要用途 | 什麼情況會碰到它 |
| --- | --- | --- |
| `README.md` | 專案的使用說明書：告訴維護者網站怎麼啟動、每個檔案做什麼、AI 怎麼使用，以及資料放在哪裡。 | 新增功能、檔案、設定或部署步驟後，要把新用途補進來。 |
| `package.json` | 根目錄的「快捷指令清單」；`npm start`、排版、語法檢查都從這裡開始。它本身不是網站畫面或功能程式。 | 想新增全專案共用的指令時修改。 |
| `package-lock.json` | 記錄排版與檢查工具的精確版本，讓不同電腦安裝到相同工具。 | 只有執行 `npm install` 更新工具時才會跟著改。 |
| `.prettierrc.json` | 決定程式碼的外觀：縮排、空行、引號、行寬與大括號格式。 | 想統一調整全專案排版標準時修改。 |
| `.prettierignore` | 指出哪些產生檔、資料檔或套件不需要被自動排版。 | 新增不應被 Prettier 改寫的產物時加入。 |
| `eslint.config.mjs` | 檢查 JavaScript 是否有缺少大括號、函式黏在一起等可讀性問題。 | 想新增或調整程式碼品質規則時修改。 |
| `.gitignore` | 防止密鑰、帳號資料、SQLite 資料庫、老師上傳檔與套件資料夾被提交。 | 新增本機私密資料或執行時產生的資料夾時修改。 |
| `ai.env.example` | 提供 `.env` 的 AI 連線欄位範例；讓新電腦知道要填哪些設定。 | 建立本機 AI 連線時複製成 `.env`；範例內永遠不放真的權杖。 |

### `frontend/server/`：網站伺服器與資料規則

如果熟悉 Flask，可以把這個資料夾理解成 Flask 專案中的 Python 後端。`server.mjs` 相當於建立 Flask app
與註冊 route 的主程式，其他 `.mjs` 則相當於依功能拆開的 service、資料驗證與資料庫模組。瀏覽器不能直接讀
SQLite、驗證密碼或保存 AI 密鑰，所以網站仍需要這一層；它不是第二套前端頁面。

| 檔案 | 主要用途 | 網站中何時會用到 |
| --- | --- | --- |
| `server.mjs` | 整個網站的總接待員。它接收瀏覽器網址與 API 請求，提供 HTML／CSS／JS，處理登入、Cookie、權限檢查和把工作轉交給其他 Server 檔案。 | 每次開啟網頁、登入、學生讀取資料、老師在後台按儲存、學生提問 AI 時，都會先經過它。 |
| `database.mjs` | 資料庫的開門與組裝中心。它建立 SQLite、讀取初始 JSON、補上舊資料欄位，然後把影片、教材、題庫、活動、介紹頁與 AI 教材的方法整理成一個可使用的資料庫物件。 | 網站啟動時執行一次；之後每個需要讀寫資料的 API 都間接使用它。 |
| `management.mjs` | 後台「內容管理」的規則中心。它管理影片、教材、活動和題目的新增、修改、刪除、發布／下架、排序、Drive 連結格式與版本衝突。 | 老師後台管理影片、教材、活動或題庫時使用；學生頁只會看到它已允許發布的內容。 |
| `learning.mjs` | 學習資料的保護層。它匯入教材與題庫，列出教材、提供可作答的題目，並在學生送出答案後才判分與回傳解析。 | 教材下載頁與知識小學堂使用。最重要的用途是讓正確答案不會提早送到學生瀏覽器。 |
| `pages.mjs` | 介紹型內容的管理規則。它保存首頁的固定內容，並讓「關於我們」用章節、段落、清單等結構化方式由後台編輯。 | 開啟關於我們頁或老師在後台儲存介紹內容時使用。 |
| `ai-store.mjs` | AI 教材庫管理員。它保存教材全文、將長文切成可搜尋的段落、記錄索引是否成功，並判斷搜尋到的舊片段還能不能引用。 | 老師建立或修改可供 AI 使用的教材，以及學生送出 AI 問題前後使用。 |
| `ai.mjs` | AI 問答流程控制器。它把教材片段送給 AI Worker 搜尋與回答，檢查回答是否有教材證據，並阻擋直接洩漏測驗答案的請求。 | 學生使用 AI 問答、老師同步 AI 教材，或未來遊戲需要 AI 提示時使用。 |

這些檔案依責任拆開，是為了避免 `server.mjs` 變成同時包含登入、SQL、題庫和 AI 提示詞的巨大檔案：

- `server.mjs` 決定某個網址要交給哪個功能處理。
- `database.mjs` 開啟 SQLite，並把各資料模組提供的方法組合起來。
- `management.mjs`、`learning.mjs`、`pages.mjs` 分別管理後台內容、學習內容與介紹頁。
- `ai-store.mjs` 管 AI 教材資料，`ai.mjs` 管 AI 服務流程，避免資料庫規則和模型提示詞混在一起。

Server 檔案不強制和 HTML 一對一，因為它們保護的是資料責任；同一份資料可能同時提供學生頁與老師後台：

| 功能頁                 | 使用的 API         | 實際資料模組                     | 為何共用                                                     |
| ---------------------- | ------------------ | -------------------------------- | ------------------------------------------------------------ |
| 實驗影片               | `/api/videos`      | `management.mjs`、`database.mjs` | 學生讀取已發布影片，老師後台編輯同一批影片。                 |
| 教材下載               | `/api/resources`   | `learning.mjs`、`management.mjs` | 公開下載資料和老師後台管理資料來自同一張表。                 |
| 知識小學堂             | `/api/quiz/*`      | `learning.mjs`                   | 取題和評分必須在同一模組維持「公開題目、不公開答案」的邊界。 |
| 活動紀錄               | `/api/updates`     | `management.mjs`                 | 學生只看已發布活動，老師可以新增、修改及下架。               |
| 關於我們               | `/api/pages/about` | `pages.mjs`                      | 前台顯示和後台編輯共用版型驗證與 revision。                  |
| AI 問答                | `/api/ai/qa`       | `ai.mjs`、`ai-store.mjs`         | 一個負責問答流程，一個負責教材與索引狀態。                   |
| 科普知識、榮譽榜、遊戲 | 目前沒有 API       | 目前不需要 Server 功能檔         | 日後真正需要動態資料時再新增模組，避免先建立空檔案。         |

若將 Server 也硬拆成每頁一份，登入、發布狀態、SQL 和驗證會在多個檔案重複，修改規則時容易漏改。公開頁採
「一頁一入口」，Server 採「一種資料責任一模組」，兩邊使用不同拆分原則會更容易維護。

網站主要請求關係如下：

```text
瀏覽器 HTML／JS
    ↓ 呼叫 /api/*
frontend/server/server.mjs
    ↓ 驗證登入、輸入與公開狀態
management.mjs／learning.mjs／pages.mjs／ai-store.mjs
    ↓
SQLite（frontend/.data/site.sqlite）

需要 AI 時：server.mjs → ai.mjs → Cloudflare Worker → Workers AI／Vectorize
```

### `frontend/database/`：第一次啟動使用的種子資料

| 檔案 | 主要用途 | 內容何時會生效 |
| --- | --- | --- |
| `schema.sql` | SQLite 的資料表藍圖。它定義影片、教材、題庫、活動、介紹頁、AI 教材與索引紀錄要有哪些欄位、唯一值限制與查詢索引。 | 新建資料庫時使用；既有資料庫加欄位時，還要同步在 `database.mjs` 或對應模組撰寫遷移。 |
| `videos.json` | 初次建立網站時的實驗影片清單，包含 Google Drive 檔案 ID、影片名稱、格式、檔案大小與來源資料夾。 | 只在資料庫內沒有同 ID 影片時補入，不會蓋掉老師在後台修改過的內容。每個 ID 對應同名 JPG 封面。 |
| `resources.json` | 初次建立網站時的教材下載清單，包含教材名稱、Google Drive 資料夾連結、簡介與章節名稱。 | 只供第一次匯入或補漏資料；學生看到的是資料庫中已發布的教材。這裡的教材不會自動變成 AI 知識來源。 |
| `questions.json` | 初次建立網站時的題庫，包含題目、選項、正確答案、解析、出題依據、來源、主題、題型與難度。 | 啟動時匯入缺少的題號；答案存在 Server 資料庫內，不能複製進 HTML 或前端 JS。 |
| `pages.json` | 首頁與關於我們的初始文章內容，以章節、標題、段落、數字與清單描述，而不是把整段 HTML 存進資料庫。 | 新資料庫建立時使用；後台編輯後以 SQLite 的版本為準，通常不會再由此檔覆蓋。 |

這四個 JSON 不是重複設定，而是四種可直接編輯的初始內容，作用類似 Flask 專案的 seed／fixture。第一次建立
`frontend/.data/site.sqlite` 時，Server 會把它們匯入 SQLite；之後老師從後台修改的是 SQLite，不會反寫 JSON。
將題庫、影片、教材與頁面拆開，可避免修改大量題目時誤動到首頁或影片資料。原本空白且沒有功能使用的
`game-tasks.json` 已移除。

### `frontend/public/assets/js/`：瀏覽器互動程式

`app.js`、`pages.js`、`experiments.js`、`learning.js`、`ai.js` 是目前完整學生網站實際執行的控制器。下表中的
`*-page.js` 是已命名的拆頁版本，暫時不會在學生入口執行；保留它們是為了日後逐頁移植時有清楚的責任邊界。

| 檔案 | 主要用途 | 使用的頁面 |
| --- | --- | --- |
| `index-page.js` | 首頁的唯一互動入口。目前負責讓共用導覽知道目前是首頁；日後首頁輪播、公告、動畫或小互動都放這裡。 | `index.html` |
| `experiments.js` | 影片頁的完整控制器：向 Server 取得公開影片、依搜尋字篩選、建立影片卡片、顯示數量、開關播放器，並提供 Google Drive 外開備案。 | `experiments.html` |
| `resources-page.js` | 教材下載頁的資料載入器：取得已發布教材，建立教材名稱、章節、說明、下載連結，以及載入失敗或沒有資料時的提示。 | `resources.html` |
| `quiz-page.js` | 小學堂的互動流程：取得可選主題、題型與難度，開始本次題組、顯示選項、送出答案、顯示正誤和解析，再前往下一題。 | `quiz.html` |
| `ai-qa-page.js` | AI 聊天介面：收集學生問題、顯示等待狀態、送往 Server、把回答與教材來源顯示在對話紀錄中。它不保存權杖或答案。 | `ai-qa.html` |
| `activities-page.js` | 活動紀錄載入器：取得公開活動，建立活動日期、標題、簡介與成果連結；也處理載入、空清單與錯誤訊息。 | `activities.html` |
| `about-page.js` | 關於我們頁的內容渲染器：向 Server 取得後台編輯的章節資料，再轉為學生可閱讀的標題、段落、數字與清單。 | `about.html` |
| `knowledge-page.js` | 科普知識的獨立起點。目前顯示準備中的介紹；未來文章列表、文章內容、分類與搜尋只擴充這個檔案。 | `knowledge.html` |
| `honors-page.js` | 榮譽榜的獨立起點。目前顯示預告；未來學生名單、作品成果、年度與分類篩選只擴充這個檔案。 | `honors.html` |
| `games-page.js` | 遊戲的獨立起點。目前顯示預告；未來關卡、操作、計時、得分與進度只寫在這個檔案或它的遊戲子模組。 | `games.html` |
| `login.js` | 老師帳號入口：確認是否首次設定、檢查兩次密碼是否一致、送出建立帳號或登入請求，成功後轉往後台。 | `login.html` |
| `admin.js` | 老師後台的主要操作程式：切換管理分頁、讀取列表、搜尋與篩選、開啟編輯器、儲存、刪除、匯入匯出、預覽題目與管理 AI 教材。 | `admin.html` |
| `shared/site-shell.js` | 公開頁共用的小工具，只負責標示導覽列的目前頁面，讓讀者與讀屏軟體知道自己在哪一頁。 | 所有公開頁的頁面 JS 入口匯入。 |
| `shared/content-renderer.js` | 介紹型頁面共用的安全畫面工具：取得內容容器、以 `textContent` 建立文字、顯示訊息和設定載入狀態。 | `about`、`activities`、`knowledge`、`honors`、`games` 頁的 JS 入口匯入。 |

拆頁控制器使用 ES Module `import` 取得 `shared/` 工具。日後啟用時仍維持一頁一個入口，同時避免把相同的導覽與安全 DOM 程式複製多份。

### `frontend/public/assets/css/`：畫面樣式

目前完整畫面直接載入 `styles.css`、`learning.css`、`quiz-friends.css`、`pages.css` 與 `ai.css`。`index.css` 與各功能同名 CSS 是拆頁入口，暫時不會取代原始完整樣式。

| CSS 檔案 | 主要用途 | 套用在哪裡 |
| --- | --- | --- |
| `index.css` | 首頁專屬樣式入口；集中首頁首屏、功能卡、介紹段落和首頁裝飾未來的調整。 | `index.html` |
| `experiments.css` | 實驗影片頁專屬樣式入口；負責搜尋列、影片卡片網格、播放器對話框和載入提示的外觀。 | `experiments.html` |
| `resources.css` | 教材下載頁專屬樣式入口；負責教材清單、章節文字、下載連結與狀態訊息。 | `resources.html` |
| `quiz.css` | 小學堂專屬樣式入口；負責設定表單、題目面板、選項按鈕、正誤回饋與結果區。 | `quiz.html` |
| `ai-qa.css` | AI 問答頁專屬樣式入口；負責聊天區、學生與 AI 訊息、引用來源、輸入表單與等待狀態。 | `ai-qa.html` |
| `activities.css` | 活動紀錄頁專屬樣式入口；未來活動卡片、日期、成果按鈕和列表間距都放這裡。 | `activities.html` |
| `about.css` | 關於我們頁專屬樣式入口；負責計畫章節、團隊、合作單位、成果數字與聯絡資訊的調整。 | `about.html` |
| `knowledge.css` | 科普知識頁專屬樣式入口；未來文章卡、分類標籤、搜尋列與閱讀頁樣式都放這裡。 | `knowledge.html` |
| `honors.css` | 榮譽榜專屬樣式入口；未來名單卡、作品圖片、年度選擇與篩選區都放這裡。 | `honors.html` |
| `games.css` | 遊戲頁專屬樣式入口；未來選關、遊戲畫面、分數、倒數與操作按鈕都放這裡。 | `games.html` |
| `login.css` | 老師登入頁專屬樣式；控制登入卡片、首次設定表單、說明文字與錯誤訊息。 | `login.html` |
| `admin.css` | 老師後台完整樣式；控制側欄、統計區、表格、搜尋篩選列、編輯對話框與手機版版面。 | `admin.html` |
| `styles.css` | 全網站的基礎外觀元件；定義字體、顏色變數、按鈕、連結、可及性焦點與常用排版。它不放任何單一頁面的特殊設計。 | 由各公開頁 CSS 入口匯入。 |
| `page-shell.css` | 公開頁共用外框；定義頁首、導覽列、內容最大寬度、底色與 `.page-footer` 頁尾。 | 由公開頁 CSS 入口匯入。 |
| `learning.css` | 學習功能共用外觀；放影片卡片、教材清單、小學堂題目與狀態面板等跨學習頁共用元件。 | 由首頁、影片、教材與小學堂 CSS 入口匯入。 |
| `pages.css` | 首頁與介紹型頁面共用外觀；放文章章節、數字成果、卡片、插圖場景與響應式排版。 | 由首頁、活動、關於我們、科普、榮譽與遊戲 CSS 入口匯入。 |
| `ai.css` | AI 聊天元件的共用外觀；放對話泡泡、來源引用、輸入區與等待狀態。 | 由 `ai-qa.css` 匯入。 |

共用元件檔不由 HTML 直接載入：`styles.css` 放基礎色彩和通用元件，`page-shell.css` 放公開頁的頁首、導覽、內容
寬度與頁尾，`learning.css` 放影片／教材／題庫元件，`pages.css` 放首頁及介紹內容元件，`ai.css` 放對話元件。
頁面只修改自己的入口檔；確定多頁都需要的規則，才移到共用元件檔。

### 頁尾放在哪裡

- 原始完整網站的頁尾位於 `index.html` 最下方的 `<footer class="site-footer">`，外觀在 `styles.css`。
- 各功能 HTML 目前會導向 `index.html#功能名稱`，所以學生實際看到的是上面的 `.site-footer`。
- 各獨立 HTML 內仍保留未來拆頁可使用的 `<footer class="page-footer">`；其共用外觀位於 `assets/css/page-shell.css`。
- 老師後台使用 `admin.html` 的 `<footer class="workspace-footer">`，樣式在 `admin.css`。
- 登入頁目前沒有頁尾；若未來需要，應在 `login.html` 加入結構並在 `login.css` 加入專屬樣式。

### 圖片與場景檔案

| 路徑或檔案 | 主要用途 | 使用位置與命名方式 |
| --- | --- | --- |
| `assets/images/experiments/1DRnZt8rmmuOBFnWg0iiNH_RYHC8TPlZL.jpg` | 「柏努力方程式簡單介紹」影片的本機封面。 | `experiments.js` 以 Drive ID 對應此檔，顯示在影片卡片上。 |
| `assets/images/experiments/17wadmL4vVQqVJxwO9LkKLtsoOg-Zv1vv.jpg` | 「柏努力方程式 v2」影片的本機封面。 | 檔名是 Drive ID；換影片 ID 時要新增或改成對應的新 ID。 |
| `assets/images/experiments/1ZBLo4Uyd058msT3qKS64Wi7CbeMMxhZ2.jpg` | 「吹紙條、鋁罐」影片的本機封面。 | 由影片卡片在播放前顯示。 |
| `assets/images/experiments/1gZHrCvRAselcHBULGCesGN-BFHpoPnvy.jpg` | 「吹垃圾袋」影片的本機封面。 | 由影片卡片在播放前顯示。 |
| `assets/images/experiments/145JCYy3E9gSfgCLmBPLA0RBjXCkBWT4S.jpg` | 「吹風機吹乒乓球」影片的本機封面。 | 由影片卡片在播放前顯示。 |
| `assets/images/experiments/1TuAt9DwyR29AlIinBpCb0dRIc3VhJvzq.jpg` | 「吸塵器」影片的本機封面。 | 由影片卡片在播放前顯示。 |
| `assets/images/experiments/1mXoC6xlKfzht4mAo8FbdUh6liFFBBWtL.jpg` | 「長短噴嘴」影片的本機封面。 | 由影片卡片在播放前顯示。 |
| `assets/images/experiments/1DNqOPU6a_ba8JuuzAFFu5-E9X3418UKI.jpg` | 「表面張力」影片的本機封面。 | 由影片卡片在播放前顯示。 |
| `assets/images/experiments/14AjsIEw_tSzXvzylOjEECKlDTUf3zRbD.jpg` | 「虹吸現象」影片的本機封面。 | 由影片卡片在播放前顯示。 |
| `assets/images/quiz-wave.svg` | 首頁的水波裝飾，不含功能或文字資料。 | 由 `pages.css` 作為背景／裝飾使用；可替換圖案，但應保留 SVG 的 `viewBox`。 |
| `assets/images/quiz-camp.svg` | 首頁的科普旅程營地插圖，用於增加主題感。 | 由首頁相關樣式使用；不應承載只有圖片才看得到的重要文字。 |
| `assets/images/quiz-sky.svg` | 首頁天空背景裝飾。 | 由首頁相關樣式使用；替換時應維持可在不同螢幕寬度縮放的向量圖格式。 |
| `assets/images/quiz-map-texture.svg` | 知識小學堂的探險地圖底紋、河流與虛線路徑。 | `quiz-friends.css` 在選題區載入；移除後小學堂會只剩單色背景。 |
| `assets/images/page-scenes/*.svg` | 九個功能頁各自的上方場景插圖，例如影片螢幕、教材書本、相機、獎盃、燈泡、題本、遊戲手把、AI 機器人及關於我們夥伴。 | `pages.js` 依目前 hash 頁面設定圖片；檔名必須與 `experiments`、`resources`、`activities`、`honors`、`knowledge`、`quiz`、`games`、`ai-qa`、`about` 完全一致。 |
| `frontend/scripts/generate-page-scenes.mjs` | 用固定 SVG 圖形重新產生上述九張場景，確保配色、尺寸和風格一致。 | 場景檔遺失或要整批重建時，在根目錄執行 `node frontend/scripts/generate-page-scenes.mjs`。 |

`page-scenes/` 和 `quiz-map-texture.svg` 都是目前原始版型會直接載入的必要檔案；同時必須列在
`frontend/server/server.mjs` 的公開檔案白名單，否則瀏覽器會收到 404，造成背景和人物場景看似消失。

### 平常要改哪裡

不需要每次都理解或修改全部檔案，可以依需求從下面的位置開始：

| 想做的事情                             | 主要修改位置                                     | 其他可能需要同步的位置                                                   |
| -------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------ |
| 改某個頁面的文字骨架                   | 對應的 `frontend/public/<頁面>.html`             | 若內容來自 API，改對應的頁面 JS 或 Server 模組。                         |
| 改某個頁面的互動                       | 該頁載入的 `assets/js/*-page.js`                 | 新增公開 API 時才需要修改 `server.mjs`。                                 |
| 改某個頁面的外觀                       | 對應的 `assets/css/<頁面>.css`                   | 只有確定多頁共用的規則，才移入 `learning.css`、`pages.css` 或 `ai.css`。 |
| 改共用頁首、導覽、內容寬度或公開頁頁尾 | `assets/css/page-shell.css`                      | 結構位於每個公開頁 HTML 的 `<header>` 或 `<footer>`。                    |
| 改影片、教材、題庫或活動管理           | `server/management.mjs`、`server/learning.mjs`   | 後台欄位也要在 `assets/js/admin.js` 顯示。                               |
| 改第一次啟動的預設內容                 | `frontend/database/` 中對應的 JSON               | 已存在的 `site.sqlite` 不會被預設資料強制覆蓋。                          |
| 改登入、網址路由或安全限制             | `server/server.mjs`                              | 這是最接近 Flask `app.py` 的檔案。                                       |
| 改 AI 搜尋與回答規則                   | `server/ai.mjs`、`server/ai-store.mjs`           | Worker 模型或 Vectorize 操作才需要改 `backend/src/index.js`。            |
| 部署 AI Worker                         | `backend/wrangler.jsonc`、`backend/src/index.js` | 先在 `backend/` 安裝套件並設定 Wrangler secret。                         |

### `frontend/scripts/` 與 `backend/`

| 檔案 | 主要用途 | 什麼時候會使用 |
| --- | --- | --- |
| `frontend/scripts/check-syntax.mjs` | 自動巡覽前端 JS、Server MJS 與檢查腳本，逐檔確認 JavaScript 語法能被 Node.js 解析。它只檢查語法，不會啟動網站或改資料庫。 | 執行 `npm run check` 時使用；新增程式資料夾後才需要把資料夾名稱加進它的掃描清單。 |
| `frontend/package.json` | 前台網站的指令清單，包含正式啟動、開發時自動重啟和語法檢查。 | 在根目錄執行 `npm start`、`npm run dev` 或 `npm run check` 時會間接使用。 |
| `backend/src/index.js` | Cloudflare AI Worker 的核心。它只接受網站 Server 的內部請求，執行教材段落的向量新增、刪除、搜尋與 AI 模型回答。 | AI 教材同步或學生送出 AI 問答時，`ai.mjs` 呼叫它；瀏覽器不應直接連線。 |
| `backend/wrangler.jsonc` | Cloudflare Worker 的部署設定，指定 Worker 名稱、Workers AI、Vectorize 索引與環境綁定名稱。 | 本機執行 Worker 或部署到 Cloudflare 時使用；不是一般網站啟動所需檔案。 |
| `backend/wrangler.site.jsonc` | 正式網站 Worker 的部署設定；指定公開靜態檔來源、D1、Workers AI 與 Vectorize 綁定，供目前公開網址部署使用。 | 執行 `npx wrangler deploy --config backend/wrangler.site.jsonc` 或 GitHub Actions 自動部署時使用；綁定名稱不可與 Cloudflare 後台資源脫節。 |
| `backend/ai-secrets.example` | Cloudflare Worker 所需私密設定的欄位範例，主要是內部服務權杖名稱。 | 設定正式 Worker 時參考；真實值應透過 Wrangler secret 儲存，不能填進這份範例。 |
| `backend/package.json` | AI Worker 專用的安裝、開發、部署與檢查指令清單。 | 只有開發或部署 Cloudflare AI Worker 時使用。 |
| `backend/package-lock.json` | 固定 Worker 開發套件與 Wrangler 的精確版本，使不同電腦部署工具一致。 | 執行 `npm --prefix backend install` 後可能更新，應與 `backend/package.json` 一起保留。 |
| `backend/migrations/0001_site_schema.sql` | 建立 D1 的公開內容、題庫、教材索引與管理資料表。 | 新建 D1 或核對正式資料結構時使用；已套用的 migration 不應就地修改。 |
| `backend/migrations/0002_teacher_auth.sql` | 補上老師帳號與 session 資料表。 | 讓 Cloudflare 版登入仍可使用既有的雜湊密碼資料；絕不放入明碼密碼。 |
| `backend/migrations/0003_ai_conversations.sql` | 建立短期 AI 對話訊息資料表。 | 讓 Cloudflare 問答可帶入最近對話脈絡；資料讀寫只應透過 Worker。 |
| `backend/scripts/export-local-sqlite-to-d1.mjs` | 將本機 SQLite 內容輸出成 D1 可匯入 SQL。 | 一次性遷移或人工備份用途；不在網站執行與部署時自動呼叫。 |
| `backend/scripts/export-local-account-to-d1.mjs` | 將本機老師帳號的雜湊與 salt 輸出成 D1 匯入資料。 | 僅在帳號遷移時使用；輸出檔必須保留在被 Git 忽略的 `backend/.migration-data/`。 |
| `backend/src/site-worker.js` | 目前公開 Cloudflare 網站的總入口：靜態資產回應、公開 API、登入、後台 API 與 AI 問答路由都由它分派。 | 部署後每一個公開網址請求都會經過此檔；修改路由或跨服務流程時才調整。 |
| `backend/src/d1-public.js` | 只查詢可公開影片、教材、頁面與題庫的資料層。 | 學生頁讀取資料時使用；不能把題目答案、草稿或管理欄位回傳給瀏覽器。 |
| `backend/src/d1-auth.js` | 延用 scrypt 密碼雜湊、建立與驗證 session，並提供老師權限判斷。 | 登入、登出與後台 API 每次請求使用；不得把 token 或雜湊交給前端。 |
| `backend/src/d1-admin.js` | 以欄位白名單處理後台內容列表與修改。 | 老師管理影片、教材、題目與活動時使用；所有寫入都須先完成登入檢查。 |
| `backend/src/d1-ai.js` | 將 Vectorize 回傳的片段 ID 再用 D1 驗證教材是否仍發布、索引是否仍有效。 | AI 回答前使用，避免模型讀到已下架、被更新或不屬於當前教材的內容。 |
| `.github/workflows/deploy-cloudflare.yml` | GitHub Actions 的部署工作流程：安裝依賴、執行語法檢查，再部署 `wrangler.site.jsonc`。 | 推送到 `main` 時執行；GitHub repository 必須先設定 `CLOUDFLARE_API_TOKEN` secret 才能真正自動部署。 |

### 執行後才產生、不應提交的內容

| 路徑 | 主要用途 | 要不要保留／備份 |
| --- | --- | --- |
| `frontend/.data/account.json` | 保存老師帳號名稱、密碼雜湊值與 salt，讓 Server 可以驗證登入而不保存明文密碼。 | 屬於私密資料，不可公開；更換電腦若要保留登入帳號才需要安全移轉。 |
| `frontend/.data/site.sqlite` | 網站正在使用的正式內容資料庫；後台改過的影片、教材、題庫、活動、介紹頁與 AI 教材都在這裡。 | 必須定期備份；刪除後會回到種子資料，老師後台後來新增或修改的內容會遺失。 |
| `frontend/.data/covers/` | 老師在後台上傳的影片封面檔，檔名由 Server 產生以避免覆蓋。 | 要和 `site.sqlite` 一起備份；不需手動改檔名。 |
| `.env` | 本機網站連至 AI Worker 的真實網址與權杖。 | 不可提交、傳給學生或貼進前端程式；新電腦要使用 AI 時自行重新建立。 |
| `node_modules/`、`backend/node_modules/` | npm 下載的第三方套件，協助執行排版工具或 Cloudflare Worker。 | 不需備份、也不需手動修改；刪除後可依 `package-lock.json` 重新安裝。 |
| `.cache/` | 本機媒體處理工具產生的語音辨識模型、影片影格等暫存。網站、前端 Server、Cloudflare Worker 與部署流程都不會讀取它。 | 不需保留或提交；可安全刪除，未來若使用同類工具會自行重新產生。 |
| `backend/.migration-data/` | 遷移腳本輸出的暫時 SQL，其中可能含帳號雜湊等資料。 | 不可提交；完成匯入並確認後可在安全備份政策下移除。 |

## 維護原則

- 新增一個學生功能時，建立 `public/<功能>.html`、`assets/js/<功能>-page.js`，需要專屬外觀再建立同名 CSS；再把公開檔案加入 `server.mjs` 的 `publicFiles` 白名單。語法檢查工具會自動掃描新增的 `.js` 與 `.mjs`。
- 不要把外部連結、老師輸入或 AI 文字用 `innerHTML` 插入頁面；使用 `textContent` 與 DOM 節點建立內容。
- 修改 API 前，先確認資料驗證位於 `server/management.mjs` 或對應資料層；前端只負責呈現與送出使用者操作。
- 程式採用同一行開大括號、函式之間保留空行、每個模組開頭寫明責任與資料邊界。註解說明「為什麼」與安全限制，不重述顯而易見的語法。
