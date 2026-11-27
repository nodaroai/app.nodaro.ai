// @test-units-by-name it names only Seedance price ids and video job types, never a node unit
/**
 * Every failure exit of a Seedance 2.x video run, on every lane, on both the
 * default provider and the alternate route: the hold is released in full,
 * exactly once, and nothing is charged ("never charge on a failed
 * generation"). Each exit is the error the lane's failure ends in (the run
 * itself is covered where it is made: lib/__tests__/alternate-route-routed.test.ts
 * for the routed exits, lib/reconcile/__tests__/alternate-route.test.ts for the
 * recovery's), handed to the one failure funnel (`refundJobCredits`), twice —
 * a retried failure must not release a second time.
 *
 * The default route's post-processing failure is the one exit with its own
 * rule: a provider task exists, so the recovery finishes the run (delivered,
 * charged) or exhausts it (released) — the worker neither charges nor
 * releases at that moment. A routed run's post-processing failure is released
 * at once (nothing was delivered to its owner).
 */
import { beforeEach, describe, expect, it, vi } from "vitest"

const h = vi.hoisted(() => ({
  policySaved: true,
  routed: true,
  reserved: true,
  refunds: [] as string[],
  commits: [] as unknown[][],
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
      const chain: Record<string, unknown> = {}
      for (const m of ["select", "eq", "in", "update", "is", "not"]) chain[m] = () => chain
      chain.maybeSingle = async () =>
        table === "jobs"
          ? { data: h.routed ? { __videoRoute: { sig: "s" } } : {}, error: null }
          : { data: { action: "seedance-2-5:8s:720p" }, error: null }
      chain.single = chain.maybeSingle
      return chain
    },
    rpc: async () => ({ data: null, error: null }),
  },
}))
vi.mock("../../ee/services/credits.js", () => ({
  CreditsService: {
    trySettleManagedCredits: async () => false,
    trySettleManagedCreditsOrReadLog: async () => ({ managed: false, log: { action: "seedance-2-5:8s:720p", credits_used: 100, job_id: "job-1" } }),
    commitCredits: async (...a: unknown[]) => { h.commits.push(a) },
    // The release is a compare-and-set on `reserved`: only the first one releases.
    refundCredits: async (id: string) => {
      if (!h.reserved) return
      h.reserved = false
      h.refunds.push(id)
    },
  },
}))

const { refundJobCredits } = await import("../shared.js")
const { PostProcessingError } = await import("../../lib/post-processing-error.js")
const { ROUTED_FAILURE_MESSAGE } = await import("../../lib/alternate-route.js")
const { createUpstreamFailureError } = await import("../../providers/kie/client.js")

const LANES = [
  "image-to-video", "text-to-video", "extend-video", "lip-sync", "voiced-video",
  "generate-character-motion", "generate-location-motion", "generate-object-motion", "generate-creature-motion", "video-upscale",
] as const

const routedFailure = (why: string) => Object.assign(new Error(ROUTED_FAILURE_MESSAGE), { deterministic: true, routedFailure: true, why })
const kie = (msg: string, contentPolicy = false) => createUpstreamFailureError(msg, "test", { contentPolicy })

/** Each exit, as each route's lane ends it. `post: true` = the provider already delivered (post-processing). */
const EXITS: ReadonlyArray<{ exit: string; routed: () => unknown; default: () => unknown; post?: true }> = [
  { exit: "start refused", routed: () => routedFailure("refused twice"), default: () => kie("createTask failed: 422") },
  { exit: "start refused twice", routed: () => routedFailure("the start was refused twice"), default: () => kie("createTask failed: 500") },
  { exit: "start unanswered", routed: () => routedFailure("the start got no answer"), default: () => new Error("createTask timed out") },
  { exit: "task failed", routed: () => routedFailure("its task failed"), default: () => kie("KIE.ai task failed") },
  { exit: "task expired", routed: () => routedFailure("its task expired"), default: () => kie("KIE.ai task expired") },
  { exit: "content refusal", routed: () => routedFailure("its task failed"), default: () => kie("content policy", true) },
  { exit: "download failed", routed: () => new PostProcessingError("Failed to download: https://out.example/v.mp4 (500)"), default: () => new PostProcessingError("Failed to download: https://out.example/v.mp4 (500)"), post: true },
  { exit: "post-processing failed", routed: () => new PostProcessingError("ffmpeg failed: Conversion failed!"), default: () => new PostProcessingError("ffmpeg failed: Conversion failed!"), post: true },
  { exit: "stopped, then failed", routed: () => routedFailure("its task failed"), default: () => kie("KIE.ai task failed") },
  { exit: "recovery failed (no worker left / unreadable)", routed: () => new Error(ROUTED_FAILURE_MESSAGE), default: () => new Error("reconcile exhausted") },
  { exit: "timeout", routed: () => new Error("Poll timeout: job did not complete"), default: () => new Error("Poll timeout: job did not complete") },
]

beforeEach(() => {
  h.reserved = true
  h.refunds = []
  h.commits = []
})

describe.each(["alternate route", "default provider"] as const)("on the %s", (route) => {
  describe.each(LANES)("lane %s", (lane) => {
    it.each(EXITS.map((e) => [e.exit, e] as const))("%s: released in full exactly once, nothing charged", async (_name, e) => {
      h.routed = route === "alternate route"
      vi.spyOn(console, "error").mockImplementation(() => {})
      const err = h.routed ? e.routed() : e.default()
      // A failure handed down twice (a retried attempt, a recovery after the worker) releases once.
      await refundJobCredits("log-1", `job-${lane}`, err)
      await refundJobCredits("log-1", `job-${lane}`, err)
      expect(h.commits).toEqual([])
      if (e.post && !h.routed) {
        // The default provider's delivered-then-failed run: left to its recovery (finished and charged, or exhausted and released).
        expect(h.refunds).toEqual([])
      } else {
        expect(h.refunds).toEqual(["log-1"])
      }
    })
  })
})
