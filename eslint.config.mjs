/*
 * 專案的補充 lint 規則。Prettier 處理縮排、換行和引號；ESLint 只強制容易造成維護
 * 風險的控制流程大括號、1TBS 大括號風格及函式間留白。規則只套用自行維護的前後端
 * 程式，不套用產生檔、相依套件或 JSON／CSS／HTML。
 */
export default [
  {
    files: ["frontend/**/*.{js,mjs}", "backend/src/**/*.js"],
    rules: {
      curly: ["error", "all"],
      "brace-style": ["error", "1tbs", { allowSingleLine: false }],
      "padding-line-between-statements": [
        "error",
        { blankLine: "always", prev: "function", next: "*" },
        { blankLine: "always", prev: "*", next: "function" },
        { blankLine: "always", prev: "*", next: "return" },
      ],
    },
  },
];
