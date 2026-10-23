-- 小教材可附多張圖片；images_json 以 JSON 陣列保存資料，格式為
-- [{"url":"Google Drive 圖片連結","caption":"選填的圖號或圖說"}]。
-- 不將圖片二進位檔存進 D1，避免資料庫空間被大型圖片占用；瀏覽器仍直接向
-- Google Drive 請求圖片。既有 image_url 不移除，程式會把它當作舊版的一張圖片，
-- 因此已建立的教材在 migration 後不須重新編輯也能繼續顯示原本附圖。
ALTER TABLE resource_materials ADD COLUMN images_json TEXT NOT NULL DEFAULT '[]';
