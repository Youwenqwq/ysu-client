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
    // Generated / build artifacts
    "dist/**",
    "android/app/build/**",
    "android/app/src/main/assets/public/**",
  ]),
  {
    rules: {
      // Hydrating client state from localStorage inside useEffect is the
      // standard SSR-safe pattern in Next.js; the cascading-render risk
      // does not apply to one-shot cache reads on mount.
      "react-hooks/set-state-in-effect": "off",
    },
  },
]);

export default eslintConfig;
