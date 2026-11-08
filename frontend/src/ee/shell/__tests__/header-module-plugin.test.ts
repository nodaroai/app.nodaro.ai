// @vitest-environment node
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import type { Plugin, UserConfig } from "vite"
import { describe, expect, it } from "vitest"

import {
  installedVersion,
  isPackageInstalled,
  MEDIA_EDITOR_ID,
  mediaEditorDecision,
  SITE_A11Y_ID,
  SITE_HEADER_ID,
  SITE_LOCALE_ID,
  SITE_VERSION_FILE,
  SITE_WORLDS_FILE,
  siteHeaderDecision,
  siteHeaderModule,
} from "../header-module-plugin"

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
const A11Y_STUB = "/stub/site-a11y.ts"
const RESOLVED_A11Y = `\0${SITE_A11Y_ID}`
const MEDIA_EDITOR_STUB = "/stub/media-editor.ts"
const RESOLVED_MEDIA_EDITOR = `\0${MEDIA_EDITOR_ID}`
const FORCED_OFF = { define: { "import.meta.env.VITE_SHARED_HEADER": JSON.stringify("false") } }

function plugin(installed: boolean, env: Record<string, string>): Plugin {
  return siteHeaderModule({
    root: "/repo/frontend",
    stubPath: STUB,
    localeStubPath: LOCALE_STUB,
    a11yStubPath: A11Y_STUB,
    mediaEditorStubPath: MEDIA_EDITOR_STUB,
    isInstalled: () => installed,
    readVersion: () => (installed ? "0.12.0" : null),
    readEnv: () => env,
  })
}

/** What the build hands Rollup to write beside the bundle. */
function emitted(p: Plugin): Array<{ type: string; fileName: string; source: string }> {
  const files: Array<{ type: string; fileName: string; source: string }> = []
  const generateBundle = p.generateBundle as (this: { emitFile: (file: { type: string; fileName: string; source: string }) => string }) => void
  generateBundle.call({ emitFile: (file) => (files.push(file), file.fileName) })
  return files
}

type ConfigHook = (config: UserConfig, env: { mode: string; command: "build" | "serve" }) => Promise<UserConfig | null | void>
const runConfig = (p: Plugin, command: "build" | "serve") => (p.config as ConfigHook)({}, { mode: "production", command })
const resolve = (p: Plugin, id: string) => (p.resolveId as (id: string) => string | null)(id)
const load = (p: Plugin, id: string) => (p.load as (id: string) => string | null)(id)

const ON = { VITE_EDITION: "cloud", VITE_SHARED_HEADER: "true" }

describe("mediaEditorDecision", () => {
  it.each([
    ["cloud", true, "package"],
    ["cloud", false, "stub"],
    ["community", true, "stub"],
    ["business", true, "stub"],
    [undefined, true, "stub"],
  ] as const)("edition=%s, installed=%s → %s", (edition, installed, expected) => {
    expect(mediaEditorDecision(edition, installed)).toBe(expected)
  })
})

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

describe("installedVersion", () => {
  it("reads the version from the installed package's own manifest; null when absent or unreadable", () => {
    const root = mkdtempSync(join(tmpdir(), "site-header-version-"))
    try {
      const frontend = join(root, "frontend")
      mkdirSync(frontend)
      expect(installedVersion(frontend)).toBeNull()
      const pkg = join(root, "node_modules", "@nodaroai", "shell")
      mkdirSync(pkg, { recursive: true })
      writeFileSync(join(pkg, "package.json"), "{not json")
      expect(installedVersion(frontend)).toBeNull()
      writeFileSync(join(pkg, "package.json"), JSON.stringify({ name: "@nodaroai/shell", version: "0.12.0" }))
      expect(installedVersion(frontend)).toBe("0.12.0")
    } finally {
      rmSync(root, { recursive: true, force: true })
    }
  })
})

