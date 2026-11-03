// @test-watches backend/src/**/*.ts
import { beforeEach, describe, expect, it, vi } from "vitest"
import Fastify, { type FastifyInstance } from "fastify"
import ts from "typescript"
import { SCAN_TIMEOUT_MS, eachSourceFile, lineOf, parseText, walk } from "../../../lib/__tests__/source-scan.js"

/**
 * `GET /v1/cast-swap/advanced` — what a Nodaro Motion page reads to show or
 * hide its Advanced options (Prepare references and the pre-prompt): exactly
 * `{ show }`, from the settings cache, cacheable briefly, with no credential.
 *
 * What must hold:
 *  - nothing saved answers `{ show: false }`: hidden by default;
 *  - it answers what the admin saved, and nothing beside `show`;
 *  - a settings read that failed answers `{ show: false }`, uncached;
 *  - a page option only: no shipped file but the setting, its store, the
 *    settings cache and the setting's two routes imports the setting's
 *    modules or names its key, so no run, quote or engine path can read it.
 */
const h = vi.hoisted(() => ({ advanced: null as unknown, failed: false, throws: false }))

vi.mock("@/lib/supabase.js", () => ({ supabase: { from: vi.fn() } }))
vi.mock("../../../lib/app-settings.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/app-settings.js")>()),
  getAppSettings: async () => {
    if (h.throws) throw new Error("boom")
    return { nodaro_motion_advanced: h.advanced }
  },
  settingsReadFailed: () => h.failed,
}))

const { castSwapAdvancedRoutes, ADVANCED_MAX_AGE_SECONDS } = await import("../cast-swap-advanced.js")

const URL = "/v1/cast-swap/advanced"

let app: FastifyInstance

beforeEach(async () => {
  h.advanced = null
  h.failed = false
  h.throws = false
  app = Fastify({ logger: false })
  await app.register(castSwapAdvancedRoutes)
  await app.ready()
})

describe("GET /v1/cast-swap/advanced", () => {
  it("answers { show: false } when nothing is saved, with no credential, cacheable briefly", async () => {
    const res = await app.inject({ method: "GET", url: URL })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ show: false })
    expect(res.headers["cache-control"]).toBe(`public, max-age=${ADVANCED_MAX_AGE_SECONDS}`)
    expect(ADVANCED_MAX_AGE_SECONDS).toBeLessThanOrEqual(60)
  })

  it("answers what the admin saved, and only show", async () => {
    h.advanced = { show: true }
    const res = await app.inject({ method: "GET", url: URL })
    expect(res.json()).toEqual({ show: true })
    expect(res.headers["cache-control"]).toBe(`public, max-age=${ADVANCED_MAX_AGE_SECONDS}`)
    h.advanced = { show: false }
    expect((await app.inject({ method: "GET", url: URL })).json()).toEqual({ show: false })
  })

  it("answers { show: false }, uncached, when the settings could not be read", async () => {
    h.advanced = { show: true }
    h.failed = true
    let res = await app.inject({ method: "GET", url: URL })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ show: false })
    expect(res.headers["cache-control"]).toBe("no-store")
    h.failed = false
    h.throws = true
    res = await app.inject({ method: "GET", url: URL })
    expect(res.statusCode).toBe(200)
    expect(res.json()).toEqual({ show: false })
    expect(res.headers["cache-control"]).toBe("no-store")
  })
})

/** The setting's key, which is also its `AppSettings` field. */
const SETTING_KEY = "nodaro_motion_advanced"

/** A module path naming the setting's module or its store (`…/nodaro-motion-advanced.js`, `…/nodaro-motion-advanced-store.js`). */
const SETTING_MODULE = /(?:^|\/)nodaro-motion-advanced(?:-store)?(?:\.[cm]?[jt]s)?$/

/** The only shipped files (relative to backend/src) that may reach the setting. */
const READERS = [
  "ee/routes/admin-nodaro-motion-advanced.ts",
  "ee/routes/cast-swap-advanced.ts",
  "lib/app-settings.ts",
  "lib/nodaro-motion-advanced-store.ts",
  "lib/nodaro-motion-advanced.ts",
]

/**
 * Where a parsed file reaches the setting: a string naming its module (an
 * import, an export-from, a dynamic `import()`), or an identifier, property
 * name, string or template part naming its key. Comments are not AST nodes,
 * so prose naming either is never a finding. Known limit: a key or a path
 * built at run time.
 */
function settingReadsOf(sf: ts.SourceFile): string[] {
  const out: string[] = []
  walk(sf, (node) => {
    const text =
      ts.isIdentifier(node) || ts.isPrivateIdentifier(node) || ts.isStringLiteralLike(node) || ts.isTemplateLiteralToken(node)
        ? node.text
        : null
    if (text === null) return
    if (ts.isStringLiteralLike(node) && SETTING_MODULE.test(text)) out.push(`line ${lineOf(sf, node)}: "${text}"`)
    else if (text.includes(SETTING_KEY)) out.push(`line ${lineOf(sf, node)}: ${SETTING_KEY}`)
  })
  return out
}

describe("a page option only: nothing about a run, a quote or an engine reads it", () => {
  const reaches = (code: string) => settingReadsOf(parseText("probe.ts", code)).length > 0

  it("the scanner sees each way a file can reach the setting, and nothing that only resembles it", () => {
    for (const code of [
      `import { advancedShown } from "../../lib/nodaro-motion-advanced.js"`,
      `import { readNodaroMotionAdvanced } from "./nodaro-motion-advanced-store.js"`,
      `export { NODARO_MOTION_ADVANCED_KEY } from "./nodaro-motion-advanced.js"`,
      `const m = await import("../lib/nodaro-motion-advanced.js")`,
      `const show = (await getAppSettings()).nodaro_motion_advanced`,
      `const show = settings["nodaro_motion_advanced"]`,
      `const { nodaro_motion_advanced: advanced } = settings`,
      `await supabase.from("app_settings").select("value").eq("key", "nodaro_motion_advanced")`,
      "const filter = `key.eq.nodaro_motion_advanced`",
      "const filter = `${column}.eq.nodaro_motion_advanced`",
    ]) {
      expect(reaches(code), code).toBe(true)
    }
    for (const code of [
      `import { registerNodaroMotionAdvancedRoutes } from "./admin-nodaro-motion-advanced.js"`,
      `import { castSwapAdvancedRoutes } from "./ee/routes/cast-swap-advanced.js"`,
      `// reads nodaro_motion_advanced through lib/nodaro-motion-advanced.ts`,
      `const style = settings.nodaro_motion_style`,
    ]) {
      expect(reaches(code), code).toBe(false)
    }
  })

  it("no shipped file but the setting, its store, the settings cache and its two routes reaches it", { timeout: SCAN_TIMEOUT_MS }, () => {
    const found = new Map<string, string[]>()
    eachSourceFile(["nodaro-motion-advanced", SETTING_KEY], (sf, rel) => {
      const reads = settingReadsOf(sf)
      if (reads.length > 0) found.set(rel, reads)
    })
    const outside = [...found].filter(([rel]) => !READERS.includes(rel)).map(([rel, reads]) => `${rel} (${reads.join("; ")})`)
    expect(outside, `only ${READERS.join(", ")} may read ${SETTING_KEY}: it is a page option, never read for a run`).toEqual([])
    // Each allowed reader is still seen, so a scanner that stops matching fails here instead of passing quietly.
    expect([...found.keys()].sort()).toEqual([...READERS].sort())
  })
})
