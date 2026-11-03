import { describe, expect, it, vi } from "vitest"
import { KIE_CREDIT_USD } from "../../../../providers/kie/models.js"
import type { FetchAllResult, KieLogRecord } from "../../../../providers/kie/credit-lookup.js"
import {
  KIE_PAGE_CAP_RECORDS,
  KIE_WINDOW_TAIL_MS,
  MAX_KIE_TASKS,
  kieFailureMessage,
  kieUsdSchema,
  motionTaskIdsOf,
  noMotionTasks,
  readKieReal,
} from "../kie-real.js"
import type { KieRealResult } from "../wire.js"

const FROM = new Date("2026-10-01T00:00:00.000Z")
const TO = new Date("2026-10-08T00:00:00.000Z")
const LATER = new Date("2026-11-03T12:00:00.000Z")
const TOKEN = "kie-session-token-SECRET-0123456789"

const rec = (taskId: string, consumeCredits: unknown, state = "success"): KieLogRecord => ({
  taskId, consumeCredits: consumeCredits as number, remainedCredits: 0, model: "m", state,
  createTime: 0, completeTime: 0, costTime: 0, _source: "generic",
})

const logs = (records: KieLogRecord[], over: Partial<FetchAllResult> = {}): FetchAllResult => ({
  records, sources: { generic: records.length }, errors: {}, rawSamples: { generic: { token: TOKEN } }, ...over,
})

const fake = (result: FetchAllResult) => vi.fn(async (..._args: [string, number, number]) => result)

async function read(result: FetchAllResult, ids: string[], now = LATER) {
  const fetchLogs = fake(result)
  const out = await readKieReal({ token: TOKEN, from: FROM, to: TO, now, motionTaskIds: new Set(ids) }, fetchLogs)
  return { out, fetchLogs }
}

const ok = (out: KieRealResult | { failed: Record<string, string> }): KieRealResult => {
  if ("failed" in out) throw new Error("expected a result")
  return out
}

