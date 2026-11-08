/**
 * `engine_environments` — each environment (staging, production; one shared
 * database) records what its pinned Cast Swap plugin supports, so publishing a
 * trend can check every environment's engine (Trends spec D17), and what its
 * platform (the app itself) takes of the data they share: its claim.
 *
 * What must hold for the ENGINE RECORD, as before the claim: a record is an
 * upsert keyed by the environment that also moves `updated_at` (a column
 * default fires on insert only); a list maps rows to camelCase and THROWS on a
 * database error (an outage must never read as "no environment supports it");
 * the boot hook writes only on a cloud install that knows its Railway
 * environment, skips a name the table would refuse, and never rejects — boot
 * must not wait on it or fail because of it.
 *
 * And for the PLATFORM CLAIM (decided 2026-11-03, "beat only the claim"): it
 * is two columns of its own (`platform_supports`, `platform_claimed_at`,
 * migration 592), written only by the heartbeat as an update of those two
 * alone, so a beat never changes the engine record (byte for byte) and a boot
 * write never changes the claim; and a claim counts only while its OWN time is
 * fresh, whatever the engine record's age.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"
import { argOf, type QueryResult, type RecordedQuery } from "../../../lib/__tests__/fake-supabase-query.js"
import { migrationColumnsOf } from "../../../test/migration-columns.js"

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
  PLATFORM_CLAIM_INTERVAL_MS,
  PLATFORM_CLAIM_TTL_MS,
  PLATFORM_SUPPORTS,
  TREND_PUBLISH_ENVIRONMENTS,
  listEngineEnvironments,
  platformClaimFresh,
  platformOf,
  recordEngineEnvironment,
  recordPlatformClaim,
  recordThisEngineEnvironment,
  startPlatformClaimHeartbeat,
  withFreshPlatform,
  type EngineEnvironment,
  type PlatformSupports,
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

/**
 * The table as PostgREST runs these requests: an upsert is INSERT … ON CONFLICT (env) DO UPDATE SET the columns it
 * names, and an update sets the columns it names on the rows its filter matches; neither touches another column. A
 * row's parts are compared as the JSON text they hold, so "unchanged" is byte for byte.
 */
function table() {
  const rows = new Map<string, Record<string, unknown>>()
  const respond = (q: RecordedQuery): QueryResult => {
    expect(q.table).toBe("engine_environments")
    const upsert = argOf(q, "upsert")
    if (upsert) {
      const values = structuredClone(upsert[0]) as Record<string, unknown>
      const env = values.env as string
      const before = rows.get(env) ?? { env, plugin_build_id: null, supports: {}, updated_at: "1970-01-01T00:00:00.000Z", platform_supports: null, platform_claimed_at: null }
      rows.set(env, { ...before, ...values })
      return { data: null, error: null }
    }
    const update = argOf(q, "update")
    if (update) {
      const [column, value] = argOf(q, "eq") as [string, string]
      expect(column).toBe("env")
      const row = rows.get(value)
      if (!row) return { data: [], error: null }
      Object.assign(row, structuredClone(update[0]))
      return { data: [{ env: value }], error: null }
    }
    if (argOf(q, "select")) return { data: [...rows.values()].map((r) => structuredClone(r)), error: null }
    throw new Error(`an unexpected request: ${JSON.stringify(q.ops)}`)
  }
  /** One environment's engine record, as text: what a beat must never change. */
  const engineRecord = (env: string) => {
    const r = rows.get(env)!
    return JSON.stringify([r.plugin_build_id, r.supports, r.updated_at])
  }
  /** One environment's platform claim, as text: what a boot write must never change. */
  const claim = (env: string) => {
    const r = rows.get(env)!
    return JSON.stringify([r.platform_supports, r.platform_claimed_at])
  }
  return { rows, respond, engineRecord, claim }
}

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

  it("reads every column (`*`): the claim's columns reach the database only with the promote to main, so a row without them reads alike, with no claim and no error", async () => {
    db.respond = () => ({
      data: [{ env: "staging", plugin_build_id: "b", supports: SUPPORTS, updated_at: "2026-10-20T11:00:00Z" }],
      error: null,
    })
    const [env] = await listEngineEnvironments()
    expect(argOf(db.log[0]!, "select")).toEqual(["*"])
    expect(env).toEqual({ env: "staging", pluginBuildId: "b", supports: SUPPORTS, updatedAt: "2026-10-20T11:00:00Z" })
    expect(env).not.toHaveProperty("platformClaim")
  })

  it("reads a claim from its own columns, beside the engine record; a half claim or a malformed one is none", async () => {
    const AT = "2026-11-03T11:58:00.000+00:00"
    const takes = { faceMeshMinFaceHeightPct: true }
    const base = { plugin_build_id: "b", supports: SUPPORTS, updated_at: "2026-10-20T11:00:00Z" }
    db.respond = () => ({
      data: [
        { env: "production", ...base, platform_supports: takes, platform_claimed_at: AT },
        { env: "staging", ...base, platform_supports: null, platform_claimed_at: null },
        { env: "x-no-time", ...base, platform_supports: takes, platform_claimed_at: null },
        { env: "x-no-supports", ...base, platform_supports: null, platform_claimed_at: AT },
        { env: "x-array", ...base, platform_supports: [true], platform_claimed_at: AT },
        { env: "x-text", ...base, platform_supports: "takes", platform_claimed_at: AT },
      ],
      error: null,
    })
    const [production, ...rest] = await listEngineEnvironments()
    expect(production).toEqual({
      env: "production",
      pluginBuildId: "b",
      supports: SUPPORTS,
      updatedAt: "2026-10-20T11:00:00Z",
      platformClaim: { supports: takes, at: AT },
    })
    expect(rest).toHaveLength(5)
    for (const env of rest) expect(env, env.env).not.toHaveProperty("platformClaim")
  })

  it("a `platform` key inside the engine record's supports is never a claim: only the claim's own columns count", async () => {
    db.respond = () => ({
      data: [{ env: "production", plugin_build_id: "b", supports: { ...SUPPORTS, platform: { faceMeshMinFaceHeightPct: true } }, updated_at: new Date().toISOString() }],
      error: null,
    })
    const [env] = await listEngineEnvironments()
    expect(env!.supports).toEqual(SUPPORTS)
    expect(env).not.toHaveProperty("platformClaim")
    expect(platformOf(env)).toBeUndefined()
    expect(withFreshPlatform(env!).supports).toEqual(SUPPORTS)
  })
})

