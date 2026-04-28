/**
 * Wire the i18n sidecar loader registry into `@nodaro/shared`.
 *
 * The shared package is built by tsup for npm publish, and tsup does NOT
 * expand Vite's `import.meta.glob`. So the glob lives here (in Vite-
 * processed code) and we hand the loader map to shared at startup.
 *
 * Each matched sidecar (e.g. `person.ja.ts`) becomes a code-split chunk
 * via the default lazy loader behavior of `import.meta.glob`. Sidecars
 * load on demand the first time a picker requests their (catalog, locale)
 * pair.
 *
 * Import this module ONCE from `main.tsx` before mounting the app.
 */
import { registerSidecarLoaders, type SidecarLoader } from "@nodaro/shared"

const loaders = import.meta.glob(
  "../../../packages/shared/src/i18n/*.*.ts",
) as Record<string, SidecarLoader>

registerSidecarLoaders(loaders)
