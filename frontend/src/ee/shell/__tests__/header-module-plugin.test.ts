// @vitest-environment node
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { Plugin, UserConfig } from "vite"
import { describe, expect, it } from "vitest"

import { isPackageInstalled, SITE_HEADER_ID, SITE_LOCALE_ID, siteHeaderDecision, siteHeaderModule } from "../header-module-plugin"

/**
 * The shared header's module resolver. `virtual:site-header` is the real
 * header only on a cloud build with the flag on AND the package installed;
 * everywhere else it is the stub, and a flag that cannot be honoured is forced
 * to "false" so code gated on it never runs without the header.
 *
 * The emitted bundle of a real `vite build` is checked in
 * tools/__tests__/shared-header-resolver-build.test.mjs (Vite cannot be
 * imported in this environment).
 */

const STUB = "/stub/site-header.tsx"
const LOCALE_STUB = "/stub/site-locale.ts"
const RESOLVED = `\0${SITE_HEADER_ID}`
const RESOLVED_LOCALE = `\0${SITE_LOCALE_ID}`
const FORCED_OFF = { define: { "import.meta.env.VITE_SHARED_HEADER": JSON.stringify("false") } }

function plugin(installed: boolean, env: Record<string, string>): Plugin {
  return siteHeaderModule({ root: "/repo/frontend", stubPath: STUB, localeStubPath: LOCALE_STUB, isInstalled: () => installed, readEnv: () => env })
}

type ConfigHook = (config: UserConfig, env: { mode: string; command: "build" | "serve" }) => Promise<UserConfig | null | void>
const runConfig = (p: Plugin, command: "build" | "serve") => (p.config as ConfigHook)({}, { mode: "production", command })
const resolve = (p: Plugin, id: string) => (p.resolveId as (id: string) => string | null)(id)
const load = (p: Plugin, id: string) => (p.load as (id: string) => string | null)(id)

const ON = { VITE_EDITION: "cloud", VITE_SHARED_HEADER: "true" }

describe("siteHeaderDecision", () => {
  it.each([
    [{ edition: "cloud", flag: "true" }, true, "package"],
    [{ edition: "cloud", flag: "true" }, false, "missing"],
    [{ edition: "community", flag: "true" }, true, "stub"],
    [{ edition: "business", flag: "true" }, true, "stub"],
    [{ edition: "cloud", flag: "false" }, true, "stub"],
    [{ edition: "cloud", flag: undefined }, true, "stub"],
    [{ edition: undefined, flag: undefined }, false, "stub"],
  ] as const)("%o, installed=%s → %s", (env, installed, expected) => {
    expect(siteHeaderDecision(env, installed)).toBe(expected)
  })
})

