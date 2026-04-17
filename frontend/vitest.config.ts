import { defineConfig } from "vitest/config"
import path from "path"

export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      include: ["src/**/*.{ts,tsx}"],
      exclude: [
        "src/main.tsx",
        "src/router.tsx",
        "src/vite-env.d.ts",
        "src/app/**/page.tsx",
        "src/app/**/layout.tsx",
        "src/routes/**",
        "src/types/supabase.types.ts",
        "src/test/**",
        "src/**/*.test.{ts,tsx}",
        "src/**/__tests__/**",
      ],
    },
  },
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
      "@nodaro-shared": path.resolve(__dirname, "../packages/shared/src"),
    },
  },
})
