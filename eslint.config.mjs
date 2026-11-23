import { defineConfig, globalIgnores } from "eslint/config";
import js from "@eslint/js";
import tseslint from "typescript-eslint";
import hooks from "eslint-plugin-react-hooks";
import prettier from "eslint-config-prettier";

export default defineConfig([
  globalIgnores([
    "dist/**",
    ".next/**",
    ".open-next/**",
    "**/.wrangler/**",
    "cloudflare-env.d.ts",
    "collector/worker-configuration.d.ts",
    "next-env.d.ts",
    "public/sw.js",
    "test-results/**",
    "playwright-report/**",
  ]),
  {
    files: ["**/*.ts", "**/*.tsx"],
    extends: [js.configs.recommended, ...tseslint.configs.recommended],
    plugins: { "react-hooks": hooks },
    rules: {
      "react-hooks/rules-of-hooks": "error",
      "react-hooks/exhaustive-deps": "warn",
    },
  },
  {
    files: ["src/lib/domain/**/*.ts", "src/lib/contracts/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: [
                "**/client/*",
                "**/server/*",
                "next",
                "next/*",
                "@opennextjs/*",
                "idb",
              ],
              message:
                "Domain and contracts must be independent of runtime adapters.",
            },
          ],
        },
      ],
    },
  },
  {
    files: ["src/lib/server/**/*.ts"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["**/client/*", "next", "next/*", "@opennextjs/*"],
              message:
                "Server modules must not depend on client or framework adapters.",
            },
          ],
        },
      ],
    },
  },
  prettier,
]);