describe("the site's shell-version.json", () => {
  it("a cloud build publishes the version it installed and whether the site shows the header", async () => {
    // Never the package's name: the file is served to anyone.
    const cases = [
      [true, ON, { version: "0.12.0", header: true }],
      // The package is installed for the media editor, the header off.
      [true, { VITE_EDITION: "cloud" }, { version: "0.12.0", header: false }],
      [false, { VITE_EDITION: "cloud" }, { version: null, header: false }],
    ] as const
    for (const [installed, env, expected] of cases) {
      const p = plugin(installed, env)
      await runConfig(p, "build")
      const files = emitted(p)
      expect(files.map((f) => [f.type, f.fileName])).toEqual([
        ["asset", SITE_VERSION_FILE],
        ["asset", SITE_WORLDS_FILE],
      ])
      expect(JSON.parse(files[0]?.source ?? "")).toEqual(expected)
    }
  })

  it("beside it, where the worlds row leads: the build's own origins, the App's tab on the site itself", async () => {
    const worlds = async (installed: boolean, env: Record<string, string>) => {
      const p = plugin(installed, env)
      await runConfig(p, "build")
      return JSON.parse(emitted(p).find((f) => f.fileName === SITE_WORLDS_FILE)?.source ?? "null")
    }
    expect(await worlds(true, { ...ON, VITE_TOOLS_URL: "https://next.tools.example", VITE_STUDIO_URL: "https://studio.example" })).toEqual({
      worldsRow: true,
      worldHrefs: {
        explore: "https://next.tools.example/explore",
        image: "https://next.tools.example/image",
        video: "https://next.tools.example/video",
        music: "https://next.tools.example/music",
        trends: "https://next.tools.example/trends",
        motion: "https://next.tools.example/video/cast-swap",
        voice: "https://next.tools.example/voice-changer",
        studio: "https://studio.example/",
        app: "/projects",
      },
    })
    // No origins set: the header keeps its own for the rest.
    expect(await worlds(true, ON)).toEqual({ worldsRow: true, worldHrefs: { app: "/projects" } })
    // A site that does not show the header shows no row.
    expect(await worlds(true, { VITE_EDITION: "cloud", VITE_TOOLS_URL: "https://next.tools.example" })).toEqual({ worldsRow: false, worldHrefs: {} })
  })

  it("no other build, and no dev server, writes one", async () => {
    for (const env of [{ ...ON, VITE_EDITION: "community" }, { ...ON, VITE_EDITION: "business" }, {}]) {
      const p = plugin(true, env)
      await runConfig(p, "build")
      expect(emitted(p)).toEqual([])
    }
    const dev = plugin(true, ON)
    await runConfig(dev, "serve")
    expect(emitted(dev)).toEqual([])
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

  it("the shared accessibility choices follow the same decision, as an adapter of their own", async () => {
    const on = plugin(true, ON)
    await runConfig(on, "build")
    expect(resolve(on, SITE_A11Y_ID)).toBe(RESOLVED_A11Y)
    const source = load(on, RESOLVED_A11Y) ?? ""
    expect(source).toMatch(/^import ".+\/a11y\.css"$/m)
    // The package's own reader, cookie writer and boot call: the app keeps no copy of the cookie format.
    expect(source).toMatch(/^import \{ applySavedAccessibility, readAccessibility, saveAccessibility \} from ".+\/a11y"$/m)
    expect(source).toContain("save: (state) => saveAccessibility(state)")
    expect(source).not.toMatch(/a11y-cookie/)
    expect(source).toMatch(/export const sharedAccessibility = /)
    expect(source).not.toMatch(/shell\.css|NodaroShell/)

    for (const [installed, env] of [
      [true, { ...ON, VITE_EDITION: "community" }],
      [false, { VITE_EDITION: "cloud" }],
    ] as const) {
      const off = plugin(installed, env)
      await runConfig(off, "build")
      expect(resolve(off, SITE_A11Y_ID)).toBe(A11Y_STUB)
    }
  })

  it("the media editor is the package on every cloud build that has it, the header flag on or off", async () => {
    for (const env of [ON, { VITE_EDITION: "cloud" }, { VITE_EDITION: "cloud", VITE_SHARED_HEADER: "false" }]) {
      const on = plugin(true, env)
      await runConfig(on, "build")
      expect(resolve(on, MEDIA_EDITOR_ID)).toBe(RESOLVED_MEDIA_EDITOR)
      const source = load(on, RESOLVED_MEDIA_EDITOR) ?? ""
      expect(source).toMatch(/^import ".+\/shell\.css"$/m)
      expect(source).toMatch(/^export \* from ".+\/media-editor"$/m)
      expect(source).toMatch(/^export const mediaEditorAvailable = true$/m)
      expect(source).not.toMatch(/NodaroShell/)
    }
    // The header itself stays off without the flag.
    const headerOff = plugin(true, { VITE_EDITION: "cloud" })
    await runConfig(headerOff, "build")
    expect(resolve(headerOff, SITE_HEADER_ID)).toBe(STUB)

    for (const [installed, env] of [
      [true, { ...ON, VITE_EDITION: "community" }],
      [true, { ...ON, VITE_EDITION: "business" }],
      [false, { VITE_EDITION: "cloud" }],
    ] as const) {
      const off = plugin(installed, env)
      await runConfig(off, "build")
      expect(resolve(off, MEDIA_EDITOR_ID)).toBe(MEDIA_EDITOR_STUB)
    }
    // The dev server with the flag on and no package: the stub too.
    const missing = plugin(false, ON)
    await runConfig(missing, "serve")
    expect(resolve(missing, MEDIA_EDITOR_ID)).toBe(MEDIA_EDITOR_STUB)
  })

  it("resolves the media editor adapter's imports of the package from the frontend directory", async () => {
    const p = plugin(true, ON)
    await runConfig(p, "build")
    const context = { resolve: async (id: string) => ({ id: `/resolved/${id}` }) }
    const resolveId = p.resolveId as (this: typeof context, id: string, importer?: string) => Promise<unknown> | unknown
    const source = load(p, RESOLVED_MEDIA_EDITOR) ?? ""
    const css = source.match(/^import "(.+)"$/m)?.[1] ?? ""
    const entry = source.match(/from "(.+\/media-editor)"$/m)?.[1] ?? ""
    expect(await resolveId.call(context, css, RESOLVED_MEDIA_EDITOR)).toEqual({ id: `/resolved/${css}` })
    expect(await resolveId.call(context, entry, RESOLVED_MEDIA_EDITOR)).toEqual({ id: `/resolved/${entry}` })
  })

  it("resolves the accessibility adapter's import of the package from the frontend directory", async () => {
    const p = plugin(true, ON)
    await runConfig(p, "build")
    const context = { resolve: async (id: string) => ({ id: `/resolved/${id}` }) }
    const resolveId = p.resolveId as (this: typeof context, id: string, importer?: string) => Promise<unknown> | unknown
    const pkgImport = (load(p, RESOLVED_A11Y) ?? "").match(/from "(.+\/a11y)"$/m)?.[1] ?? ""
    expect(await resolveId.call(context, pkgImport, RESOLVED_A11Y)).toEqual({ id: `/resolved/${pkgImport}` })
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
      a11yStubPath: A11Y_STUB,
      mediaEditorStubPath: MEDIA_EDITOR_STUB,
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
