import type { FastifyInstance } from "fastify"
import { hasCredits } from "../config.js"
import { buildToolkit } from "./toolkit.js"
import { CONTRACT_VERSION } from "./types.js"
import type {
  NodaroPrivatePlugin,
  PluginEngines,
  PluginHandlerFn,
  PluginToolkit,
  PrivatePluginsModule,
  PromptTable,
} from "./types.js"

/**
 * The ONLY place the `@nodaroai/cloud-plugins` package name literal appears
 * in this codebase. It's passed to `importer` as a plain string ARGUMENT —
 * never written as a statically-analyzable `import("@nodaroai/cloud-plugins")`
 * specifier — so `tsc` never tries to resolve it as a real module. The
 * package is proprietary and, per Stage 1, isn't installed in every
 * environment that type-checks this file: community/business builds (and
 * this file's own test suite) never install it; only cloud builds do, via
 * the Dockerfile registry install added in Task 12.
 */
const PRIVATE_PLUGINS_PACKAGE = "@nodaroai/cloud-plugins"

export interface LoadPrivatePluginsOpts {
  /**
   * Fastify app to register plugin routes on. When omitted, `registerRoutes`
   * is never called (handlers are still collected) — the video worker
   * process (Stage 1 Task 10) only needs handlers, not an HTTP app.
   */
  app?: FastifyInstance
  /** Injectable for tests. Defaults to `process.exit`. */
  exit?: (code: number) => never
  /** Injectable for tests. Defaults to a real dynamic `import()`. */
  importer?: (name: string) => Promise<unknown>
  /**
   * Injectable override for the assembled toolkit. Defaults to
   * `buildToolkit()` (Task 9's real assembly). Lets Task 8's tests exercise
   * the loader without depending on Task 9.
   */
  toolkit?: PluginToolkit
}

export interface LoadPrivatePluginsResult {
  handlers: Record<string, PluginHandlerFn>
  loaded: string[]
  /**
   * Additive (S8). Merged from each loaded plugin's `engines(tk)` via
   * `Object.assign` — last write wins per named engine, mirroring how
   * `handlers` is already merged above.
   */
  engines: PluginEngines
  /**
   * Additive (S9 plumbing). Merged from each loaded plugin's `prompts()` via
   * `Object.assign` — last write wins per key, mirroring `handlers`/`engines`.
   * NOT YET wired into `ee/pipelines/llms/prompt-registry.ts` — that registry
   * doesn't exist yet (created by a later task). Until then this is just
   * collected here for callers to read directly.
   */
  prompts: PromptTable
}

function emptyResult(): LoadPrivatePluginsResult {
  // Fresh object per call — loadPrivatePlugins() is called from more than
  // one boot path (app.ts + video-worker.ts, Task 10), and callers merge
  // into `handlers` (e.g. Object.assign(allHandlers, handlers)). Sharing one
  // mutable object across calls would alias that merge across processes.
  return { handlers: {}, loaded: [], engines: {}, prompts: {} }
}

function isOptionalMode(): boolean {
  return process.env.PRIVATE_MODULES === "optional"
}

/**
 * Shared fail path for every private-plugin load failure (import rejection,
 * contractVersion mismatch, malformed module shape). Cloud edition is fatal
 * (`exit(1)`) after a logged error, UNLESS `PRIVATE_MODULES=optional`, in
 * which case it warns and continues with no plugins loaded. Centralizing
 * this here means every current and future failure mode gets the same
 * escape-hatch semantics for free, instead of re-deriving the branch at each
 * call site.
 */
function handleLoadFailure(
  reason: string,
  exit: (code: number) => never,
): LoadPrivatePluginsResult {
  if (isOptionalMode()) {
    console.warn(
      `[private-plugins] ${reason} — PRIVATE_MODULES=optional, continuing without private plugins.`,
    )
    return emptyResult()
  }
  console.error(
    `[private-plugins] FATAL: ${reason}. Cloud edition requires ${PRIVATE_PLUGINS_PACKAGE} to boot. ` +
      "Set PRIVATE_MODULES=optional to boot in a degraded mode without it (private-plugin features unavailable).",
  )
  exit(1)
  // `exit` is typed as never-returning, but an injected test double doesn't
  // actually terminate the process — return explicitly so control flow
  // stops here in both the real process.exit path and in tests.
  return emptyResult()
}

/**
 * Lazily assembles (and memoizes) the toolkit handed to plugins — only built
 * if a loaded plugin actually needs one, and never rebuilt once built.
 */
