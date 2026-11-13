import { fileURLToPath } from "node:url"
import { defineConfig } from "vitest/config"

const root = fileURLToPath(new URL(".", import.meta.url))
const sdk = `${root}packages/plugin-sdk/`
const academic = `${root}packages/academic/`
const pluginUi = `${root}packages/plugin-ui/`

export default defineConfig({
  resolve: {
    alias: [
      { find: /^@\/(.*)$/, replacement: `${root}$1` },
      { find: /^@orahako\/plugin-sdk$/, replacement: `${sdk}index.ts` },
      { find: /^@orahako\/plugin-sdk\/(.*)$/, replacement: `${sdk}$1` },
      { find: /^@orahako\/academic$/, replacement: `${academic}index.ts` },
      { find: /^@orahako\/academic\/(.*)$/, replacement: `${academic}$1` },
      { find: /^@orahako\/plugin-ui$/, replacement: `${pluginUi}index.ts` },
      { find: /^@orahako\/plugin-ui\/(.*)$/, replacement: `${pluginUi}$1` },
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
