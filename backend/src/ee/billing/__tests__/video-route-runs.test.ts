// @test-units-by-name it names only Seedance price ids and the generate-video-pro service, never a node unit
import { beforeEach, describe, expect, it, vi } from "vitest"

const h = vi.hoisted(() => ({ job: {} as Record<string, unknown>, alerts: vi.fn(), segments: [] as unknown[], commits: [] as unknown[][], settles: [] as unknown[][], holds: [] as unknown[][], decision: null as string | null, decidedFor: undefined as number | undefined, patches: [] as unknown[][], refunds: 0 }))
vi.mock("../video-route-alerts.js", () => ({ recordVideoRouteAlert: h.alerts }))
vi.mock("@/lib/app-settings.js", () => ({ getAppSettings: async () => ({ cost_markup_percent: 0, service_margin_percent: {} }), settingsReadFailed: () => false }))
vi.mock("@/lib/video-route-ledger.js", async (orig) => ({
  ...(await orig<typeof import("@/lib/video-route-ledger.js")>()),
  readRouteLedger: async () => ({ starts: [], tasks: [], segments: h.segments, addonsBase: undefined, settle: h.decision ? { state: "retry", decision: h.decision, atQuote: h.decision === "quote", credits: null, detail: h.decidedFor === undefined ? null : { decidedForCredits: h.decidedFor } } : undefined }),
  recordRouteSettle: async (...a: unknown[]) => { h.settles.push(a) },
  holdRouteSettle: async (...a: unknown[]) => (h.holds.push(a), h.holds.length === 1),
  patchRouteSettle: async (...a: unknown[]) => (h.patches.push(a), true),
}))
vi.mock("@/lib/supabase.js", () => ({ supabase: { from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: h.job, error: null }) }) }), update: () => ({ eq: async () => ({ error: null }) }) }) } }))
vi.mock("../credits.js", async (orig) => ({
  ...(await orig<typeof import("../credits.js")>()),
  CreditsService: { commitCredits: async (...a: unknown[]) => (h.commits.push(a), { charged: a[1], collectedOverHold: 0, shortfall: 0 }) },
}))

const { settleRoutedRunJob } = await import("../video-route-runs.js")
const { bindRowlessRouteToken, rowlessRouteToken } = await import("../../../lib/video-route-decision.js")
const { CREDIT_BASE_USD } = await import("@nodaro/shared/models")
const { ROUTE_BILL_ANOMALY_MULTIPLE_DEFAULT: M } = await import("../../../lib/video-route-policy.js")
/** On a segment quoted at 100 credits: the largest bill still charged under the default multiple. */
const AT = 100 * M

function delivered(over: Record<string, unknown> = {}, opts: Record<string, unknown> = {}) {
  const token = bindRowlessRouteToken(rowlessRouteToken({ routeId: "r1", model: "seedance-2-5", service: "generate-video-pro", feeChargedCredits: 10, reserveChargedCredits: 400, feeId: "generate-video-pro", ...over }), { parentJobId: "job-1", userId: "u-1" })!
  h.job = { status: "completed", user_id: "u-1", usage_log_id: "log", run: { token, usageLogId: "log", opts } }
  return token
}
const seg = (key: string, billedUsd: number | null, quotedCredits = 100) => ({ key, ref: `t-${key}`, billedUsd, priceId: "seedance-2-5:8s:720p", quotedUsd: CREDIT_BASE_USD * 100, quotedCredits })

beforeEach(() => {
  h.segments = []
  h.commits = []
  h.settles = []
  h.holds = []
  h.patches = []
  h.refunds = 0
  h.decision = null
  h.decidedFor = undefined
  h.alerts.mockClear()
})

