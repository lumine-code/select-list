const js = require("@eslint/js");
const n = require("eslint-plugin-n");
const globals = require("globals");
const prettier = require("eslint-config-prettier");

// Provided by the editor at runtime rather than by this package's manifest, so
// eslint-plugin-n cannot resolve it.
const runtimeModules = ["lumine"];

module.exports = [
  { ignores: ["node_modules/**", "build/**", "**/fixtures/**"] },
  js.configs.recommended,
  n.configs["flat/recommended-script"],
  {
    settings: {
      n: { version: ">=24.0.0" },
    },
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "commonjs",
      globals: {
        ...globals.node,
        lumine: "readonly",
        // Renders DOM: window, document and the element constructors are part
        // of this library's own runtime, not just its tests.
        ...globals.browser,
      },
    },
    rules: {
      "no-unused-vars": ["error", { varsIgnorePattern: "^_", argsIgnorePattern: "^_" }],
      "n/no-missing-require": ["error", { allowModules: runtimeModules }],
      "n/no-unpublished-require": ["error", { allowModules: runtimeModules }],
      "n/no-extraneous-require": ["error", { allowModules: runtimeModules }],
      // A catch that deliberately swallows is idiomatic here -- `catch {}` with
      // no binding already says the error is unwanted.
      "no-empty": ["error", { allowEmptyCatch: true }],
    },
  },
  {
    // The lint configuration itself requires devDependencies; it never ships.
    files: ["eslint.config.js", "prettier.config.js"],
    rules: {
      "n/no-unpublished-require": "off",
      "n/no-extraneous-require": "off",
    },
  },
  {
    // This library renders DOM, so its suite runs in a browser-like
    // environment and reaches for document, rAF and the element constructors.
    files: ["spec/**", "test/**", "scripts/**", "benchmark/**"],
    languageOptions: {
      globals: {
        ...globals.jasmine,
        ...globals.mocha,
        ...globals.browser,
        lumine: "readonly",
      },
    },
    rules: {
      "n/no-unpublished-require": "off",
      "n/no-extraneous-require": "off",
      "n/no-process-exit": "off",
    },
  },
  // Must be last: turns off any lint rules that would conflict with Prettier.
  prettier,
];
