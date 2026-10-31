/**
 * The lane history scripts' contract — what history-scripts.ts and the plain
 * commands the history reads with promise whatever stores them: run against
 * the JS twin (`history-scripts.test.ts`) and against a real Redis with the
 * real Lua (`history-scripts.redis.test.ts`). Every case gets its own key
 * prefix, deleted after.
 */
import { afterEach, beforeEach, expect, it } from "vitest"
import type { HistoryClient } from "../history.js"
import { historyKeys, LANE_HISTORY_SCRIPTS, type LaneHistoryScriptName } from "../history-scripts.js"

export interface HistoryScriptsFixture {
  client: HistoryClient
  /** The history prefix of this case (`…hist:<env>:`). */
  prefix: string
  /** Every key under the prefix. */
  keys: () => Promise<string[]>
  /** A key's remaining TTL in ms; null when it has none. */
  ttlOf: (key: string) => Promise<number | null>
  cleanup: () => Promise<void>
}

const TTL = 3 * 86_400_000
const DAY = "2026-10-30"
const M = 29_356_000 // an epoch minute

export function runHistoryScriptsContract(makeFixture: () => HistoryScriptsFixture): void {
  let f: HistoryScriptsFixture
  beforeEach(() => { f = makeFixture() })
  afterEach(async () => { await f?.cleanup() })

  const run = async (name: LaneHistoryScriptName, req: Record<string, unknown>) =>
    JSON.parse(String(await f.client.eval(LANE_HISTORY_SCRIPTS[name], 0, f.prefix, TTL, JSON.stringify(req)))) as Record<string, unknown>
  const sample = (over: Record<string, unknown> = {}) =>
    run("sample", { day: DAY, enforced: false, lines: [], providers: [], outcomes: [], ...over })
  const lineOf = (line: string, day = DAY) => f.client.hgetall(historyKeys.line(f.prefix, day, line))
  const provOf = (p: string, day = DAY) => f.client.hgetall(historyKeys.provider(f.prefix, day, p))
  /** Take the day's dirty sets and read their members (sorted). */
  const takeAll = async (day = DAY) => {
    const t = await run("take", { day })
    const members = async (key: string) => {
      const out: string[] = []
      let cursor = "0"
      do {
        const [next, page] = await f.client.sscan(key, cursor, "COUNT", 100)
        cursor = next
        out.push(...page)
      } while (cursor !== "0")
      return [...new Set(out)].sort()
    }
    return {
      minutes: t.minutes as Record<string, string> | null,
      lines: t.lines === true ? await members(historyKeys.linesWork(f.prefix, day)) : [],
      providers: t.providers === true ? await members(historyKeys.providersWork(f.prefix, day)) : [],
    }
  }
  const done = (day = DAY) => f.client.unlink(historyKeys.linesWork(f.prefix, day), historyKeys.providersWork(f.prefix, day))

  it("peaks merge by maximum, field by field", async () => {
    await sample({ lines: [{ line: "user:U|U", max: { "r:provider": 3, "q:provider": 0, lw: 500, "s:mcp": 2 }, atLimit: false }] })
    await sample({ lines: [{ line: "user:U|U", max: { "r:provider": 1, "q:provider": 4, lw: 200, "s:mcp": 1, "s:web": 1 }, atLimit: false }] })
    expect(await lineOf("user:U|U")).toEqual({ "r:provider": "3", "q:provider": "4", lw: "500", "s:mcp": "2", "s:web": "1" })
  })

  it("each sample counts its minute, the enforced ones apart, and the minutes are taken once per change", async () => {
    const line = { line: "user:U|U", max: { "r:llm": 2 }, atLimit: true }
    const provider = { p: "kie", running: 3, ceiling: 3, atCeiling: true }
    await sample({ lines: [line], providers: [provider], enforced: true })
    await sample({ lines: [line], providers: [provider], enforced: false })
    expect(await lineOf("user:U|U")).toMatchObject({ mal: "2" })
    expect(await provOf("kie")).toMatchObject({ pk: "3", ceil: "3", mac: "2" })
    expect((await takeAll()).minutes).toEqual({ sampled: "2", enforced: "1" })
    expect((await takeAll()).minutes).toBeNull()
  })

  it("only a line or provider whose numbers changed is marked dirty", async () => {
    const quiet = { line: "user:Q|Q", max: { "r:provider": 1 }, atLimit: false }
    await sample({ lines: [quiet, { line: "user:U|U", max: { "r:provider": 1 }, atLimit: false }], providers: [{ p: "kie", running: 1, ceiling: null, atCeiling: false }] })
    expect(await takeAll()).toMatchObject({ lines: ["user:Q|Q", "user:U|U"], providers: ["kie"] })
    await done()
    // The same numbers again (no counter moving): nothing is dirty.
    await sample({ lines: [quiet], providers: [{ p: "kie", running: 1, ceiling: null, atCeiling: false }] })
    expect(await takeAll()).toMatchObject({ lines: [], providers: [] })
    // A raised peak, a minute at the limit, a new ceiling: dirty again.
    await sample({ lines: [quiet, { line: "user:U|U", max: { "r:provider": 0 }, atLimit: true }, { line: "user:V|V", max: {}, atLimit: false }], providers: [{ p: "kie", running: 1, ceiling: 4, atCeiling: false }] })
    expect(await takeAll()).toMatchObject({ lines: ["user:U|U"], providers: ["kie"] })
  })

  it("a provider's ceiling is the last one seen; none clears it", async () => {
    await sample({ providers: [{ p: "kie", running: 1, ceiling: 5, atCeiling: false }] })
    expect(await provOf("kie")).toMatchObject({ ceil: "5" })
    await takeAll()
    await done()
    await sample({ providers: [{ p: "kie", running: 1, ceiling: null, atCeiling: false }] })
    expect(await provOf("kie")).not.toHaveProperty("ceil")
    expect(await takeAll()).toMatchObject({ providers: ["kie"] })
  })

  it("outcome buckets overwrite their own minute, on the bucket's own day; an unchanged bucket is not dirty", async () => {
    await sample({ outcomes: [{ p: "kie", day: DAY, minute: M, completed: 1, failed: 0 }] })
    await sample({ outcomes: [{ p: "kie", day: DAY, minute: M, completed: 3, failed: 1 }, { p: "kie", day: "2026-10-29", minute: M - 2000, completed: 2, failed: 0 }] })
    expect(await provOf("kie")).toEqual({ [`o:${M}:c`]: "3", [`o:${M}:f`]: "1" })
    expect(await provOf("kie", "2026-10-29")).toEqual({ [`o:${M - 2000}:c`]: "2", [`o:${M - 2000}:f`]: "0" })
    expect(await takeAll("2026-10-29")).toMatchObject({ providers: ["kie"] })
    await done("2026-10-29")
    await sample({ outcomes: [{ p: "kie", day: "2026-10-29", minute: M - 2000, completed: 2, failed: 0 }] })
    expect(await takeAll("2026-10-29")).toMatchObject({ providers: [] })
  })

  it("count adds one event, keeps the longest wait and always marks its line dirty", async () => {
    await run("count", { day: DAY, line: "user:U|U", field: "qt", waitedMs: 7_200_000 })
    await run("count", { day: DAY, line: "user:U|U", field: "qt", waitedMs: 7_100_000 })
    await run("count", { day: DAY, line: "workspace:W|U", field: "lwe", waitedMs: 600_000 })
    expect(await lineOf("user:U|U")).toEqual({ qt: "2", lw: "7200000" })
    expect(await lineOf("workspace:W|U")).toEqual({ lwe: "1", lw: "600000" })
    expect(await takeAll()).toMatchObject({ lines: ["user:U|U", "workspace:W|U"] })
  })

  it("a work set a failed flush left is merged with what changed since, not lost", async () => {
    await run("count", { day: DAY, line: "user:A|A", field: "qt", waitedMs: 1 })
    expect(await takeAll()).toMatchObject({ lines: ["user:A|A"] })
    // Not written (no unlink); B changes meanwhile.
    await run("count", { day: DAY, line: "user:B|B", field: "qt", waitedMs: 1 })
    expect(await takeAll()).toMatchObject({ lines: ["user:A|A", "user:B|B"] })
    await done()
    expect(await takeAll()).toMatchObject({ lines: [], providers: [], minutes: null })
  })

  it("a work set is read whole in pages", async () => {
    const lines = Array.from({ length: 450 }, (_, i) => ({ line: `user:${i}|${i}`, max: { "r:run": 1 }, atLimit: false }))
    await sample({ lines })
    expect((await takeAll()).lines).toHaveLength(450)
  })

  it("a day with nothing takes nothing and reads as empty", async () => {
    expect(await takeAll("2026-01-01")).toEqual({ lines: [], providers: [], minutes: null })
    expect(await lineOf("user:U|U", "2026-01-01")).toEqual({})
  })

  it("a claim is had once within its TTL", async () => {
    expect(await run("claim", { name: "tick:1", ttlMs: 180_000 })).toEqual({ claimed: true })
    expect(await run("claim", { name: "tick:1", ttlMs: 180_000 })).toEqual({ claimed: false })
    expect(await run("claim", { name: "tick:2", ttlMs: 180_000 })).toEqual({ claimed: true })
    expect(await f.ttlOf(`${f.prefix}claim:tick:1`)).toBeLessThanOrEqual(180_000)
  })

  it("every key written expires", async () => {
    await sample({
      enforced: true,
      lines: [{ line: "user:U|U", max: { "r:provider": 1 }, atLimit: true }],
      providers: [{ p: "kie", running: 1, ceiling: 1, atCeiling: true }],
      outcomes: [{ p: "kie", day: DAY, minute: M, completed: 1, failed: 0 }],
    })
    await run("count", { day: DAY, line: "user:V|V", field: "lwe", waitedMs: 1 })
    await run("claim", { name: "prune:x", ttlMs: 60_000 })
    await run("take", { day: DAY })
    await sample({ lines: [{ line: "user:W|W", max: { "r:run": 1 }, atLimit: false }] }) // fresh dirty sets beside the work sets
    await f.client.set(historyKeys.minutesDirty(f.prefix, DAY), "1", "PX", TTL)
    const keys = await f.keys()
    expect(keys.length).toBeGreaterThanOrEqual(10)
    for (const k of keys) expect(await f.ttlOf(k), k).toBeGreaterThan(0)
  })
}
