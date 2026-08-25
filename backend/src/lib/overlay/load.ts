/**
 * Deployment overlay loader (G1 keystone, spec §7.2).
 *
 * Mainline registers NO overlay: with NODARO_OVERLAY_PACKAGE unset this hook is
 * a no-op and boot is byte-identical (guarded by boot-smoke, Task 5). When a
 * deployment names an overlay package, this dynamic-imports it and awaits its
 * `register()`, which calls the existing registry setters (egress decorator,
 * billing provider, prompt policies, catalog/person packs). The loader is
 * GENERIC — it knows none of those setters; the overlay owns that wiring.
 *
 * Mirrors two mainline precedents:
 *  - the call-form `import(name)` of registerNodaroCloudBillingProvider
 *    (lib/billing-provider.ts) and loadPrivatePlugins (lib/private-plugins/
 *    load.ts): the package name is a runtime VARIABLE, never a static
 *    specifier, so `tsc` never resolves it and tools/check-ee-imports.mjs stays
 *    green without the overlay package installed on mainline.
 *  - loadPrivatePlugins' fail-loud shape (injectable importer/exit, a
 *    contract-version drift guard, a curated fatal message).
 *
 * Deliberate difference from loadPrivatePlugins: the env being SET is the
 * deployment's explicit opt-in, so a named-but-broken overlay is ALWAYS fatal —
 * there is no PRIVATE_MODULES=optional escape hatch. A deployment that declared
 * it needs an overlay must not boot silently without it.
 */

const OVERLAY_PACKAGE_ENV = "NODARO_OVERLAY_PACKAGE"

export const OVERLAY_CONTRACT_VERSION = 1

/** The shape a deployment overlay package must export. */
export interface OverlayModule {
  /** Must equal OVERLAY_CONTRACT_VERSION — a drift guard against a stale build. */
  overlayContractVersion: number
  /** Runs the deployment's registry-setter calls. May be async. */
  register(): void | Promise<void>
}

export interface LoadOverlayOpts {
  /** Injectable for tests. Defaults to a real call-form dynamic `import()`. */
  importer?: (name: string) => Promise<unknown>
  /** Injectable for tests. Defaults to `process.exit`. */
  exit?: (code: number) => never
  /** Injectable override of the env read (tests). Defaults to process.env. */
  packageName?: string
}

export interface LoadOverlayResult {
  /** The package name whose register() ran, or null when no overlay loaded. */
  loaded: string | null
}

export async function loadOverlay(opts: LoadOverlayOpts = {}): Promise<LoadOverlayResult> {
  const name = (opts.packageName ?? process.env[OVERLAY_PACKAGE_ENV] ?? "").trim()
  if (!name) return { loaded: null }

  const importer = opts.importer ?? ((n: string) => import(n))
  const exit = opts.exit ?? process.exit

  let raw: unknown
  try {
    raw = await importer(name)
  } catch (err) {
    return fail(`failed to load overlay package "${name}": ${detail(err)}`, exit)
  }

  const mod = (raw && typeof raw === "object" ? raw : {}) as Partial<OverlayModule>

  if (mod.overlayContractVersion !== OVERLAY_CONTRACT_VERSION) {
    return fail(
      `overlay "${name}" overlayContractVersion mismatch ` +
        `(expected ${OVERLAY_CONTRACT_VERSION}, got ${JSON.stringify(mod.overlayContractVersion)})`,
      exit,
    )
  }
  if (typeof mod.register !== "function") {
    return fail(`overlay "${name}" exported no register() function`, exit)
  }

  try {
    await mod.register()
  } catch (err) {
    return fail(`overlay "${name}" register() threw: ${detail(err)}`, exit)
  }

  console.log(`[overlay] loaded ${name}`)
  return { loaded: name }
}

function detail(err: unknown): string {
  return err instanceof Error ? err.message : String(err)
}

/**
 * Shared fail path. NODARO_OVERLAY_PACKAGE being set is an explicit opt-in, so a
 * broken overlay is always fatal — no optional-mode escape hatch (see the module
 * doc). `exit` is typed never-returning, but an injected test double does not
 * terminate, so return explicitly to stop control flow in both paths.
 */
function fail(reason: string, exit: (code: number) => never): LoadOverlayResult {
  console.error(
    `[overlay] FATAL: ${reason}. NODARO_OVERLAY_PACKAGE is set, so the named ` +
      `overlay must load — unset it to boot without an overlay.`,
  )
  exit(1)
  return { loaded: null }
}
