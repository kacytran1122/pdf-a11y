import js from "@eslint/js";
import globals from "globals";
import tseslint from "typescript-eslint";

export default tseslint.config(
  { ignores: ["dist/**", "coverage/**", "site/**", ".bench-*/**", ".baseline-dist/**", "node_modules/**"] },
  js.configs.recommended,
  ...tseslint.configs.strictTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      // The report and facts objects are deliberately plain data, so template
      // interpolation of `string | null` is checked by hand where it happens.
      "@typescript-eslint/restrict-template-expressions": [
        "error",
        { allowNumber: true, allowBoolean: true },
      ],
      "@typescript-eslint/no-non-null-assertion": "off",
      "no-console": ["error", { allow: ["warn"] }],
      eqeqeq: ["error", "always", { null: "ignore" }],
      "prefer-const": "error",
      "no-param-reassign": "error",
      // Raised from the default: the tree walker and the argument dispatcher
      // are flat, linear and fully branch covered, and a lower number would
      // only buy indirection.
      complexity: ["error", 25],
    },
  },
  {
    // Benchmarks and tests are allowed to print and to build deliberately
    // malformed objects.
    files: ["test/**/*.ts", "bench/**/*.mjs"],
    rules: {
      "no-console": "off",
      complexity: "off",
      "@typescript-eslint/no-unsafe-assignment": "off",
      "@typescript-eslint/no-unsafe-member-access": "off",
      "@typescript-eslint/no-unsafe-argument": "off",
    },
  },
  {
    files: ["**/*.mjs", "*.config.ts", "eslint.config.js"],
    ...tseslint.configs.disableTypeChecked,
    languageOptions: {
      ...tseslint.configs.disableTypeChecked.languageOptions,
      globals: { ...globals.node },
      parserOptions: { projectService: false, project: false, program: null },
    },
  },
);