describe("isPackageInstalled", () => {
  // The package publishes ESM `exports` only (no `./package.json`, no
  // `require` condition), so require-style resolution can never find it;
  // detection walks node_modules upward the way Node itself looks.
  it("finds the package in an ancestor's node_modules (the workspace root), with an exports map require cannot use", () => {
    const root = mkdtempSync(join(tmpdir(), "site-header-installed-"))
    try {
      const frontend = join(root, "frontend")
      mkdirSync(frontend)
      expect(isPackageInstalled(frontend)).toBe(false)
      const pkg = join(root, "node_modules", "@nodaroai", "shell")
      mkdirSync(pkg, { recursive: true })
      writeFileSync(join(pkg, "package.json"), JSON.stringify({ name: "@nodaroai/shell", type: "module", exports: { ".": { import: "./dist/index.js" } } }))
      expect(isPackageInstalled(frontend)).toBe(true)
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe("siteHeaderModule", () => {
  it("cloud + flag + installed: the virtual id is the package adapter, the flag untouched", async () => {
    const p = plugin(true, ON)
    expect(await runConfig(p, "build")).toBeFalsy()
    expect(resolve(p, SITE_HEADER_ID)).toBe(RESOLVED)
    const source = load(p, RESOLVED) ?? ""
    expect(source).toMatch(/export const headerAvailable = true/)
    expect(source).toMatch(/^import ".+\/shell\.css"$/m)
    expect(source).toMatch(/^export \{ NodaroShell, shellTranslator \} from ".+"$/m)
  })

  it("the shared language follows the same decision, as an adapter of its own (no header in the main bundle)", async () => {
    const on = plugin(true, ON)
    await runConfig(on, "build")
    expect(resolve(on, SITE_LOCALE_ID)).toBe(RESOLVED_LOCALE)
    const source = load(on, RESOLVED_LOCALE) ?? ""
    expect(source).toMatch(/^export \{ readSavedLocale, saveLocale, watchSavedLocale \} from ".+\/locale"$/m)
    expect(source).not.toMatch(/shell\.css|NodaroShell/)

    for (const [installed, env] of [
      [true, { ...ON, VITE_EDITION: "community" }],
      [false, { VITE_EDITION: "cloud" }],
    ] as const) {
      const off = plugin(installed, env)
      await runConfig(off, "build")
      expect(resolve(off, SITE_LOCALE_ID)).toBe(LOCALE_STUB)
    }
  })

  it("resolves the locale adapter's import from the frontend directory too", async () => {
    const p = plugin(true, ON)
    await runConfig(p, "build")
    const context = { resolve: async (id: string) => ({ id: `/resolved/${id}` }) }
    const resolveId = p.resolveId as (this: typeof context, id: string, importer?: string) => Promise<unknown>
    const pkgImport = (load(p, RESOLVED_LOCALE) ?? "").match(/from "(.+)"$/m)?.[1] ?? ""
    expect(await resolveId.call(context, pkgImport, RESOLVED_LOCALE)).toEqual({ id: `/resolved/${pkgImport}` })
  })

  it("another edition with the flag on: the stub, and the flag is forced off", async () => {
    for (const edition of ["community", "business"]) {
      const p = plugin(true, { ...ON, VITE_EDITION: edition })
      expect(await runConfig(p, "build")).toEqual(FORCED_OFF)
      expect(resolve(p, SITE_HEADER_ID)).toBe(STUB)
    }
  })

  it("flag unset: the stub, and nothing is defined (the bundle is as before)", async () => {
    const p = plugin(false, { VITE_EDITION: "cloud" })
    expect(await runConfig(p, "build")).toBeFalsy()
    expect(resolve(p, SITE_HEADER_ID)).toBe(STUB)
  })

  it("a cloud BUILD with the flag on and no package fails loudly", async () => {
    await expect(runConfig(plugin(false, ON), "build")).rejects.toThrow(/VITE_SHARED_HEADER=true/)
  })

  it("the dev server with the flag on and no package falls back to the stub, flag forced off", async () => {
    const p = plugin(false, ON)
    expect(await runConfig(p, "serve")).toEqual(FORCED_OFF)
    expect(resolve(p, SITE_HEADER_ID)).toBe(STUB)
  })

  it("reads the env from config.envDir when set, else the plugin root", async () => {
    const dirs: string[] = []
    const p = siteHeaderModule({
      root: "/repo/frontend",
      stubPath: STUB,
      localeStubPath: LOCALE_STUB,
      isInstalled: () => false,
      readEnv: (_mode, dir) => {
        dirs.push(dir)
        return {}
      },
    })
    await (p.config as ConfigHook)({ envDir: "/custom" }, { mode: "production", command: "build" })
    await (p.config as ConfigHook)({}, { mode: "production", command: "build" })
    expect(dirs).toEqual(["/custom", "/repo/frontend"])
  })

  it("resolves the adapter's own imports from the frontend directory, whatever the build root", async () => {
    const p = plugin(true, ON)
    const calls: Array<[string, string | undefined]> = []
    const context = {
      resolve: async (id: string, importer?: string) => {
        calls.push([id, importer])
        return { id: `/resolved/${id}` }
      },
    }
    const resolveId = p.resolveId as (this: typeof context, id: string, importer?: string) => Promise<unknown>
    const pkgImport = (load(p, RESOLVED) ?? "").match(/^import "(.+)"$/m)?.[1] ?? ""
    expect(await resolveId.call(context, pkgImport, RESOLVED)).toEqual({ id: `/resolved/${pkgImport}` })
    expect(calls).toEqual([[pkgImport, join("/repo/frontend", "package.json")]])
    // An import from any other module is left to Vite.
    expect(await resolveId.call(context, pkgImport, "/src/main.tsx")).toBeNull()
  })

  it("leaves every other id alone", () => {
    const p = plugin(true, ON)
    expect(resolve(p, "react")).toBeNull()
    expect(load(p, "/src/main.tsx")).toBeNull()
  })
})