describe("readKieReal", () => {
  it("reads KIE's logs from the range's start to 3 h after its end, never past now", async () => {
    expect(KIE_WINDOW_TAIL_MS).toBe(3 * 3600_000)
    const late = await read(logs([]), ["t-1"])
    expect(late.fetchLogs).toHaveBeenCalledWith(TOKEN, FROM.getTime(), TO.getTime() + KIE_WINDOW_TAIL_MS)
    expect(ok(late.out).window).toEqual({ from: FROM.toISOString(), to: new Date(TO.getTime() + KIE_WINDOW_TAIL_MS).toISOString() })

    const soon = new Date(TO.getTime() + 3600_000)
    const early = await read(logs([]), ["t-1"], soon)
    expect(early.fetchLogs).toHaveBeenCalledWith(TOKEN, FROM.getTime(), soon.getTime())
    expect(ok(early.out).window.to).toBe(soon.toISOString())
  })

  it("keeps only the Motion tasks, in any state, each at its credits times KIE's credit price", async () => {
    const { out } = await read(logs([rec("t-1", 100), rec("t-2", 40, "fail"), rec("other", 999)]), ["t-1", "t-2", "t-3"])
    expect(ok(out)).toEqual({
      kieUsd: { "t-1": 100 * KIE_CREDIT_USD, "t-2": 40 * KIE_CREDIT_USD },
      window: { from: FROM.toISOString(), to: new Date(TO.getTime() + KIE_WINDOW_TAIL_MS).toISOString() },
      motionTasks: 3,
      matched: 2,
      truncated: false,
      kieRecords: 3,
      capped: [],
      errors: {},
      fetchedAt: LATER.toISOString(),
    })
  })

  it("passes an endpoint's error through beside the matched map", async () => {
    const { out } = await read(logs([rec("t-1", 10)], { errors: { "veo-generate": "401 — session token expired" } }), ["t-1"])
    expect(ok(out).kieUsd).toEqual({ "t-1": 10 * KIE_CREDIT_USD })
    expect(ok(out).errors).toEqual({ "veo-generate": "401 — session token expired" })
  })

  it("no records with errors is a failure, the errors its reason", async () => {
    const errors = { generic: "401 — session token expired", "suno-audio": "HTTP 500" }
    expect((await read(logs([], { errors, sources: {} }), ["t-1"])).out).toEqual({ failed: errors })
  })

  it("no records and no errors is an empty map, not a failure", async () => {
    const out = ok((await read(logs([], { sources: {} }), ["t-1"])).out)
    expect(out).toMatchObject({ kieUsd: {}, matched: 0, kieRecords: 0, motionTasks: 1, truncated: false })
  })

  it("lists an endpoint at the page cap in capped: it may have been cut short", async () => {
    expect(KIE_PAGE_CAP_RECORDS).toBe(5_000)
    const sources = { generic: 5_000, "veo-generate": 12, "suno-audio": 4_999 }
    const out = ok((await read(logs([rec("t-1", 1)], { sources }), ["t-1"])).out)
    expect(out.capped).toEqual(["generic"])
  })

  it("10,001 matches keep 10,000 and say it was truncated", async () => {
    expect(MAX_KIE_TASKS).toBe(10_000)
    const ids = Array.from({ length: 10_001 }, (_, i) => `t-${i}`)
    const out = ok((await read(logs(ids.map((id) => rec(id, 2))), ids)).out)
    expect(Object.keys(out.kieUsd)).toHaveLength(10_000)
    expect(out.kieUsd["t-0"]).toBe(2 * KIE_CREDIT_USD)
    expect(out.kieUsd["t-10000"]).toBeUndefined()
    expect(out).toMatchObject({ matched: 10_001, truncated: true, motionTasks: 10_001, kieRecords: 10_001 })
    expect(kieUsdSchema.safeParse(out.kieUsd).success).toBe(true)
  })

  it("reads a figure as a number (a numeric string too), leaves any other out", async () => {
    const records = [rec("t-1", "12"), rec("t-2", "abc"), rec("t-3", -5), rec("t-4", Number.NaN), rec("t-5", null), rec("t-6", 0)]
    const out = ok((await read(logs(records), ["t-1", "t-2", "t-3", "t-4", "t-5", "t-6"])).out)
    expect(out.kieUsd).toEqual({ "t-1": 12 * KIE_CREDIT_USD, "t-6": 0 })
    expect(out.matched).toBe(2)
  })

  it("a task seen twice keeps its first record; an empty or over-long task id never matches", async () => {
    const long = "x".repeat(201)
    const records = [rec("t-1", 3), rec("t-1", 9), rec("", 4), rec(long, 5)]
    const out = ok((await read(logs(records), ["t-1", "", long])).out)
    expect(out.kieUsd).toEqual({ "t-1": 3 * KIE_CREDIT_USD })
  })

  it("its kieUsd is what the runs routes take back", async () => {
    const out = ok((await read(logs([rec("t-1", 100), rec("t-2", "7.5")]), ["t-1", "t-2"])).out)
    expect(kieUsdSchema.parse(out.kieUsd)).toEqual(out.kieUsd)
  })

  it("never answers with the token: an error that quotes it is scrubbed, KIE's raw samples are never passed on", async () => {
    const quoting = { generic: `Headers.append: "${TOKEN}\\n" is an invalid header value.` }
    const partial = ok((await read(logs([rec("t-1", 1)], { errors: quoting }), ["t-1"])).out)
    expect(JSON.stringify(partial)).not.toContain(TOKEN)
    expect(partial.errors.generic).toContain("invalid header value")
    const failed = (await read(logs([], { errors: quoting, sources: {} }), ["t-1"])).out
    expect(JSON.stringify(failed)).not.toContain(TOKEN)
    expect(failed).toHaveProperty("failed.generic")
  })

  it("trims a token pasted with whitespace around it: KIE gets it trimmed, and it is scrubbed from every error", async () => {
    // fetch trims a header value before it checks it, and its error quotes the trimmed value.
    const quoting = { generic: `Headers.append: "${TOKEN}" is an invalid header value.` }
    for (const pasted of [`  ${TOKEN}\n`, `\t${TOKEN} `]) {
      const fetchLogs = fake(logs([rec("t-1", 1)], { errors: quoting }))
      const out = await readKieReal({ token: pasted, from: FROM, to: TO, now: LATER, motionTaskIds: new Set(["t-1"]) }, fetchLogs)
      expect(fetchLogs).toHaveBeenCalledWith(TOKEN, FROM.getTime(), TO.getTime() + KIE_WINDOW_TAIL_MS)
      expect(JSON.stringify(out)).not.toContain(TOKEN)
      const failedOut = await readKieReal(
        { token: pasted, from: FROM, to: TO, now: LATER, motionTaskIds: new Set(["t-1"]) },
        fake(logs([], { errors: quoting, sources: {} })),
      )
      expect(JSON.stringify(failedOut)).not.toContain(TOKEN)
    }
  })
})

