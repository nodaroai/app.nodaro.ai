import { defineConfig, configDefaults } from "vitest/config"
import path from "path"

export default defineConfig({
  test: {
    environment: "jsdom",
    globals: true,
    setupFiles: ["./src/test/setup.ts"],
    // The picker-ui workspace package must be processed by vite (not
    // externalized to Node ESM): externalized it resolves react from ITS OWN
    // node_modules — a second React copy that crashes every hook ("null
    // useState/useMemo"). Inlining routes it through the dedupe below.
    server: { deps: { inline: [/@nodaro[\\/]picker-ui/, /picker-ui[\\/]dist/] } },
    // Keep vitest's default exclude (node_modules, dist, cypress, etc.) and
    // add `playwright/**` so the Playwright spec dir (bootstrapped in PR
    // #2349 / film-director Phase 0) isn't picked up by vitest's glob —
    // those tests use @playwright/test's test.describe() and have their
    // own runner (npx playwright test, see playwright.config.ts).
    exclude: [...configDefaults.exclude, "playwright/**"],
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
    },
    // The picker-ui package is consumed via a workspace symlink; without
    // dedupe its own node_modules/react loads as a SECOND React copy and every
    // package component crashes with "Cannot read properties of null
    // (reading 'useState')". Mirrors vite.config's dedupe.
    dedupe: ["react", "react-dom"],
  },
})