describe("the columns these writes name are the table's (migrations 548 and 592)", () => {
  it("the migration scan itself works", () => {
    // A scan that silently found nothing would pass the case below.
    const columns = migrationColumnsOf("engine_environments")
    expect(columns.has("supports")).toBe(true)
    expect(columns.has("platform")).toBe(false)
  })

  it("the engine record's four, and the claim's two", async () => {
    expect([...migrationColumnsOf("engine_environments")].sort()).toEqual(["env", "platform_claimed_at", "platform_supports", "plugin_build_id", "supports", "updated_at"])
    db.respond = () => ({ data: [{ env: "staging" }], error: null })
    await recordEngineEnvironment({ env: "staging", pluginBuildId: null, supports: SUPPORTS })
    await recordPlatformClaim("staging", PLATFORM_SUPPORTS)
    const written = [argOf(db.log[0]!, "upsert")![0], argOf(db.log[1]!, "update")![0]].flatMap((row) => Object.keys(row as object))
    for (const column of written) expect(migrationColumnsOf("engine_environments").has(column), column).toBe(true)
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

  it("writes the engine record alone: the four columns it always wrote, never the claim's (an upsert sets only the columns it names)", async () => {
    process.env.RAILWAY_ENVIRONMENT_NAME = "staging"
    setPluginSupports(SUPPORTS)
    await recordThisEngineEnvironment("@nodaroai/cloud-plugins@1.2.3")
    expect(db.log).toHaveLength(1)
    const row = argOf(db.log[0]!, "upsert")![0] as Record<string, unknown>
    expect(Object.keys(row).sort()).toEqual(["env", "plugin_build_id", "supports", "updated_at"])
    expect(row.supports).toEqual(SUPPORTS)
    expect(row.supports).not.toHaveProperty("platform")
  })
})

describe("recordPlatformClaim (the heartbeat's write)", () => {
  it("an update of the claim's two columns of this environment's row, and nothing else", async () => {
    vi.useFakeTimers({ now: new Date("2026-11-03T12:00:00.000Z") })
    try {
      db.respond = () => ({ data: [{ env: "staging" }], error: null })
      await recordPlatformClaim("staging", PLATFORM_SUPPORTS)
    } finally {
      vi.useRealTimers()
    }
    expect(db.log).toHaveLength(1)
    expect(db.log[0]!.table).toBe("engine_environments")
    expect(db.log[0]!.ops).toEqual([
      { m: "update", a: [{ platform_supports: { faceMeshMinFaceHeightPct: true, prismReferenceAudioPitch: true, faceMeshLayers: true, preciseStyleRoutePhotographic: true, preciseStyleRoutePerStyle: true }, platform_claimed_at: "2026-11-03T12:00:00.000Z" }] },
      { m: "eq", a: ["env", "staging"] },
      { m: "select", a: ["env"] },
    ])
  })

  it("throws on a database error, and when no row is there to claim on (nothing is inserted)", async () => {
    db.respond = () => ({ data: null, error: { message: 'column "platform_supports" of relation "engine_environments" does not exist' } })
    await expect(recordPlatformClaim("staging", PLATFORM_SUPPORTS)).rejects.toThrow(/does not exist/)
    db.respond = () => ({ data: [], error: null })
    await expect(recordPlatformClaim("staging", PLATFORM_SUPPORTS)).rejects.toThrow(/no engine record/)
    expect(db.log.every((q) => argOf(q, "upsert") === undefined && argOf(q, "insert") === undefined)).toBe(true)
  })
})

/**
 * The heartbeat (decided 2026-11-03, "beat only the claim"): only the API
 * server starts it, once it LISTENS (server.ts), and it stops first thing on
 * SIGTERM. Each beat updates the claim's own two columns, at once and then
 * every `PLATFORM_CLAIM_INTERVAL_MS`; it never names a column of the engine
 * record, which the boot write alone owns.
 */
describe("the platform claim's heartbeat", () => {
  const NOW = new Date("2026-11-03T12:00:00.000Z")
  let stop: (() => void) | undefined
  const beats = () => db.log.filter((q) => argOf(q, "update") !== undefined)
  const OK = (env: string) => () => ({ data: [{ env }], error: null })

  beforeEach(() => {
    vi.useFakeTimers({ now: NOW })
  })
  afterEach(() => {
    stop?.()
    stop = undefined
    vi.useRealTimers()
  })

  it("the interval and the TTL: a claim every 5 minutes, stale after 15 (three missed beats)", () => {
    expect(PLATFORM_CLAIM_INTERVAL_MS).toBe(5 * 60_000)
    expect(PLATFORM_CLAIM_TTL_MS).toBe(15 * 60_000)
  })

  it("claims at once, then on its interval, each beat with its time; never an upsert or an insert; none after stop", async () => {
    process.env.RAILWAY_ENVIRONMENT_NAME = "staging"
    db.respond = OK("staging")
    stop = startPlatformClaimHeartbeat()
    await vi.advanceTimersByTimeAsync(0)
    expect(beats()).toHaveLength(1)
    expect(beats()[0]!.ops).toEqual([
      { m: "update", a: [{ platform_supports: PLATFORM_SUPPORTS, platform_claimed_at: "2026-11-03T12:00:00.000Z" }] },
      { m: "eq", a: ["env", "staging"] },
      { m: "select", a: ["env"] },
    ])
    await vi.advanceTimersByTimeAsync(PLATFORM_CLAIM_INTERVAL_MS - 1)
    expect(beats()).toHaveLength(1)
    await vi.advanceTimersByTimeAsync(1)
    expect(beats()).toHaveLength(2)
    expect(argOf(beats()[1]!, "update")![0]).toEqual({ platform_supports: PLATFORM_SUPPORTS, platform_claimed_at: "2026-11-03T12:05:00.000Z" })
    await vi.advanceTimersByTimeAsync(PLATFORM_CLAIM_INTERVAL_MS)
    expect(beats()).toHaveLength(3)
    expect(db.log).toHaveLength(3)
    expect(db.log.every((q) => argOf(q, "upsert") === undefined && argOf(q, "insert") === undefined)).toBe(true)
    stop()
    stop = undefined
    await vi.advanceTimersByTimeAsync(PLATFORM_CLAIM_INTERVAL_MS * 3)
    expect(beats()).toHaveLength(3)
    expect(vi.getTimerCount()).toBe(0)
  })

  it("a beat never changes the engine record, byte for byte: only the claim moves, and `updated_at` stays the boot's", async () => {
    process.env.RAILWAY_ENVIRONMENT_NAME = "staging"
    setPluginSupports(SUPPORTS)
    const t = table()
    db.respond = t.respond
    // The boot write (buildApp), then the server listens 30 s later and starts beating.
    await recordThisEngineEnvironment("@nodaroai/cloud-plugins@2.0.0")
    const engine = t.engineRecord("staging")
    await vi.advanceTimersByTimeAsync(30_000)
    stop = startPlatformClaimHeartbeat()
    await vi.advanceTimersByTimeAsync(PLATFORM_CLAIM_INTERVAL_MS * 3)
    expect(beats()).toHaveLength(4)
    expect(t.engineRecord("staging")).toBe(engine)
    expect(t.rows.get("staging")).toMatchObject({
      updated_at: "2026-11-03T12:00:00.000Z",
      platform_supports: { faceMeshMinFaceHeightPct: true },
      platform_claimed_at: "2026-11-03T12:15:30.000Z",
    })
    // As the admin reads it: "Reported" is the boot, the claim is fresh.
    const [env] = await listEngineEnvironments()
    expect(withFreshPlatform(env!)).toEqual({
      env: "staging",
      pluginBuildId: "@nodaroai/cloud-plugins@2.0.0",
      supports: { ...SUPPORTS, platform: { faceMeshMinFaceHeightPct: true, prismReferenceAudioPitch: true, faceMeshLayers: true, preciseStyleRoutePhotographic: true, preciseStyleRoutePerStyle: true } },
      updatedAt: "2026-11-03T12:00:00.000Z",
    })
  })

  it("a rollback: the rolled-back build's boot write is the engine record's last word, the outgoing process's beats never overwrite it, and once it stops its claim lapses within the TTL", async () => {
    process.env.RAILWAY_ENVIRONMENT_NAME = "production"
    const t = table()
    db.respond = t.respond
    // The outgoing build (its engine declares more): its boot write, then its heartbeat.
    setPluginSupports({ castSwap: { ...SUPPORTS.castSwap!, faceMeshMinFaceHeightPct: true } })
    await recordThisEngineEnvironment("@nodaroai/cloud-plugins@0.436.1")
    stop = startPlatformClaimHeartbeat()
    await vi.advanceTimersByTimeAsync(PLATFORM_CLAIM_INTERVAL_MS + 60_000)
    // The rolled-back build boots beside it (a build from before the claim): its own, older engine record.
    await recordEngineEnvironment({ env: "production", pluginBuildId: "@nodaroai/cloud-plugins@0.435.0", supports: SUPPORTS })
    const rolledBack = t.engineRecord("production")
    // The outgoing process beats on through the overlap, its newer plugin still loaded.
    await vi.advanceTimersByTimeAsync(PLATFORM_CLAIM_INTERVAL_MS * 2)
    expect(beats()).toHaveLength(4)
    expect(t.engineRecord("production")).toBe(rolledBack)
    // SIGTERM: it stops. Nothing claims again; the last claim (12:15) counts until it is 15 minutes old.
    stop()
    stop = undefined
    const [env] = await listEngineEnvironments()
    expect(env).toMatchObject({ pluginBuildId: "@nodaroai/cloud-plugins@0.435.0", supports: SUPPORTS })
    expect(platformOf(env)).toEqual(PLATFORM_SUPPORTS)
    await vi.advanceTimersByTimeAsync(PLATFORM_CLAIM_TTL_MS + 1)
    expect(beats()).toHaveLength(4)
    expect(platformOf(env)).toBeUndefined()
    expect(t.engineRecord("production")).toBe(rolledBack)
  })

  it("a boot write never changes the claim: another process's boot moves the engine record alone", async () => {
    process.env.RAILWAY_ENVIRONMENT_NAME = "staging"
    setPluginSupports(SUPPORTS)
    const t = table()
    db.respond = t.respond
    await recordThisEngineEnvironment("@nodaroai/cloud-plugins@2.0.0")
    stop = startPlatformClaimHeartbeat()
    await vi.advanceTimersByTimeAsync(0)
    const claim = t.claim("staging")
    // The video worker's internal app builds a minute later: its boot write, at its time.
    await vi.advanceTimersByTimeAsync(60_000)
    await recordThisEngineEnvironment("@nodaroai/cloud-plugins@2.0.0")
    expect(t.claim("staging")).toBe(claim)
    expect(t.rows.get("staging")!.updated_at).toBe("2026-11-03T12:01:00.000Z")
  })

  it("nothing to claim (no Railway environment name, a blank one, one the table would refuse, or off cloud): no write and no interval; the boot write is what warns", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {})
    delete process.env.RAILWAY_ENVIRONMENT_NAME
    const stops = [startPlatformClaimHeartbeat()]
    process.env.RAILWAY_ENVIRONMENT_NAME = "   "
    stops.push(startPlatformClaimHeartbeat())
    process.env.RAILWAY_ENVIRONMENT_NAME = "pr-12.preview"
    stops.push(startPlatformClaimHeartbeat())
    edition.credits = false
    process.env.RAILWAY_ENVIRONMENT_NAME = "staging"
    stops.push(startPlatformClaimHeartbeat())
    expect(vi.getTimerCount()).toBe(0)
    await vi.advanceTimersByTimeAsync(PLATFORM_CLAIM_INTERVAL_MS * 3)
    expect(db.log).toHaveLength(0)
    expect(warn).not.toHaveBeenCalled()
    for (const s of stops) s()
  })

  it("a beat that fails is swallowed and logged once until one succeeds again; nothing rejects, and it goes on", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {})
    process.env.RAILWAY_ENVIRONMENT_NAME = "production"
    // Before the claim's columns reach the database (the promote to main), as on any database error.
    db.respond = () => ({ data: null, error: { message: 'column "platform_supports" of relation "engine_environments" does not exist' } })
    stop = startPlatformClaimHeartbeat()
    await vi.advanceTimersByTimeAsync(0)
    await vi.advanceTimersByTimeAsync(PLATFORM_CLAIM_INTERVAL_MS * 2)
    // Three tries, one line.
    expect(beats()).toHaveLength(3)
    expect(error).toHaveBeenCalledTimes(1)
    // One that succeeds resets it; the next failure is said once more.
    db.respond = OK("production")
    await vi.advanceTimersByTimeAsync(PLATFORM_CLAIM_INTERVAL_MS)
    db.respond = () => ({ data: null, error: { message: "boom again" } })
    await vi.advanceTimersByTimeAsync(PLATFORM_CLAIM_INTERVAL_MS * 2)
    expect(beats()).toHaveLength(6)
    expect(error).toHaveBeenCalledTimes(2)
  })

  it("no engine record to claim on yet: nothing is inserted, it is said once as a failure, and the next beat after the boot write claims", async () => {
    const error = vi.spyOn(console, "error").mockImplementation(() => {})
    process.env.RAILWAY_ENVIRONMENT_NAME = "production"
    setPluginSupports(SUPPORTS)
    const t = table()
    db.respond = t.respond
    stop = startPlatformClaimHeartbeat()
    await vi.advanceTimersByTimeAsync(0)
    expect(t.rows.size).toBe(0)
    expect(error).toHaveBeenCalledTimes(1)
    await recordThisEngineEnvironment("@nodaroai/cloud-plugins@2.0.0")
    await vi.advanceTimersByTimeAsync(PLATFORM_CLAIM_INTERVAL_MS)
    expect(t.rows.get("production")).toMatchObject({ platform_supports: { faceMeshMinFaceHeightPct: true }, platform_claimed_at: "2026-11-03T12:05:00.000Z" })
    expect(error).toHaveBeenCalledTimes(1)
  })

  it("a beat still writing when the next one is due is not doubled", async () => {
    process.env.RAILWAY_ENVIRONMENT_NAME = "production"
    let release: (() => void) | undefined
    db.respond = () => new Promise((r) => (release = () => r({ data: [{ env: "production" }], error: null }))) as unknown as QueryResult
    stop = startPlatformClaimHeartbeat()
    await vi.advanceTimersByTimeAsync(PLATFORM_CLAIM_INTERVAL_MS * 2)
    expect(beats()).toHaveLength(1)
    release!()
    db.respond = OK("production")
    await vi.advanceTimersByTimeAsync(PLATFORM_CLAIM_INTERVAL_MS)
    expect(beats()).toHaveLength(2)
  })

  it("stopped (server.ts, first thing on SIGTERM): no beat runs after it, whatever the clock; one already in flight still lands, and none follows", async () => {
    process.env.RAILWAY_ENVIRONMENT_NAME = "production"
    let release: (() => void) | undefined
    db.respond = () => new Promise((r) => (release = () => r({ data: [{ env: "production" }], error: null }))) as unknown as QueryResult
    const stopNow = startPlatformClaimHeartbeat()
    await vi.advanceTimersByTimeAsync(0)
    expect(beats()).toHaveLength(1)
    stopNow()
    expect(vi.getTimerCount()).toBe(0)
    release!()
    await vi.advanceTimersByTimeAsync(PLATFORM_CLAIM_TTL_MS * 4)
    expect(beats()).toHaveLength(1)
  })
})

