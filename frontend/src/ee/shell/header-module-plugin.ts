// @reads-none checks whether a package is installed under node_modules and reads its version there; reads no repo file
import { existsSync, readFileSync } from "node:fs"
import { dirname, join, resolve } from "node:path"
import type { Plugin } from "vite"
import { readSiteEnv, siteWorldsFile } from "./site"

/**
 * The shared site header's module resolver (Cloud only).
 *
 * The header is a private package that only cloud images install (see
 * `install-package.sh` beside this file and the Dockerfile's frontend stage).
 * App code imports it through ONE virtual id, `virtual:site-header`:
 *
 *   - cloud build, `VITE_SHARED_HEADER` "true" or "white-label", package
 *     installed → a small adapter that re-exports the package and imports its
 *     stylesheet;
 *   - anything else → `stub.tsx` (`headerAvailable = false`, a header that
 *     renders nothing), so community / business builds and public CI never
 *     need the package.
 *
 * The two values build the same bundle; they differ in which header the page
 * may show (`lib/edition.ts`, decided at run time by `lib/site-header-mode.ts`):
 * "true" is Nodaro's own sites (Nodaro's header, or a white-label one where
 * the deployment's surface profile asks for it); "white-label" is an image for
 * deployments of their own, which shows the header only where the profile
 * says `header: "white-label"`, and never Nodaro's.
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
 * writer and its boot call) and the address of its page-wide stylesheet;
 * elsewhere `lib/site-a11y-stub.ts` (`null`: the app keeps its own storage).
 *
 * Both are only what the BUILD carries. Whether a page uses them is decided at
 * run time, by the deployment (`siteHeaderMode()`): where it shows no header,
 * the app keeps its own storage and loads no stylesheet of the header's, as on
 * a build without it (`lib/locale-store.ts`, `components/i18n-html-dir.tsx`,
 * `lib/accessibility-preferences.ts`). So the stylesheet is not imported here
 * (that would style every page of every deployment the image serves): the
 * adapter hands its address, and the app links it where the header is on.
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
 *
 * A cloud build also publishes `/shell-version.json`: the header version it
 * installed (`null` without the package) and whether the site shows it. The
 * version depends on the environment's build settings as well as the commit,
 * so the built site is the one place that knows it; the admin's Header
 * versions page reads it (`backend/src/ee/lib/header-versions/`). Beside it,
 * `/shell-worlds.json`: where the site's worlds row leads, from the same
 * function the header's links come from (`site.ts`), for the same reason.
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
/** Served at the site's root; the backend's `SITE_FILE` reads it by this name. */
export const SITE_VERSION_FILE = "shell-version.json"
/** Served at the site's root; the backend's `WORLDS_FILE` reads it by this name. */
export const SITE_WORLDS_FILE = "shell-worlds.json"

export type SiteHeaderDecision = "package" | "stub" | "missing"

/** The flag's values that build the header in: Nodaro's own sites, and an image for deployments of their own. */
export const SHARED_HEADER_FLAG_VALUES: readonly string[] = Object.freeze(["true", "white-label"])

function buildsHeader(flag: string | undefined): boolean {
  return flag !== undefined && SHARED_HEADER_FLAG_VALUES.includes(flag)
}

export interface SiteHeaderEnv {
  readonly edition?: string
  readonly flag?: string
}

/** What `virtual:site-header` becomes for this build. */
export function siteHeaderDecision(env: SiteHeaderEnv, installed: boolean): SiteHeaderDecision {
  if (env.edition !== "cloud" || !buildsHeader(env.flag)) return "stub"
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
 * The installed package's `package.json` for `root`: a `node_modules/<package>`
 * in `root` or any ancestor (the workspace root, where `npm install` puts it) —
 * the directories Node and Vite look in. Not require-style resolution: the
 * package publishes ESM `exports` only, which `require.resolve` cannot use.
 */
function installedManifest(root: string): string | null {
  let dir = resolve(root)
  for (;;) {
    const manifest = join(dir, "node_modules", ...PACKAGE.split("/"), "package.json")
    if (existsSync(manifest)) return manifest
    const parent = dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

/** Whether the package is installed for `root` (see {@link installedManifest}). */
export function isPackageInstalled(root: string): boolean {
  return installedManifest(root) !== null
}

/** The installed package's version for `root`, or `null` when it is not installed or names none. */
export function installedVersion(root: string): string | null {
  const manifest = installedManifest(root)
  if (!manifest) return null
  try {
    const version = (JSON.parse(readFileSync(manifest, "utf8")) as { version?: unknown }).version
    return typeof version === "string" ? version : null
  } catch {
    return null
  }
}

/**
 * What `/shell-version.json` says: the version installed, and whether the site
 * shows the header. Never the package's name: the file is public, the name is
 * not.
 */
export function siteVersionFile(decision: SiteHeaderDecision, version: string | null): string {
  return `${JSON.stringify({ version, header: decision === "package" })}\n`
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
  /** Test seam; defaults to the installed package's own `package.json`. */
  readonly readVersion?: (root: string) => string | null
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
  `import { applySavedAccessibility, readAccessibility, saveAccessibility } from "${PACKAGE}/a11y"`,
  `export { default as a11yStylesheet } from "${PACKAGE}/a11y.css?url"`,
  "export const sharedAccessibility = Object.freeze({",
  "  read: (now, options) => readAccessibility(now, options),",
  "  save: (state, options) => saveAccessibility(state, options),",
  "  applySaved: (options) => {",
  "    applySavedAccessibility(options)",
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
  let versionFile: string | null = null
  let worldsFile: string | null = null
  return {
    name: "nodaro-site-header",
    enforce: "pre",
    async config(config, { mode, command }) {
      const envDir = typeof config.envDir === "string" ? config.envDir : (config.root ?? options.root)
      const env = await readEnv(mode, envDir)
      const present = installed(options.root)
      decision = siteHeaderDecision({ edition: env.VITE_EDITION, flag: env[FLAG] }, present)
      editor = mediaEditorDecision(env.VITE_EDITION, present)
      // `/shell-version.json` and `/shell-worlds.json`: a cloud build's only; never on another build or the dev server.
      const publishes = command === "build" && env.VITE_EDITION === "cloud"
      versionFile = publishes ? siteVersionFile(decision, present ? (options.readVersion ?? installedVersion)(options.root) : null) : null
      worldsFile = publishes ? siteWorldsFile(readSiteEnv(env), decision === "package") : null
      if (decision === "missing" && command === "build") {
        throw new Error(`${FLAG}=${env[FLAG]} on a cloud build, but the header package is not installed. Install it (see frontend/src/ee/shell/install-package.sh) or unset the flag.`)
      }
      if (decision === "package" || !buildsHeader(env[FLAG])) return
      // The flag is on but cannot be honoured: off in the bundle too.
      return { define: { [`import.meta.env.${FLAG}`]: JSON.stringify("false") } }
    },
    configResolved(config) {
      if (decision === "missing") config.logger.warn(`[site-header] ${FLAG} is on but the header package is not installed — serving the stub, flag off.`)
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
    generateBundle() {
      if (versionFile !== null) this.emitFile({ type: "asset", fileName: SITE_VERSION_FILE, source: versionFile })
      if (worldsFile !== null) this.emitFile({ type: "asset", fileName: SITE_WORLDS_FILE, source: worldsFile })
    },
  }
}
