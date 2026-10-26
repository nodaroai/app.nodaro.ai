/**
 * `engine_environments` — each environment (staging, production; one shared
 * database) records what its pinned Cast Swap plugin supports, so publishing a
 * trend can check every environment's engine (Trends spec D17).
 *
 * What must hold: a record is an upsert keyed by the environment that also
 * moves `updated_at` (a column default fires on insert only); a list maps rows
 * to camelCase and THROWS on a database error (an outage must never read as
 * "no environment supports it"); the boot hook writes only on a cloud install
 * that knows its Railway environment, skips a name the table would refuse, and
 * never rejects — boot must not wait on it or fail because of it.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { argOf, type QueryResult, type RecordedQuery } from "../../../lib/__tests__/fake-supabase-query.js"

const db = vi.hoisted(() => ({
  log: [] as RecordedQuery[],
  respond: null as null | ((q: RecordedQuery) => QueryResult),
}))
const edition = vi.hoisted(() => ({ credits: true }))

vi.mock("@/lib/supabase.js", async () => {
  const { makeFakeFrom } = await import("../../../lib/__tests__/fake-supabase-query.js")
  return { supabase: { from: makeFakeFrom(db.log, (q) => db.respond!(q)) } }
})
vi.mock(import("@/lib/config.js"), async (importOriginal) => {
  const actual = await importOriginal()
  return { ...actual, hasCredits: () => edition.credits }
})

import {
  TREND_PUBLISH_ENVIRONMENTS,
  listEngineEnvironments,
  recordEngineEnvironment,
  recordThisEngineEnvironment,
} from "../engine-environments.js"
import { _resetPluginSupportsForTests, setPluginSupports } from "../../../lib/private-plugins/supports-registry.js"
import type { PluginSupports } from "../../../lib/private-plugins/types.js"
import { castSwapEnginesOf } from "../../../lib/cast-swap-engines.js"

const SUPPORTS: PluginSupports = {
  castSwap: {
    roleKinds: ["person", "location", "product", "pet"],
    fixedReferences: true,
    fullQuality: true,
    resolutions: ["480p", "720p", "1080p"],
    trendRun: true,
  },
}

let savedEnv: string | undefined

beforeEach(() => {
  db.log.length = 0
  db.respond = () => ({ data: null, error: null })
  edition.credits = true
  savedEnv = process.env.RAILWAY_ENVIRONMENT_NAME
  _resetPluginSupportsForTests()
})
afterEach(() => {
  if (savedEnv === undefined) delete process.env.RAILWAY_ENVIRONMENT_NAME
  else process.env.RAILWAY_ENVIRONMENT_NAME = savedEnv
  vi.restoreAllMocks()
})

describe("TREND_PUBLISH_ENVIRONMENTS", () => {
  it("is staging and production", () => {
    expect(TREND_PUBLISH_ENVIRONMENTS).toEqual(["staging", "production"])
  })
})

describe("recordEngineEnvironment", () => {
  it("upserts the environment's row by env, moving updated_at", async () => {
    await recordEngineEnvironment({ env: "staging", pluginBuildId: "@nodaroai/cloud-plugins@1.2.3", supports: SUPPORTS })
    expect(db.log).toHaveLength(1)
    const q = db.log[0]!
    expect(q.table).toBe("engine_environments")
    expect(argOf(q, "upsert")).toEqual([
      {
        env: "staging",
        plugin_build_id: "@nodaroai/cloud-plugins@1.2.3",
        supports: SUPPORTS,
        updated_at: expect.any(String),
      },
      { onConflict: "env" },
    ])
    const row = argOf(q, "upsert")![0] as { updated_at: string }
    expect(Number.isNaN(Date.parse(row.updated_at))).toBe(false)
  })

  it("throws on a database error", async () => {
    db.respond = () => ({ data: null, error: { message: "boom" } })
    await expect(recordEngineEnvironment({ env: "staging", pluginBuildId: null, supports: {} })).rejects.toThrow(/boom/)
  })
})

describe("listEngineEnvironments", () => {
  it("maps rows to camelCase", async () => {
    db.respond = () => ({
      data: [
        { env: "production", plugin_build_id: "@nodaroai/cloud-plugins@1.2.3", supports: SUPPORTS, updated_at: "2026-10-20T10:00:00Z" },
        { env: "staging", plugin_build_id: null, supports: null, updated_at: "2026-10-20T11:00:00Z" },
      ],
      error: null,
    })
    expect(await listEngineEnvironments()).toEqual([
      { env: "production", pluginBuildId: "@nodaroai/cloud-plugins@1.2.3", supports: SUPPORTS, updatedAt: "2026-10-20T10:00:00Z" },
      { env: "staging", pluginBuildId: null, supports: {}, updatedAt: "2026-10-20T11:00:00Z" },
    ])
    expect(db.log[0]!.table).toBe("engine_environments")
  })

  it("throws on a database error rather than reading as no environments", async () => {
    db.respond = () => ({ data: null, error: { message: "down" } })
    await expect(listEngineEnvironments()).rejects.toThrow(/down/)
  })
})

describe("recordThisEngineEnvironment (boot hook)", () => {
  it("records this environment with the loaded plugins' supports", async () => {
    process.env.RAILWAY_ENVIRONMENT_NAME = "staging"
    setPluginSupports(SUPPORTS)
    await recordThisEngineEnvironment("@nodaroai/cloud-plugins@1.2.3")
    expect(argOf(db.log[0]!, "upsert")![0]).toMatchObject({
      env: "staging",
      plugin_build_id: "@nodaroai/cloud-plugins@1.2.3",
      supports: SUPPORTS,
    })
  })

  it.each([
    ["0.397.0", ["motion-pro", "motion-lite", "seedance-2-5", "kling-4"]],
    ["new ids only", ["motion-prism", "motion-pulse"]],
  ] as const)("records a plugin's declared engines (%s) as it declares them, read as both engines", async (_gen, engines) => {
    process.env.RAILWAY_ENVIRONMENT_NAME = "production"
    const supports: PluginSupports = { castSwap: { ...SUPPORTS.castSwap!, engines, engineAliases: true } }
    setPluginSupports(supports)
    await recordThisEngineEnvironment("@nodaroai/cloud-plugins@x")
    const recorded = argOf(db.log[0]!, "upsert")![0] as { supports: PluginSupports }
    expect(recorded.supports.castSwap?.engines).toEqual(engines)
    expect(castSwapEnginesOf(recorded.supports.castSwap)).toEqual(["seedance-2-5", "kling-4"])
  })

  it("does nothing without a Railway environment name", async () => {
    delete process.env.RAILWAY_ENVIRONMENT_NAME
    await recordThisEngineEnvironment("x")
    process.env.RAILWAY_ENVIRONMENT_NAME = "   "
    await recordThisEngineEnvironment("x")
    expect(db.log).toHaveLength(0)
  })

  it("does nothing off cloud", async () => {
    edition.credits = false
    process.env.RAILWAY_ENVIRONMENT_NAME = "staging"
    await recordThisEngineEnvironment("x")
    expect(db.log).toHaveLength(0)
  })

  it("skips (with a log) a name the table would refuse", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    process.env.RAILWAY_ENVIRONMENT_NAME = "pr-12.preview"
    await recordThisEngineEnvironment("x")
    expect(db.log).toHaveLength(0)
    expect(warn).toHaveBeenCalled()
  })

  it("never rejects: a database error is logged", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {})
    process.env.RAILWAY_ENVIRONMENT_NAME = "production"
    db.respond = () => ({ data: null, error: { message: "boom" } })
    await expect(recordThisEngineEnvironment(null)).resolves.toBeUndefined()
    expect(error).toHaveBeenCalled()
  })
})