describe("a platform claim counts only while its own time is fresh, whatever the engine record's age", () => {
  const NOW = Date.parse("2026-11-03T12:00:00.000Z")
  const ago = (ms: number) => new Date(NOW - ms).toISOString()
  const TAKES = { faceMeshMinFaceHeightPct: true }
  const TWO_DAYS = 2 * 24 * 60 * 60_000
  /** An environment whose engine record was written `bootAgo` before now and, given one, whose claim `claimAgo`. */
  const env = (bootAgo: number, claimAgo?: number, supports: PlatformSupports = TAKES): EngineEnvironment => ({
    env: "production",
    pluginBuildId: null,
    supports: SUPPORTS,
    updatedAt: ago(bootAgo),
    ...(claimAgo === undefined ? {} : { platformClaim: { supports, at: ago(claimAgo) } }),
  })

  it("fresh up to the TTL, either way of the reader's clock; stale past it; an unreadable time is stale", () => {
    expect(platformClaimFresh(ago(0), NOW)).toBe(true)
    expect(platformClaimFresh(ago(PLATFORM_CLAIM_TTL_MS), NOW)).toBe(true)
    expect(platformClaimFresh(ago(PLATFORM_CLAIM_TTL_MS + 1), NOW)).toBe(false)
    expect(platformClaimFresh(ago(-60_000), NOW)).toBe(true)
    expect(platformClaimFresh(ago(-(PLATFORM_CLAIM_TTL_MS + 1)), NOW)).toBe(false)
    expect(platformClaimFresh("not a time", NOW)).toBe(false)
    expect(platformClaimFresh("", NOW)).toBe(false)
  })

  it("platformOf judges the claim's own time, never the engine record's: an old boot with a fresh claim counts; a fresh boot with a stale claim does not", () => {
    expect(platformOf(env(TWO_DAYS, 60_000), NOW)).toEqual(TAKES)
    expect(platformOf(env(60_000, 20 * 60_000), NOW)).toBeUndefined()
    expect(platformOf(env(0), NOW)).toBeUndefined()
    expect(platformOf(undefined, NOW)).toBeUndefined()
  })

  it("withFreshPlatform, the admin's view: a fresh claim as `supports.platform`; `updatedAt` the engine record's (its boot); a stale claim left out; nothing of the claim's own", () => {
    const fresh = env(TWO_DAYS, 60_000)
    expect(withFreshPlatform(fresh, NOW)).toEqual({ env: "production", pluginBuildId: null, supports: { ...SUPPORTS, platform: TAKES }, updatedAt: ago(TWO_DAYS) })
    expect(Object.keys(withFreshPlatform(fresh, NOW)).sort()).toEqual(["env", "pluginBuildId", "supports", "updatedAt"])
    const stale = env(60_000, PLATFORM_CLAIM_TTL_MS + 1)
    expect(withFreshPlatform(stale, NOW)).toEqual({ env: "production", pluginBuildId: null, supports: SUPPORTS, updatedAt: ago(60_000) })
    expect(Object.keys(withFreshPlatform(stale, NOW)).sort()).toEqual(["env", "pluginBuildId", "supports", "updatedAt"])
    expect(fresh.supports).toEqual(SUPPORTS)
  })

  it("with fake timers: a claim made now opens the hold; past the TTL the same claim closes it", () => {
    vi.useFakeTimers({ now: NOW })
    try {
      const claimed = env(TWO_DAYS, 0)
      expect(platformOf(claimed)).toEqual(TAKES)
      vi.advanceTimersByTime(PLATFORM_CLAIM_TTL_MS)
      expect(platformOf(claimed)).toEqual(TAKES)
      vi.advanceTimersByTime(1)
      expect(platformOf(claimed)).toBeUndefined()
    } finally {
      vi.useRealTimers()
    }
  })
})