function makeToolkitGetter(override: PluginToolkit | undefined): () => PluginToolkit {
  let toolkit = override
  return () => {
    if (!toolkit) toolkit = buildToolkit()
    return toolkit
  }
}

/**
 * Loads private plugins from `@nodaroai/cloud-plugins` (proprietary, closed
 * source — see `nodaroai/nodaro-cloud-plugins`).
 *
 * - community/business (`hasCredits()` false): no-op, `importer` is never
 *   called, resolves `{ handlers: {}, loaded: [], engines: {}, prompts: {} }`.
 * - cloud, load succeeds: registers each plugin's routes on `opts.app` (if
 *   given), merges each plugin's handlers, applies each plugin's
 *   `staticCreditCosts()` via the credits service's additive registration
 *   hook, merges each plugin's `engines(tk)` into `result.engines`, and
 *   collects each plugin's `prompts()` into `result.prompts`.
 * - cloud, load fails (import rejects, wrong `contractVersion`, or a
 *   malformed module shape): fatal — logs and calls `exit(1)` — UNLESS
 *   `PRIVATE_MODULES=optional`, in which case it warns and continues with no
 *   plugins loaded.
 *
 * Call once from `app.ts` (with `app` set, to register routes) and once
 * from the video worker (without `app`, for handlers only) — see Stage 1
 * Task 10.
 */
export async function loadPrivatePlugins(
  opts: LoadPrivatePluginsOpts = {},
): Promise<LoadPrivatePluginsResult> {
  if (!hasCredits()) return emptyResult()

  const importer = opts.importer ?? ((name: string) => import(name))
  const exit = opts.exit ?? process.exit

  let rawModule: unknown
  try {
    rawModule = await importer(PRIVATE_PLUGINS_PACKAGE)
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err)
    return handleLoadFailure(`failed to load ${PRIVATE_PLUGINS_PACKAGE}: ${detail}`, exit)
  }

  const mod = (
    rawModule && typeof rawModule === "object" ? rawModule : {}
  ) as Partial<PrivatePluginsModule>

  if (mod.contractVersion !== CONTRACT_VERSION) {
    return handleLoadFailure(
      `${PRIVATE_PLUGINS_PACKAGE} contractVersion mismatch (expected ${CONTRACT_VERSION}, got ${JSON.stringify(mod.contractVersion)})`,
      exit,
    )
  }
  if (!Array.isArray(mod.plugins)) {
    return handleLoadFailure(`${PRIVATE_PLUGINS_PACKAGE} exported no plugins[] array`, exit)
  }

  const plugins: NodaroPrivatePlugin[] = mod.plugins
  const getToolkit = makeToolkitGetter(opts.toolkit)
  const handlers: Record<string, PluginHandlerFn> = {}
  const loaded: string[] = []
  const engines: PluginEngines = {}
  const prompts: PromptTable = {}

  for (const plugin of plugins) {
    if (opts.app && plugin.registerRoutes) {
      await plugin.registerRoutes(opts.app, getToolkit())
    }
    if (plugin.handlers) {
      Object.assign(handlers, plugin.handlers(getToolkit()))
    }
    if (plugin.staticCreditCosts) {
      await applyStaticCreditCosts(plugin.staticCreditCosts())
    }
    if (plugin.engines) {
      Object.assign(engines, plugin.engines(getToolkit()))
    }
    if (plugin.prompts) {
      // wired to prompt-registry in S9 — ee/pipelines/llms/prompt-registry.ts
      // doesn't exist yet; collect here so a later task can redirect this
      // into registerPipelinePrompts() without touching the loader's shape.
      Object.assign(prompts, plugin.prompts())
    }
    loaded.push(plugin.name)
  }

  return { handlers, loaded, engines, prompts }
}

/**
 * Additive registration of a plugin's static credit cost fallbacks into
 * `ee/billing/credits.ts`'s STATIC_CREDIT_COSTS. Dynamic `import()` gated on
 * `hasCredits()` — mirrors the `middleware/credit-guard.ts` shim pattern so
 * core (`lib/private-plugins/`) never STATICALLY imports `ee/` (enforced by
 * `tools/check-ee-imports.mjs`).
 */
async function applyStaticCreditCosts(costs: Record<string, number>): Promise<void> {
  if (!hasCredits()) return
  const { registerStaticCreditCosts } = await import("../../ee/billing/credits.js")
  registerStaticCreditCosts(costs)
}
