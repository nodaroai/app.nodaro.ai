// @reads-none checks whether a package is installed under node_modules; reads no repo file
import { existsSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import type { Plugin } from "vite"

/**
 * The shared site header's module resolver (Cloud only).
 *
 * The header is a private package that only cloud images install (see
 * `install-package.sh` beside this file and the Dockerfile's frontend stage).
 * App code imports it through ONE virtual id, `virtual:site-header`:
 *
 *   - cloud build, `VITE_SHARED_HEADER=true`, package installed → a small
 *     adapter that re-exports the package and imports its stylesheet;
 *   - anything else → `stub.tsx` (`headerAvailable = false`, a header that
 *     renders nothing), so community / business builds and public CI never
 *     need the package.
 *
 * When the flag is on but cannot be honoured (another edition, or the package
 * is missing on the dev server) the flag itself is forced to "false" in the
 * bundle, so code gated on it never runs without the header. A cloud BUILD
 * with the flag on and no package is refused: it would ship a flag-on image
 * with no header.
 *
 * The same decision serves `virtual:site-locale`: the header's language
 * cookie, shared by every Nodaro product. It is an id of its own because the
 * app's locale store reads it at startup, in the main bundle; importing it
 * from `virtual:site-header` would put the whole header there. Wherever the
 * header is the stub, so is the locale (`lib/site-locale-stub.ts`: no cookie,
 * and the app keeps its own storage).
 *
 * And `virtual:site-a11y`: the accessibility choices every product shares (a
 * cookie too), read by the app's boot (before the first paint) and its own
 * menu, so it is light for the same reason. On the package decision it is an
 * adapter over the package's accessibility entry (its reader, its cookie
 * writer and its boot call) and its page-wide stylesheet; elsewhere
 * `lib/site-a11y-stub.ts` (`null`: the app keeps its own storage).
 *
 * And `virtual:media-editor`: the shared media editor's parts (range strip,
 * crop box, ratio chips and their helpers), used by the trend admin's source
 * clip intake. On the package decision it re-exports the package's editor
 * entry (and the stylesheet its parts are drawn with) with
 * `mediaEditorAvailable = true`; elsewhere `media-editor-stub.ts`
 * (`mediaEditorAvailable = false`, every part `null`), and the admin keeps its
 * own source editor. Its decision is its own (`mediaEditorDecision`): every
 * cloud build with the package installed, whatever VITE_SHARED_HEADER says —
 * the editor is admin tooling, not the header, and a cloud build without the
 * package simply keeps the admin's own editor.
 *
 * Types come from `site-header.d.ts`, `media-editor.d.ts`,
 * `lib/site-locale.d.ts` and `lib/site-a11y.d.ts`; `contract/` holds the
 * internal-only check that those types still fit the package.
 */

export const SITE_HEADER_ID = "virtual:site-header"
const RESOLVED_ID = `\0${SITE_HEADER_ID}`
export const SITE_LOCALE_ID = "virtual:site-locale"
const RESOLVED_LOCALE_ID = `\0${SITE_LOCALE_ID}`
export const SITE_A11Y_ID = "virtual:site-a11y"
const RESOLVED_A11Y_ID = `\0${SITE_A11Y_ID}`
export const MEDIA_EDITOR_ID = "virtual:media-editor"
const RESOLVED_MEDIA_EDITOR_ID = `\0${MEDIA_EDITOR_ID}`
const PACKAGE = "@nodaroai/shell"
const FLAG = "VITE_SHARED_HEADER"

export type SiteHeaderDecision = "package" | "stub" | "missing"

export interface SiteHeaderEnv {
  readonly edition?: string
  readonly flag?: string
}

/** What `virtual:site-header` becomes for this build. */
export function siteHeaderDecision(env: SiteHeaderEnv, installed: boolean): SiteHeaderDecision {
  if (env.edition !== "cloud" || env.flag !== "true") return "stub"
  return installed ? "package" : "missing"
}

/**
 * What `virtual:media-editor` becomes for this build: the package on any cloud
 * build that has it installed, the header flag on or off; the stub otherwise.
 */
export function mediaEditorDecision(edition: string | undefined, installed: boolean): "package" | "stub" {
  return edition === "cloud" && installed ? "package" : "stub"
}

/**
 * Whether the package is installed for `root`: a `node_modules/<package>` in
 * `root` or any ancestor (the workspace root, where `npm install` puts it) —
 * the directories Node and Vite look in. Not require-style resolution: the
 * package publishes ESM `exports` only, which `require.resolve` cannot use.
 */
export function isPackageInstalled(root: string): boolean {
  let dir = resolve(root)
  for (;;) {
    if (existsSync(join(dir, "node_modules", ...PACKAGE.split("/"), "package.json"))) return true
    const parent = dirname(dir)
    if (parent === dir) return false
    dir = parent
  }
}

export interface SiteHeaderModuleOptions {
  /** Where to resolve the package from (the frontend directory). */
  readonly root: string
  /** The stub module's absolute path. */
  readonly stubPath: string
  /** The locale stub's absolute path. */
  readonly localeStubPath: string
  /** The accessibility stub's absolute path. */
  readonly a11yStubPath: string
  /** The media editor stub's absolute path. */
  readonly mediaEditorStubPath: string
  /** Test seam; defaults to Node resolution from `root`. */
  readonly isInstalled?: (root: string) => boolean
  /** Test seam; defaults to Vite's own `loadEnv` (the process env plus `.env*` files, `VITE_` only). */
  readonly readEnv?: (mode: string, envDir: string) => Promise<Record<string, string>> | Record<string, string>
}

/** Vite's env loader, imported when the config hook runs (not at module load). */
async function viteEnv(mode: string, envDir: string): Promise<Record<string, string>> {
  const { loadEnv } = await import("vite")
  return loadEnv(mode, envDir, "VITE_")
}

const ADAPTER = [
  `import "${PACKAGE}/shell.css"`,
  `export { NodaroShell, shellTranslator } from "${PACKAGE}"`,
  "export const headerAvailable = true",
  "",
].join("\n")

const LOCALE_ADAPTER = [
  `export { readSavedLocale, saveLocale, watchSavedLocale } from "${PACKAGE}/locale"`,
  "",
].join("\n")

const A11Y_ADAPTER = [
  `import "${PACKAGE}/a11y.css"`,
  `import { applySavedAccessibility, readAccessibility, saveAccessibility } from "${PACKAGE}/a11y"`,
  "export const sharedAccessibility = Object.freeze({",
  "  read: (now) => readAccessibility(now),",
  "  save: (state) => saveAccessibility(state),",
  "  applySaved: () => {",
  "    applySavedAccessibility()",
  "  },",
  "})",
  "",
].join("\n")

const MEDIA_EDITOR_ADAPTER = [
  `import "${PACKAGE}/shell.css"`,
  `export * from "${PACKAGE}/media-editor"`,
  "export const mediaEditorAvailable = true",
  "",
].join("\n")

const ADAPTER_IDS: ReadonlySet<string | undefined> = new Set([RESOLVED_ID, RESOLVED_LOCALE_ID, RESOLVED_A11Y_ID, RESOLVED_MEDIA_EDITOR_ID])

export function siteHeaderModule(options: SiteHeaderModuleOptions): Plugin {
  const installed = options.isInstalled ?? isPackageInstalled
  const readEnv = options.readEnv ?? viteEnv
  let decision: SiteHeaderDecision = "stub"
  let editor: "package" | "stub" = "stub"
  return {
    name: "nodaro-site-header",
    enforce: "pre",
    async config(config, { mode, command }) {
      const envDir = typeof config.envDir === "string" ? config.envDir : (config.root ?? options.root)
      const env = await readEnv(mode, envDir)
      const present = installed(options.root)
      decision = siteHeaderDecision({ edition: env.VITE_EDITION, flag: env[FLAG] }, present)
      editor = mediaEditorDecision(env.VITE_EDITION, present)
      if (decision === "missing" && command === "build") {
        throw new Error(`${FLAG}=true on a cloud build, but the header package is not installed. Install it (see frontend/src/ee/shell/install-package.sh) or unset the flag.`)
      }
      if (decision === "package" || env[FLAG] !== "true") return
      // The flag is on but cannot be honoured: off in the bundle too.
      return { define: { [`import.meta.env.${FLAG}`]: JSON.stringify("false") } }
    },
    configResolved(config) {
      if (decision === "missing") config.logger.warn(`[site-header] ${FLAG}=true but the header package is not installed — serving the stub, flag off.`)
    },
    resolveId(id, importer) {
      if (id === SITE_HEADER_ID) return decision === "package" ? RESOLVED_ID : options.stubPath
      if (id === SITE_LOCALE_ID) return decision === "package" ? RESOLVED_LOCALE_ID : options.localeStubPath
      if (id === SITE_A11Y_ID) return decision === "package" ? RESOLVED_A11Y_ID : options.a11yStubPath
      if (id === MEDIA_EDITOR_ID) return editor === "package" ? RESOLVED_MEDIA_EDITOR_ID : options.mediaEditorStubPath
      // The adapters have no file of their own: resolve their imports from the
      // frontend directory, as if a file there imported them.
      if (ADAPTER_IDS.has(importer) && id.startsWith(PACKAGE)) {
        return this.resolve(id, join(options.root, "package.json"), { skipSelf: true })
      }
      return null
    },
    load(id) {
      if (id === RESOLVED_ID) return ADAPTER
      if (id === RESOLVED_A11Y_ID) return A11Y_ADAPTER
      if (id === RESOLVED_MEDIA_EDITOR_ID) return MEDIA_EDITOR_ADAPTER
      return id === RESOLVED_LOCALE_ID ? LOCALE_ADAPTER : null
    },
  }
}
