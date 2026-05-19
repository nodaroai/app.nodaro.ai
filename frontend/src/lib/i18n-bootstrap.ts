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

// Defensive: if the glob resolves to ZERO loaders, every picker silently
// falls back to English on every locale (the resolver returns `null` for
// every (catalog, locale) lookup). This usually indicates a build
// misconfiguration — Dockerfile not copying `packages/shared/src/i18n/`,
// or the source files missing from the build context.
if (Object.keys(loaders).length === 0) {
  // eslint-disable-next-line no-console
  console.warn(
    "[i18n-bootstrap] Sidecar glob matched ZERO files — every picker will fall back to English. " +
    "Check: (a) packages/shared/src/i18n/*.*.ts files exist in the build context, " +
    "(b) Dockerfile's frontend-build stage copies packages/shared/src/i18n/ before `vite build`.",
  )
}