describe("settleRoutedRunJob", () => {
  it("charges the fee plus each delivered segment's reported billed cost; a segment that failed is not on the ledger, so not charged", async () => {
    h.segments = [seg("seg-1:1", CREDIT_BASE_USD * 80), seg("seg-2:1", CREDIT_BASE_USD * 90)]
    await settleRoutedRunJob("log", "job-1", delivered())
    expect(h.commits).toEqual([["log", 10 + 80 + 90, { collectOverHold: true, routedJobId: "job-1" }]])
  })

  it.each([[0, 10], [AT, AT + 10]])("charges a %i-credit segment at the full verified bill, with no cap up to the anomaly multiple", async (credits, expected) => {
    h.segments = [seg("seg", CREDIT_BASE_USD * credits)]
    await settleRoutedRunJob("log", "job-1", delivered())
    expect(h.commits.at(-1)?.[1]).toBe(expected)
  })

  it("defers capture on a missing monetary receipt and files an operator alert", async () => {
    h.segments = [seg("seg-1:1", null, 100)]
    await expect(settleRoutedRunJob("log", "job-1", delivered())).rejects.toThrow(/reported no verified bill/)
    expect(h.commits).toEqual([])
    expect(h.alerts).toHaveBeenCalledWith(expect.objectContaining({ kind: "settlement", jobId: "job-1" }))
  })

  it("refuses to charge an undelivered job even if its task finished", async () => {
    const token = delivered()
    h.job.status = "failed"
    h.segments = [seg("take", CREDIT_BASE_USD * 75)]
    await expect(settleRoutedRunJob("log", "job-1", token)).rejects.toThrow(/delivered result/)
    expect(h.commits).toEqual([])
  })

  it("preserves a zero UGC fee and caps delivered auxiliary work at the signed quote", async () => {
    h.segments = [seg("take", CREDIT_BASE_USD * 80)]
    const token = delivered({ feeId: "ugc-clip", feeChargedCredits: 0, nonVideoChargedCreditsMax: 25 }, { nonVideoChargedCredits: 100 })
    await settleRoutedRunJob("log", "job-1", token, { nonVideoChargedCredits: 0 })
    expect(h.commits.at(-1)?.[1]).toBe(105)
  })

  it("waives the fee when asked (a failed stitch), and charges anchors generated at the held unit, never more than held", async () => {
    h.segments = [seg("seg-1:1", CREDIT_BASE_USD * 80)]
    await settleRoutedRunJob("log", "job-1", delivered({ anchorUnitBase: 30, anchorsMax: 4 }, { waiveFee: true, anchorsGenerated: 3 }))
    expect(h.commits.at(-1)).toEqual(["log", 80 + 90, { collectOverHold: true, routedJobId: "job-1" }])
    await settleRoutedRunJob("log", "job-1", delivered({ anchorUnitBase: 30, anchorsMax: 4 }, { anchorsGenerated: 9 }))
    expect(h.commits.at(-1)).toEqual(["log", 10 + 80 + 120, { collectOverHold: true, routedJobId: "job-1" }])
  })

  it("holds a run whose segments' SUM is over the multiple of their quotes' sum: nothing charged, one alert, no factor raised", async () => {
    // Ten credits over the multiple of the two quotes together.
    h.segments = [seg("seg-1:1", CREDIT_BASE_USD * 150), seg("seg-2:1", CREDIT_BASE_USD * (2 * AT - 140))]
    const token = delivered()
    await expect(settleRoutedRunJob("log", "job-1", token)).rejects.toThrow(/await a decision/)
    await expect(settleRoutedRunJob("log", "job-1", token)).rejects.toThrow(/await a decision/)
    expect(h.commits).toEqual([])
    expect(h.holds[0]).toEqual(["job-1", expect.objectContaining({ credits: 10 + 2 * AT + 10 })])
    expect(h.alerts.mock.calls.filter((c) => c[0].kind === "anomaly")).toHaveLength(1)
    expect(h.alerts.mock.calls.filter((c) => c[0].kind === "price-increase")).toHaveLength(0)
    // One segment far over its own quote does not hold a run whose sum is within the multiple.
    h.segments = [seg("seg-1:1", CREDIT_BASE_USD * 100), seg("seg-2:1", CREDIT_BASE_USD * (2 * AT - 110))]
    await settleRoutedRunJob("log", "job-1", token)
    expect(h.commits.at(-1)?.[1]).toBe(10 + 2 * AT - 10)
  })

  it("charges a held run in full once an admin confirmed it, at the total the confirmation was given for", async () => {
    h.segments = [seg("seg-1:1", CREDIT_BASE_USD * 4 * AT)]
    h.decision = "confirmed"
    h.decidedFor = 4 * AT + 10
    await settleRoutedRunJob("log", "job-1", delivered())
    expect(h.commits).toEqual([["log", 4 * AT + 10, { collectOverHold: true, routedJobId: "job-1" }]])
    expect(h.holds).toEqual([])
    // One credit of rounding between what was shown and what is charged is the same total.
    h.decidedFor = 4 * AT + 9
    await settleRoutedRunJob("log", "job-1", delivered())
    expect(h.commits).toHaveLength(2)
    expect(h.holds).toEqual([])
  })

  it("a confirmation does not cover a larger total: a run whose bill grew since it was confirmed is held again, not charged", async () => {
    // Confirmed at one segment's bill; a second segment's bill has arrived since.
    h.segments = [seg("seg-1:1", CREDIT_BASE_USD * 4 * AT), seg("seg-2:1", CREDIT_BASE_USD * 4 * AT)]
    h.decision = "confirmed"
    h.decidedFor = 4 * AT + 10
    await expect(settleRoutedRunJob("log", "job-1", delivered())).rejects.toThrow(/await a decision/)
    expect(h.commits).toEqual([])
    expect(h.holds).toEqual([["job-1", expect.objectContaining({ credits: 8 * AT + 10 })]])
    // Two credits over what was confirmed is already another total.
    h.holds = []
    h.segments = [seg("seg-1:1", CREDIT_BASE_USD * (4 * AT + 2))]
    await expect(settleRoutedRunJob("log", "job-1", delivered())).rejects.toThrow(/await a decision/)
    // And a confirmation that names no total covers none.
    h.decidedFor = undefined
    await expect(settleRoutedRunJob("log", "job-1", delivered())).rejects.toThrow(/await a decision/)
    expect(h.commits).toEqual([])
  })

  describe("an admin settles an unbilled run at its quote", () => {
    it("charges each billed segment its real bill and the unbilled one its quote, then watches the route for a late bill", async () => {
      h.segments = [seg("seg-1:1", CREDIT_BASE_USD * 80), seg("seg-2:1", null, 100)]
      h.decision = "quote"
      await settleRoutedRunJob("log", "job-1", delivered())
      expect(h.commits).toEqual([["log", 10 + 80 + 100, { collectOverHold: true, routedJobId: "job-1" }]])
      expect(h.patches).toContainEqual(["job-1", expect.objectContaining({ watchUntil: expect.any(String) }), expect.objectContaining({ next_attempt_at: expect.any(String) })])
    })

    it("one billed segment far above its quote: the TOTAL is far above the quotes, so nothing is charged and the run is held for its own confirmation", async () => {
      // 1 segment billed 11x its quote + 1 unbilled at its quote = 1200 against quotes of 200 (x the multiple = 1000).
      h.segments = [seg("seg-1:1", CREDIT_BASE_USD * (2 * AT + 100)), seg("seg-2:1", null, 100)]
      h.decision = "quote"
      await expect(settleRoutedRunJob("log", "job-1", delivered())).rejects.toThrow(/await a decision/)
      expect(h.commits).toEqual([])
      expect(h.holds[0]).toEqual(["job-1", expect.objectContaining({ credits: 10 + 2 * AT + 100 + 100 })])
      expect(h.alerts.mock.calls.filter((c) => c[0].kind === "anomaly")).toHaveLength(1)
    })

    it("a bill that arrived before the click is charged at its real figure, and tested like any bill", async () => {
      // Both segments billed by now: within the multiple it is simply charged, with no late-bill watch.
      h.segments = [seg("seg-1:1", CREDIT_BASE_USD * 80), seg("seg-2:1", CREDIT_BASE_USD * 300)]
      h.decision = "quote"
      await settleRoutedRunJob("log", "job-1", delivered())
      expect(h.commits.at(-1)?.[1]).toBe(10 + 80 + 300)
      expect(h.patches).toEqual([])
    })
  })

  it("a run without the quote decision never charges an unbilled segment at its quote", async () => {
    h.segments = [seg("seg-1:1", CREDIT_BASE_USD * 80), seg("seg-2:1", null, 100)]
    h.decision = "confirmed"
    await expect(settleRoutedRunJob("log", "job-1", delivered())).rejects.toThrow(/no verified bill/)
    expect(h.commits).toEqual([])
  })

  it("refuses a token that is not this job's (nothing committed)", async () => {
    await expect(settleRoutedRunJob("log", "job-2", delivered())).rejects.toThrow(/does not verify/)
    expect(h.commits).toEqual([])
  })
})
