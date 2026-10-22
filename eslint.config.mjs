// 專案排版規則：所有控制流程都使用大括號，並維持左大括號不換到下一行。
// Prettier 負責縮排與折行；ESLint 補上控制流程大括號和函式間的閱讀空間。
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
