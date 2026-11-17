import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
    "playwright-report/**",
    "test-results/**",
  ]),
  {
    rules: {
      // Logout, firm switch and password pages reload the whole page on purpose, to clear the old session's data.
      "@next/next/no-location-assign-relative-destination": "off",
      // Older code still uses `any`; new code avoids it. Kept visible as warnings until it is typed.
      "@typescript-eslint/no-explicit-any": "warn",
      // React Compiler advice. These spots work today; they are reported so they can be tidied over time.
      "react-hooks/set-state-in-effect": "warn",
      "react-hooks/immutability": "warn",
      "react-hooks/refs": "warn",
      "react-hooks/purity": "warn",
      "react-hooks/preserve-manual-memoization": "warn",
    },
  },
  {
    // Server-rendered PDF documents: no state, so components built inside the render are fine.
    files: ["src/lib/pdf/**"],
    rules: {
      "react-hooks/static-components": "off",
      "jsx-a11y/alt-text": "off",
    },
  },
]);

export default eslintConfig;
