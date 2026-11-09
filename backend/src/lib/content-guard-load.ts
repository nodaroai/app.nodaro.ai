/**
 * Loads a deployment's content guard (lib/content-guard.ts) from the private
 * plugin package's `content-guard` subpath, into the process that asks for it.
 *
 * A subpath of its own, not `loadPrivatePlugins`: that loader runs in the API
 * server and the media and pipeline workers, and the standalone orchestrator
 * never runs it, while the workflow engine is exactly where a guard must be
 * present. The subpath is a tiny module of pure functions, so importing it
 * costs a process nothing.
 *
 * An edition without the package has no guard and asks for none. On Cloud a
 * missing, broken or older module stops the boot, the way a named overlay does,
 * so a bad deploy fails its health check and the running version keeps serving
 * rather than every funnel going quietly inert. The one escape is the plugin
 * loader's own `PRIVATE_MODULES=optional`, the degraded boot that CI and a local
 * install without the private package already use. So a plugin build that ships
 * the guard has to be released and pinned before the platform build that needs
 * it is deployed.
 */
import { hasCredits } from "./config.js"
import { registerContentGuard, type ContentGuard } from "./content-guard.js"

/** A runtime string, never a static specifier: tsc must not try to resolve a package that is not installed everywhere. */
const CONTENT_GUARD_MODULE = "@nodaroai/cloud-plugins/content-guard"

export interface LoadContentGuardOpts {
  /** Injectable for tests. Defaults to a real dynamic `import()`. */
  importer?: (name: string) => Promise<unknown>
  /** Injectable for tests. Defaults to `process.exit`. */
  exit?: (code: number) => never
}

function isContentGuard(value: unknown): value is ContentGuard {
  if (!value || typeof value !== "object") return false
  const guard = value as Partial<ContentGuard>
  return typeof guard.id === "string" && guard.id.length > 0 && typeof guard.check === "function"
}

/** The one failure path: fatal on Cloud, unless this boot is the declared degraded one. */
function failLoad(reason: string, exit: (code: number) => never): null {
  if (process.env.PRIVATE_MODULES === "optional") {
    console.warn(`[content-guard] no guard loaded (${reason}) — PRIVATE_MODULES=optional, continuing without one.`)
    return null
  }
  console.error(
    `[content-guard] FATAL: no guard loaded (${reason}). Cloud edition requires one. Release and pin a plugin build that ships it ` +
      "before deploying this platform build, or set PRIVATE_MODULES=optional to boot in a degraded mode without it.",
  )
  exit(1)
  return null
}

/** Returns the id of the guard it registered, or null when there is none to register. */
export async function loadContentGuard(opts: LoadContentGuardOpts = {}): Promise<string | null> {
  if (!hasCredits()) return null
  const importer = opts.importer ?? ((name: string) => import(name))
  const exit = opts.exit ?? ((code: number): never => process.exit(code))
  let raw: unknown
  try {
    raw = await importer(CONTENT_GUARD_MODULE)
  } catch (err) {
    return failLoad(err instanceof Error ? err.message : String(err), exit)
  }
  const guard = (raw && typeof raw === "object" ? (raw as { contentGuard?: unknown }).contentGuard : undefined) ?? null
  if (!isContentGuard(guard)) return failLoad("the module exports no usable contentGuard", exit)
  try {
    registerContentGuard(guard)
  } catch (err) {
    return failLoad(err instanceof Error ? err.message : String(err), exit)
  }
  console.log(`[content-guard] loaded ${guard.id}`)
  return guard.id
}
