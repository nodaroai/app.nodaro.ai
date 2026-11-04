import { afterEach, describe, expect, it, vi } from "vitest"
import { KIE_CREDIT_USD } from "../../../../providers/kie/models.js"
import { normalizeRecord, type FetchAllResult, type KieLogRecord } from "../../../../providers/kie/credit-lookup.js"
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

// The real log reader needs the account id; KIE's own answers are faked at fetch.
vi.mock("@/lib/config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../../../lib/config.js")>()
  return { ...actual, config: { ...actual.config, KIE_UNIQUE_ID: "kie-account" } }
})

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

  it("keeps only the Motion tasks, each at its credits times KIE's credit price, a failed task's credits too", async () => {
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

describe("over the real log reader, KIE's answers faked at fetch", () => {
  const isGeneric = (url: unknown) => String(url).includes("pageRecordListByDoris")

  /** KIE's generic log; `recordsOf` answers its records for a page, every other endpoint has none. */
  function fakeKie(pages: number, recordsOf: (page: number, pageSize: number) => object[]) {
    const fetchMock = vi.fn(async (url: unknown, init?: RequestInit) => {
      const { pageNum, pageSize } = JSON.parse(String(init?.body)) as { pageNum: number; pageSize: number }
      const records = isGeneric(url) ? recordsOf(pageNum, pageSize) : []
      return new Response(JSON.stringify({ code: 200, data: { records, pages } }), { status: 200 })
    })
    vi.stubGlobal("fetch", fetchMock)
    return fetchMock
  }
  const page = (pageNum: number, size: number) =>
    Array.from({ length: size }, (_, i) => ({ taskId: `t-${pageNum}-${i}`, consumeCredits: 1, state: "success" }))
  const readReal = async (ids: string[]) => ok(await readKieReal({ token: TOKEN, from: FROM, to: TO, now: LATER, motionTaskIds: new Set(ids) }))

  afterEach(() => vi.unstubAllGlobals())

  it("an endpoint the reader stopped reading at its page cap is listed in capped: later records were not read", async () => {
    const fetchMock = fakeKie(200, (pageNum, size) => page(pageNum, size))
    const out = await readReal(["t-1-0"])
    expect(out.capped).toEqual(["generic"])
    expect(out.kieRecords).toBe(KIE_PAGE_CAP_RECORDS)
    expect(fetchMock.mock.calls.filter(([url]) => isGeneric(url))).toHaveLength(100)
  })

  it("an endpoint whose list ended on the cap's last page, one record short of it, is not", async () => {
    fakeKie(100, (pageNum, size) => page(pageNum, pageNum === 100 ? size - 1 : size))
    const out = await readReal(["t-1-0"])
    expect(out.capped).toEqual([])
    expect(out.kieRecords).toBe(KIE_PAGE_CAP_RECORDS - 1)
  })

  it("a task still running reads no figure, and a finished one beside it does", async () => {
    fakeKie(1, (pageNum) =>
      pageNum === 1
        ? [
            { taskId: "t-running", state: "generating", consumeCredits: 0 },
            { taskId: "t-done", state: "success", consumeCredits: 100 },
          ]
        : [],
    )
    const out = await readReal(["t-running", "t-done"])
    expect(out.kieUsd).toEqual({ "t-done": 100 * KIE_CREDIT_USD })
    expect(out).toMatchObject({ matched: 1, motionTasks: 2, kieRecords: 2 })
  })
})

describe("a task's state, as the log reader answers it from what KIE's endpoints send", () => {
  /** What the reader returns for a raw record of the task "t-1". */
  const fromKie = (fields: Record<string, unknown>): KieLogRecord => normalizeRecord({ taskId: "t-1", ...fields }, "generic")

  // A task KIE has not finished may read 0 credits, and a 0 would beat what the step records once it settles.
  it.each<[string, Record<string, unknown>]>([
    ["waiting", { state: "waiting", consumeCredits: 0 }],
    ["queuing", { state: "queuing", consumeCredits: 0 }],
    ["generating", { state: "generating", consumeCredits: 0 }],
    ["generating, with credits on the record already", { state: "generating", consumeCredits: 280 }],
    ["a running state in capitals", { state: "GENERATING", consumeCredits: 0 }],
    ["a state this reader does not know", { state: "rendering", consumeCredits: 0 }],
    ["no state and no credits", {}],
    ["no state, with credits", { consumeCredits: 280 }],
    // The reader folds whatever it cannot read as success into "fail".
    ["successFlag 0 (generating), which the reader reads as fail", { successFlag: 0, creditsConsumed: 0 }],
    ["status pending, which the reader reads as fail", { status: "pending", credits: 0 }],
    ["fail with nothing consumed", { state: "fail", consumeCredits: 0 }],
    ["fail with no credit field", { state: "fail" }],
  ])("supplies no cost: %s", async (_label, fields) => {
    const out = ok((await read(logs([fromKie(fields)]), ["t-1"])).out)
    expect(out.kieUsd).toEqual({})
    expect(out).toMatchObject({ matched: 0, motionTasks: 1, kieRecords: 1 })
  })

  it.each<[string, Record<string, unknown>, number]>([
    ["success", { state: "success", consumeCredits: 100 }, 100],
    ["success in capitals", { state: "SUCCESS", consumeCredits: 100 }, 100],
    ["completed", { state: "completed", consumeCredits: 100 }, 100],
    ["done", { state: "done", consumeCredits: 100 }, 100],
    ["status completed", { status: "completed", credits: 100 }, 100],
    ["successFlag 1", { successFlag: 1, creditsConsumed: 100 }, 100],
    ["successFlag 200", { successFlag: 200, creditsConsumed: 100 }, 100],
    ["success with nothing consumed: KIE charged nothing", { state: "success", consumeCredits: 0 }, 0],
    ["fail that consumed credits", { state: "fail", consumeCredits: 40 }, 40],
    ["failed that consumed credits", { state: "failed", consumeCredits: 40 }, 40],
    ["error that consumed credits", { state: "error", consumeCredits: 40 }, 40],
    ["successFlag 2 that consumed credits", { successFlag: 2, creditsConsumed: 40 }, 40],
  ])("supplies its cost: %s", async (_label, fields, credits) => {
    const out = ok((await read(logs([fromKie(fields)]), ["t-1"])).out)
    expect(out.kieUsd).toEqual({ "t-1": credits * KIE_CREDIT_USD })
    expect(out.matched).toBe(1)
  })

  it("a finished record of a task beside an unfinished one supplies its cost", async () => {
    const records = [fromKie({ state: "generating", consumeCredits: 0 }), fromKie({ state: "success", consumeCredits: 100 })]
    expect(ok((await read(logs(records), ["t-1"])).out).kieUsd).toEqual({ "t-1": 100 * KIE_CREDIT_USD })
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