describe("kieFailureMessage", () => {
  it("blames the token only when every endpoint refused it", () => {
    const refused = kieFailureMessage({ generic: "401 — session token expired", "veo-generate": "code 401 — session token expired" })
    expect(refused).toMatch(/token/i)
    expect(refused).toMatch(/expired/)
  })

  it("names the real cause when it is not the token's", () => {
    const message = kieFailureMessage({ generic: "HTTP 500", "veo-generate": "This operation was aborted due to timeout", "suno-audio": "HTTP 500" })
    expect(message).toBe("KIE's logs could not be read: HTTP 500; This operation was aborted due to timeout")
    expect(message).not.toMatch(/token/i)
  })

  it("names every distinct cause when some endpoints refused the token and others failed otherwise", () => {
    expect(kieFailureMessage({ generic: "HTTP 502", "veo-generate": "401 — session token expired" })).toBe(
      "KIE's logs could not be read: HTTP 502; 401 — session token expired",
    )
  })

  it("names at most three causes, each kept short", () => {
    const message = kieFailureMessage({ a: "HTTP 500", b: "HTTP 502", c: "HTTP 503", d: "HTTP 504", e: "x".repeat(400) })
    expect(message).toBe("KIE's logs could not be read: HTTP 500; HTTP 502; HTTP 503; and 2 more")
    expect(kieFailureMessage({ a: "y".repeat(400) }).length).toBeLessThan(250)
    expect(kieFailureMessage({})).toBe("KIE's logs could not be read.")
  })
})

describe("noMotionTasks", () => {
  it("is the empty answer over the same window, KIE never asked", () => {
    expect(noMotionTasks({ from: FROM, to: TO, now: LATER })).toEqual({
      kieUsd: {},
      window: { from: FROM.toISOString(), to: new Date(TO.getTime() + KIE_WINDOW_TAIL_MS).toISOString() },
      motionTasks: 0,
      matched: 0,
      truncated: false,
      kieRecords: 0,
      capped: [],
      errors: {},
      fetchedAt: LATER.toISOString(),
    })
  })
})

describe("motionTaskIdsOf", () => {
  it("reads the task ids function's one array: its usable ids, each once", () => {
    expect([...motionTaskIdsOf(["t-1", "t-2", "t-1", "", 7, null, "x".repeat(201)])]).toEqual(["t-1", "t-2"])
    expect(motionTaskIdsOf(null).size).toBe(0)
    expect(motionTaskIdsOf([{ task_id: "t-1" }]).size).toBe(0)
  })

  it("keeps every id past PostgREST's 1,000-row cap", () => {
    expect(motionTaskIdsOf(Array.from({ length: 1_001 }, (_, i) => `t-${i}`)).size).toBe(1_001)
  })
})

describe("kieUsdSchema", () => {
  it("takes task ids of 1 to 200 characters to a finite figure of 0 or more, at most 10,000 of them", () => {
    expect(kieUsdSchema.safeParse({ "t-1": 0.5, "t-2": 0 }).success).toBe(true)
    expect(kieUsdSchema.safeParse({ "t-1": -0.01 }).success).toBe(false)
    expect(kieUsdSchema.safeParse({ "t-1": Number.POSITIVE_INFINITY }).success).toBe(false)
    expect(kieUsdSchema.safeParse({ "t-1": "0.5" }).success).toBe(false)
    expect(kieUsdSchema.safeParse({ "": 1 }).success).toBe(false)
    expect(kieUsdSchema.safeParse({ ["x".repeat(201)]: 1 }).success).toBe(false)
    expect(kieUsdSchema.safeParse(Object.fromEntries(Array.from({ length: 10_001 }, (_, i) => [`t-${i}`, 1]))).success).toBe(false)
    expect(kieUsdSchema.safeParse(Object.fromEntries(Array.from({ length: 10_000 }, (_, i) => [`t-${i}`, 1]))).success).toBe(true)
  })
})
