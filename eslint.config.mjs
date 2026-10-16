import js from "@eslint/js";
import tseslint from "typescript-eslint";

export default tseslint.config(
  {
    ignores: [
      "**/node_modules/**",
      "**/.next/**",
      "**/dist/**",
      "packages/db/drizzle/**",
      "**/next-env.d.ts",
      // Deliberately buggy sample projects for provoking agent failures.
      "demo/failure-lab/**",
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
  {
    // Plain Node scripts and config files.
    files: ["**/*.mjs", "**/*.cjs"],
    languageOptions: {
      globals: { process: "readonly", console: "readonly" },
    },
  },
  {
    // Browser-safe packages must not use Node built-ins, so the same code
    // runs in the browser (demo) and in the CLI.
    files: [
      "packages/schema/src/**",
      "packages/adapters/src/**",
      "packages/scrub/src/**",
      "packages/enrich/src/**",
      "packages/pricing/src/**",
      "packages/synth/src/**",
    ],
    ignores: ["**/*.test.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["node:*", "fs", "path", "os", "child_process"],
              message: "Browser-safe package: no Node built-ins.",
            },
          ],
        },
      ],
    },
  },
);
