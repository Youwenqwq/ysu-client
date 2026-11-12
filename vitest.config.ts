import { fileURLToPath } from "node:url"
import { defineConfig } from "vitest/config"

const root = fileURLToPath(new URL(".", import.meta.url))
const sdk = `${root}packages/plugin-sdk/`
const academic = `${root}packages/academic/`

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@ysu\/plugin-sdk$/, replacement: `${sdk}index.ts` },
      { find: /^@ysu\/plugin-sdk\/(.*)$/, replacement: `${sdk}$1` },
      { find: /^@ysu\/academic$/, replacement: `${academic}index.ts` },
      { find: /^@ysu\/academic\/(.*)$/, replacement: `${academic}$1` },
      { find: "@", replacement: root },
    ],
  },
  test: {
    environment: "node",
    include: [
      "providers/**/*.test.ts",
      "lib/**/*.test.ts",
      "app/**/*.test.ts",
      "packages/**/*.test.ts",
      "plugins/**/*.test.ts",
    ],
  },
})
