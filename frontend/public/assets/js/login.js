/*
 * 老師帳號設定與登入畫面。先由 /api/auth/status 決定是首次建立帳號或一般登入，
 * 再將密碼僅隨本站請求交給 Worker 驗證；本檔不保存密碼、不建立 token，也不寫入
 * localStorage。登入憑證由伺服器寫入 HttpOnly Cookie，前端只在成功後導向管理區。
 */
const form = document.getElementById("login-form");
const message = document.getElementById("login-message");
const submit = document.getElementById("login-submit");
let setup = false;

// 已登入便直接前往後台；尚未建立帳號才顯示確認密碼欄位，一般登入不重設帳號。
async function initialize() {
  if (location.protocol === "file:") {
    document.getElementById("login-description").textContent = "請透過網站網址開啟登入頁面。";

    return;
  }
  try {
    const response = await fetch("/api/auth/status", { cache: "no-store" });
    if (!response.ok) {
      throw new Error("Unavailable");
    }
    const status = await response.json();
    if (status.authenticated) {
      location.replace("admin.html");

      return;
    }
    setup = !status.configured;
    if (setup) {
      document.getElementById("login-title").textContent = "設定老師帳號";
      document.getElementById("login-description").textContent =
        "第一次使用，請設定老師帳號與至少 8 個字元的密碼。帳號可使用英文字母、數字及 _ . -。";
      document.getElementById("password").autocomplete = "new-password";
      document.getElementById("confirm-field").hidden = false;
      document.getElementById("confirm-password").required = true;
      submit.textContent = "設定並登入";
    }
    form.hidden = false;
  } catch {
    document.getElementById("login-description").textContent =
      "目前無法連線，請確認網站伺服器已啟動，再重新整理頁面。";
  }
}

form.addEventListener("submit", async (event) => {
  event.preventDefault();
  message.textContent = "";
  const username = document.getElementById("username").value.trim();
  const password = document.getElementById("password").value;
  if (setup && password !== document.getElementById("confirm-password").value) {
    message.textContent = "兩次輸入的密碼不同。";

    return;
  }
  submit.disabled = true;
  try {
    const response = await fetch(setup ? "/api/auth/setup" : "/api/auth/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, password }),
    });
    const result = await response.json();
    if (!response.ok) {
      message.textContent = result.error;

      return;
    }
    location.replace("admin.html");
  } catch {
    message.textContent = "連線失敗，請再試一次。";
  } finally {
    submit.disabled = false;
  }
});
initialize();
