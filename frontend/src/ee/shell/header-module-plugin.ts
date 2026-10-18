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
 * Types come from `site-header.d.ts`; `contract/` holds the internal-only
 * check that those types still fit the package.
 */

export const SITE_HEADER_ID = "virtual:site-header"
const RESOLVED_ID = `\0${SITE_HEADER_ID}`
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

export function siteHeaderModule(options: SiteHeaderModuleOptions): Plugin {
  const installed = options.isInstalled ?? isPackageInstalled
  const readEnv = options.readEnv ?? viteEnv
  let decision: SiteHeaderDecision = "stub"
  return {
    name: "nodaro-site-header",
    enforce: "pre",
    async config(config, { mode, command }) {
      const envDir = typeof config.envDir === "string" ? config.envDir : (config.root ?? options.root)
      const env = await readEnv(mode, envDir)
      decision = siteHeaderDecision({ edition: env.VITE_EDITION, flag: env[FLAG] }, installed(options.root))
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
      // The adapter has no file of its own: resolve its imports from the
      // frontend directory, as if a file there imported them.
      if (importer === RESOLVED_ID && id.startsWith(PACKAGE)) {
        return this.resolve(id, join(options.root, "package.json"), { skipSelf: true })
      }
      return null
    },
    load(id) {
      return id === RESOLVED_ID ? ADAPTER : null
    },
  }
}
