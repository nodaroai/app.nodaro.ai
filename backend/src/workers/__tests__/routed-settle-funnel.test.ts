// @test-units-by-name it names only Seedance price ids and video job types, never a node unit
/**
 * The ONE routed settlement, reached from the worker's money funnels
 * (workers/shared.ts → ee/billing/video-route-settlement.ts `settleRoutedJob`):
 *  - a routed log is charged by the entry with NOTHING the caller measured: a
 *    default-provider measure of a reference-video or Auto run (`meteredBaseCredits`,
 *    handed down as a count-based base) never reaches it — the double charge;
 *  - a log no route can price is decided with no read beyond the managed check;
 *  - a failed loop trim on a routed job goes through the same entry;
 *  - a routed run whose post-processing failed after the route delivered is
 *    released in full (nothing was delivered to its owner).
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

const h = vi.hoisted(() => ({
  log: null as { action: string | null; credits_used: number | null; job_id: string | null } | null,
  routed: true,
  settleCalls: [] as unknown[],
  commits: [] as unknown[][],
  refunds: [] as unknown[],
  reads: [] as string[],
  jobStamped: true,
  policySaved: true,
}))
// A routing policy was saved in this environment (unless a test says otherwise): only then can a job be routed.
vi.mock("@/lib/app-settings.js", async () => ({
  ...(await vi.importActual<typeof import("@/lib/app-settings.js")>("@/lib/app-settings.js")),
  getAppSettings: async () => ({ video_route_policy: h.policySaved ? { models: {} } : null }),
}))

vi.mock("@/lib/config.js", async () => ({ ...(await vi.importActual<typeof import("@/lib/config.js")>("@/lib/config.js")), hasCredits: () => true }))
vi.mock("@/lib/supabase.js", () => ({
  supabase: {
    from: (table: string) => {
      h.reads.push(table)
      const chain: Record<string, unknown> = {}
      for (const m of ["select", "eq", "in", "update", "insert", "is", "not", "order", "limit"]) chain[m] = () => chain
      chain.maybeSingle = async () => (table === "jobs" ? { data: h.jobStamped ? { __videoRoute: { sig: "s" } } : {}, error: null } : { data: null, error: null })
      chain.single = async () => (table === "usage_logs" ? { data: { ...(h.log ?? {}), metadata: {} }, error: null } : { data: null, error: null })
      chain.then = (ok: (v: unknown) => unknown) => Promise.resolve({ data: null, error: null }).then(ok)
      return chain
    },
    rpc: async () => ({ data: null, error: null }),
  },
}))
vi.mock("../../ee/services/credits.js", () => ({
  CreditsService: {
    trySettleManagedCredits: async () => false,
    trySettleManagedCreditsOrReadLog: async () => ({ managed: false, log: h.log }),
    commitCredits: async (...a: unknown[]) => { h.commits.push(a) },
    refundCredits: async (id: unknown) => { h.refunds.push(id) },
  },
}))
vi.mock("../../ee/billing/video-route-settlement.js", () => ({
  settleRoutedJob: async (args: unknown) => (h.settleCalls.push(args), h.routed),
}))
vi.mock("../../ee/billing/credit-anomaly.js", () => ({ computeActualCredits: async (usd: number) => Math.round(usd * 100), checkAndLogAnomaly: async () => {} }))
vi.mock("../../ee/billing/service-margin.js", () => ({ applyServiceMarkup: (base: number) => base }))

const { commitJobCredits, refundLoopTrimAddon, refundJobCredits } = await import("../shared.js")
const { PostProcessingError } = await import("../../lib/post-processing-error.js")

beforeEach(() => {
  h.log = { action: "seedance-2-5:15s:720p-ref", credits_used: 490, job_id: "job-1" }
  h.routed = true
  h.settleCalls = []
  h.commits = []
  h.refunds = []
  h.reads = []
  h.jobStamped = true
  h.policySaved = true
})

describe("commitJobCredits → the one routed settlement", () => {
  it("a routed log is settled by the entry from the log alone: the measured base (490) the caller hands down never reaches it", async () => {
    // What heldCommitArgs hands down for a measured reference-video run: (null cost, 490 base, metered).
    await commitJobCredits("log-1", "job-1", null, 490, true)
    expect(h.settleCalls).toEqual([{ usageLogId: "log-1", jobId: "job-1", log: h.log }])
    expect(h.commits).toEqual([])
  })

  it("a log no route can price never reaches the entry: only the default settle's own reads happen", async () => {
    h.log = { action: "flux-pro", credits_used: 10, job_id: "job-1" }
    await commitJobCredits("log-1", "job-1")
    const flux = [...h.reads]
    h.reads = []
    h.log = { action: "seedance-2-5:8s:720p", credits_used: 10, job_id: "job-1" }
    h.routed = false
    await commitJobCredits("log-1", "job-1")
    // The same reads either way: the decision itself reads nothing (the entry is mocked here).
    expect(flux).toEqual(h.reads)
    expect(h.settleCalls).toHaveLength(1)
    expect(h.commits).toEqual([["log-1"], ["log-1"]])
  })

  it("a Seedance log of a job the route did not run settles as always", async () => {
    h.routed = false
    await commitJobCredits("log-1", "job-1")
    expect(h.settleCalls).toHaveLength(1)
    expect(h.commits).toEqual([["log-1"]])
  })
})

describe("the other exits that end a routed hold", () => {
  it("a failed loop trim on a routed job goes through the same entry (its ledger holds no add-on)", async () => {
    await refundLoopTrimAddon("job-1", "log-1", 30)
    expect(h.settleCalls).toEqual([{ usageLogId: "log-1", jobId: "job-1", log: { action: "seedance-2-5:15s:720p-ref", credits_used: 490, job_id: "job-1", routed: false } }])
    expect(h.commits).toEqual([])
  })

  it("a routed run whose post-processing failed after the route delivered is released in full", async () => {
    const err = vi.spyOn(console, "error").mockImplementation(() => {})
    await refundJobCredits("log-1", "job-1", new PostProcessingError("ffmpeg failed"))
    expect(h.refunds).toEqual(["log-1"])
    err.mockRestore()
  })

  it.each(["generate-video-pro", "edit-video-pro", "ugc-clip"])("an unrouted %s run's post-processing failure keeps the rule it always had (not refunded here)", async (action) => {
    h.jobStamped = false
    h.log = { action, job_id: "job-1", credits_used: 490 }
    await refundJobCredits("log-1", "job-1", new PostProcessingError("stitch failed"))
    expect(h.refunds).toEqual([])
  })

  it("with no routing policy ever saved nothing is routed: no job read, and the unrouted rule applies whatever the row says", async () => {
    h.policySaved = false
    h.reads = []
    await refundJobCredits("log-1", "job-1", new PostProcessingError("ffmpeg failed"))
    expect(h.refunds).toEqual([])
    expect(h.reads).not.toContain("jobs")
  })

  it("a default-route run's post-processing failure keeps today's rule (not refunded)", async () => {
    h.jobStamped = false
    await refundJobCredits("log-1", "job-1", new PostProcessingError("ffmpeg failed"))
    expect(h.refunds).toEqual([])
  })
})
