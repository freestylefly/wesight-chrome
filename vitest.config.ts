import { defineConfig } from "vitest/config"
import { fileURLToPath } from "node:url"

export default defineConfig({
  resolve: {
    alias: [{ find: /^~(.*)$/, replacement: `${fileURLToPath(new URL(".", import.meta.url))}$1` }]
  },
  test: {
    environment: "jsdom",
    globals: true,
    include: ["tests/**/*.test.ts"]
  }
})
