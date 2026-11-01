// An interrupted background scrape re-attaches, never re-runs (decided
// 2026-11-01): each settle saves its external run the moment it exists — the
// connected cloud's job (`nodaro-cloud`) or the Apify actor run (`apify-run`)
// — and a settle handed a saved run waits on THAT run. No path starts a second
// run for one job. The Apify side runs through the real providers (their
// start-then-wait, providers/apify/run.ts) on a fake client.
import { beforeEach, describe, expect, it, vi } from "vitest"

const h = vi.hoisted(() => ({
  updates: [] as Array<{ fields: Record<string, unknown>; id: unknown }>,
  updateError: null as null | { message: string },
  /** The job's row, as the save's CAS and its read see it. */
  row: { status: "processing", provider_kind: "pre-task" as string | null, provider_task_id: null as string | null },
  cloudFetch: vi.fn(async (..._a: unknown[]) => ({ ok: true })),
  onCloud: true,
  createCloudJob: vi.fn(async (..._a: unknown[]) => "cloud-new"),
  waitForCloudJob: vi.fn(async (..._a: unknown[]) => ({ id: "cloud", status: "completed", output_data: { json: [] } })),
  start: vi.fn(async (..._a: unknown[]) => ({ id: "run-new" })),
  waitForFinish: vi.fn(async (..._a: unknown[]) => ({ id: "run", status: "SUCCEEDED", defaultDatasetId: "ds-1" })),
  runIds: [] as string[],
  abort: vi.fn(async () => ({})),
  listItems: vi.fn(async () => ({ items: [] as unknown[] })),
  completed: vi.fn(async (..._a: unknown[]) => true),
  completedDetailed: vi.fn(async (..._a: unknown[]) => "completed"),
  failed: vi.fn(async (..._a: unknown[]) => true),
  commit: vi.fn(async (..._a: unknown[]) => undefined),
  refund: vi.fn(async (..._a: unknown[]) => 0),
  runCapture: vi.fn(async (..._a: unknown[]) => ({ raw: true, deleteStorages: async () => undefined })),
}))

vi.mock("../../supabase.js", () => ({
  supabase: {
    from: () => ({
      // The save: update(fields).eq("id").is("provider_task_id", null).in("status", live).select("id") — a CAS on the row.
      update: (fields: Record<string, unknown>) => {
        const filters: Array<[string, unknown]> = []
        const apply = () => {
          if (h.updateError) return { data: null, error: h.updateError }
          const casOk = filters.every(([op, v]) => (op === "is" ? h.row.provider_task_id === v : op === "in" ? (v as string[]).includes(h.row.status) : true))
          if (!casOk) return { data: [], error: null }
          h.updates.push({ fields, id: "job-1" })
          Object.assign(h.row, fields)
          return { data: [{ id: "job-1" }], error: null }
        }
        const c: Record<string, unknown> = {
          eq: () => c,
          is: (_col: string, v: unknown) => { filters.push(["is", v]); return c },
          in: (_col: string, v: unknown) => { filters.push(["in", v]); return c },
          select: async () => apply(),
        }
        return c
      },
      select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { ...h.row }, error: null }) }) }),
    }),
  },
}))
vi.mock("../../nodaro-connect.js", () => ({ nodaroCloudFetch: h.cloudFetch }))
vi.mock("../../../providers/nodaro/run-on-cloud.js", () => ({ shouldRunOnCloud: async () => h.onCloud }))
vi.mock("../../../providers/nodaro/client.js", () => {
  class NodaroCloudError extends Error {}
  return { NodaroCloudError, createCloudJob: h.createCloudJob, waitForCloudJob: h.waitForCloudJob }
})
vi.mock("../../../providers/apify/client.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../providers/apify/client.js")>()),
  getApifyClient: () => ({
    actor: () => ({ start: h.start }),
    run: (id: string) => {
      h.runIds.push(id)
      return { waitForFinish: h.waitForFinish, abort: h.abort }
    },
    dataset: () => ({ listItems: h.listItems }),
  }),
}))
vi.mock("../../../providers/apify/site-capture.js", () => {
  class SiteCaptureError extends Error {}
  return { SiteCaptureError, runSiteCapture: h.runCapture }
})
vi.mock("../../site-capture-store.js", () => {
  class CaptureStorageFullError extends Error {}
  return {
    CaptureStorageFullError,
    storeLocalCapture: async () => ({ output: { pageUrl: "p" }, assetIds: [] }),
    restoreRelayCapture: async () => ({ output: { pageUrl: "p" }, assetIds: [] }),
    deleteCaptureAssets: async () => undefined,
  }
})
const passMedia = (key: "ads" | "posts") => async (items: unknown[]) => ({ [key]: items, stats: { classified: 0, stored: 0, videosStored: 0, kept: items.length, filteredOut: 0 } })
vi.mock("../../meta-ads-media.js", () => ({ classifyAndStoreMetaAdsMedia: passMedia("ads"), metaAdsWithoutMedia: (a: unknown[]) => a }))
vi.mock("../../instagram-media.js", () => ({ classifyAndStoreInstagramMedia: passMedia("posts"), instagramWithoutMedia: (p: unknown[]) => p }))
vi.mock("../../../workers/shared.js", () => ({ markJobCompleted: h.completed, markJobCompletedDetailed: h.completedDetailed, commitJobCredits: vi.fn() }))
vi.mock("../../job-failure.js", () => ({ markJobFailed: h.failed }))
vi.mock("../../credits-job-lifecycle.js", () => ({ commitReservedCreditsForJob: h.commit, refundReservedCreditsForJob: h.refund }))

const { cloudJobOf, relayIdempotencyKey, scrapeRunTracker, ScrapeRunNotSavedError } = await import("../scrape-run.js")
const { MIN_IDEMPOTENCY_KEY_LENGTH } = await import("../../dedup-fingerprint.js")
const { settleWebScrape } = await import("../web-scrape.js")
const { settleSiteCapture } = await import("../site-capture.js")
const { settleMetaAdsScrape } = await import("../meta-ads.js")
const { settleInstagramScrape } = await import("../instagram.js")
type Saved = Parameters<typeof scrapeRunTracker>[1]

const log = { info: () => undefined, warn: () => undefined, error: () => undefined }
const WEB_BODY = { actor: "google-search", query: "ai" } as const
const META_BODY = { mode: "search", query: "nike", count: 10, period: "30d", activeStatus: "active", countryCode: "US" } as const
const IG_BODY = { mode: "profile", targets: ["nike"], count: 20, period: "30d" } as const

/** Each scrape's settle, run once with a tracker over `saved`, on the relay (`viaCloud`) or its own Apify run. */
const SETTLES: Record<string, (viaCloud: boolean, saved?: Saved) => Promise<unknown>> = {
  "web-scrape": (viaCloud, saved) => {
    h.onCloud = viaCloud
    return settleWebScrape({ jobId: "job-1", usageLogId: "u-1", body: WEB_BODY, runs: scrapeRunTracker("job-1", saved), log })
  },
  "site-capture": (viaCloud, saved) => settleSiteCapture({
    jobId: "job-1", userId: "u1", runner: viaCloud ? "relay" : "keyed", body: { url: "https://example.com/", maxStills: 8 }, usageLogId: "u-1",
    runs: scrapeRunTracker("job-1", saved), log,
  }),
  "meta-ads-scrape": (viaCloud, saved) => settleMetaAdsScrape({
    jobId: "job-1", userId: "u1", usageLogId: "u-1", startedAt: Date.now(), log, body: META_BODY as never, viaCloud,
    resolvedPageUrls: [], resolvedAdvertisers: [], sources: 1, analysisTier: null, analysisModel: "m", runs: scrapeRunTracker("job-1", saved),
  }),
  "instagram-scrape": (viaCloud, saved) => settleInstagramScrape({
    jobId: "job-1", userId: "u1", usageLogId: "u-1", startedAt: Date.now(), log, body: IG_BODY as never, viaCloud,
    requestedCount: 20, sources: 1, analysisTier: null, analysisModel: "m", runs: scrapeRunTracker("job-1", saved),
  }),
}

const savedRunWrites = () => h.updates.filter((u) => "provider_task_id" in u.fields).map((u) => u.fields)
/** The Apify run a site capture was handed hooks for (its provider is a mock: the hooks are what it would act on). */
const captureHooks = () => (h.runCapture.mock.calls.at(-1)?.[2] ?? {}) as { resumeRunId?: string; onRunStarted?: (id: string) => Promise<void> }

beforeEach(() => {
  vi.clearAllMocks()
  h.row = { status: "processing", provider_kind: "pre-task", provider_task_id: null }
  h.updates.length = 0
  h.runIds.length = 0
  h.updateError = null
  h.onCloud = true
})

describe.each(Object.keys(SETTLES))("%s", (type) => {
  const settle = SETTLES[type]!

  it("a re-pick with a saved cloud job polls it and never creates one again", async () => {
    await settle(true, { kind: "nodaro-cloud", id: "cloud-9" })
    expect(h.createCloudJob).not.toHaveBeenCalled()
    expect(h.waitForCloudJob.mock.calls[0]![0]).toBe("cloud-9")
    expect(savedRunWrites()).toEqual([])
    expect(h.completed.mock.calls.length + h.completedDetailed.mock.calls.length).toBe(1)
  })

  it("a re-pick with a saved Apify run waits on it and re-reads its dataset, never starting one", async () => {
    await settle(false, { kind: "apify-run", id: "run-9" })
    if (type === "site-capture") {
      expect(captureHooks()).toEqual({ resumeRunId: "run-9" })
    } else {
      expect(h.start).not.toHaveBeenCalled()
      expect(h.runIds).toEqual(["run-9"])
      expect(h.listItems).toHaveBeenCalledTimes(1)
    }
    expect(h.createCloudJob).not.toHaveBeenCalled()
    expect(savedRunWrites()).toEqual([])
  })

  it("a first run (or a re-pick before its id was saved) starts exactly one run and saves it before waiting", async () => {
    await settle(true)
    expect(h.createCloudJob).toHaveBeenCalledTimes(1)
    // Created under this job's own namespaced idempotency key: a repeat create answers the same cloud job.
    expect(h.createCloudJob.mock.calls[0]![2]).toEqual({ idempotencyKey: "scrape-relay:job-1" })
    expect(savedRunWrites()).toEqual([{ provider_kind: "nodaro-cloud", provider_task_id: "cloud-new", provider_call_started_at: expect.any(String) }])
    expect(h.waitForCloudJob.mock.calls[0]![0]).toBe("cloud-new")

    vi.clearAllMocks()
    h.updates.length = 0
    h.row = { status: "processing", provider_kind: "pre-task", provider_task_id: null }
    await settle(false)
    if (type === "site-capture") {
      const hooks = captureHooks()
      expect(hooks.resumeRunId).toBeUndefined()
      await hooks.onRunStarted!("run-new")
    } else {
      expect(h.start).toHaveBeenCalledTimes(1)
      expect(h.runIds).toEqual(["run-new"])
    }
    expect(savedRunWrites()).toEqual([{ provider_kind: "apify-run", provider_task_id: "run-new", provider_call_started_at: expect.any(String) }])
  })

  it("a saved run of the other side than its plan is never replaced by a new one", async () => {
    await settle(true, { kind: "apify-run", id: "run-9" })
    expect(h.createCloudJob).not.toHaveBeenCalled()
    expect(h.start).not.toHaveBeenCalled()
    if (type === "web-scrape") {
      // Its side is decided when it runs: it follows the run it already started.
      expect(h.runIds).toEqual(["run-9"])
      expect(h.failed).not.toHaveBeenCalled()
    } else {
      // Its side was decided by its route: the job fails and refunds.
      expect(h.failed).toHaveBeenCalledTimes(1)
      expect(h.refund).toHaveBeenCalledWith("job-1")
    }
  })
})

describe("the relay's idempotency key", () => {
  it("is the job id in a namespace of its own, and passes the cloud's key check (trimmed, at least its minimum length)", () => {
    const key = relayIdempotencyKey("3f0e7a9c-1b2d-4e5f-8a6b-7c8d9e0f1a2b")
    expect(key).toBe("scrape-relay:3f0e7a9c-1b2d-4e5f-8a6b-7c8d9e0f1a2b")
    expect(key.trim()).toBe(key)
    expect(key.length).toBeGreaterThanOrEqual(MIN_IDEMPOTENCY_KEY_LENGTH)
  })
})

describe("a run that cannot be saved is given up, never left unrecoverable", () => {
  it("Apify: the started run is aborted and the job fails and refunds — no second run", async () => {
    h.updateError = { message: "connection reset" }
    await SETTLES["web-scrape"]!(false)
    expect(h.start).toHaveBeenCalledTimes(1)
    expect(h.abort).toHaveBeenCalledTimes(1)
    expect(h.waitForFinish).not.toHaveBeenCalled()
    expect(h.failed).toHaveBeenCalledTimes(1)
    expect(h.refund).toHaveBeenCalledWith("job-1")
  })

  it("relay: the cloud job is not polled and the job fails and refunds — no second job", async () => {
    h.updateError = { message: "connection reset" }
    await SETTLES["meta-ads-scrape"]!(true)
    expect(h.createCloudJob).toHaveBeenCalledTimes(1)
    expect(h.waitForCloudJob).not.toHaveBeenCalled()
    expect(h.failed).toHaveBeenCalledTimes(1)
    expect(h.refund).toHaveBeenCalledWith("job-1")
  })
})

describe("two attempts of one job: the first run saved is the job's run", () => {
  it("Apify: an attempt whose save loses aborts its own run and waits on the saved one", async () => {
    h.row = { status: "processing", provider_kind: "apify-run", provider_task_id: "run-winner" }
    await SETTLES["web-scrape"]!(false)
    expect(h.start).toHaveBeenCalledTimes(1)
    expect(h.abort).toHaveBeenCalledTimes(1)
    expect(h.runIds).toEqual(["run-new", "run-winner"]) // the abort of its own, then the wait on the winner
    expect(h.updates).toEqual([])
    expect(h.completed).toHaveBeenCalledTimes(1)
  })

  it("relay: an attempt whose save loses cancels its own cloud job and polls the saved one", async () => {
    h.row = { status: "processing", provider_kind: "nodaro-cloud", provider_task_id: "cloud-winner" }
    await SETTLES["meta-ads-scrape"]!(true)
    expect(h.cloudFetch).toHaveBeenCalledWith("/v1/jobs/cloud-new/cancel", { method: "POST" })
    expect(h.waitForCloudJob.mock.calls[0]![0]).toBe("cloud-winner")
    expect(h.updates).toEqual([])
  })

  it("relay: the same cloud job answered again (the idempotency key) is simply polled — nothing to cancel", async () => {
    h.row = { status: "processing", provider_kind: "nodaro-cloud", provider_task_id: "cloud-new" }
    await SETTLES["instagram-scrape"]!(true)
    expect(h.cloudFetch).not.toHaveBeenCalled()
    expect(h.waitForCloudJob.mock.calls[0]![0]).toBe("cloud-new")
  })

  it("relay: a job no longer running (cancelled) cancels the cloud job it just created and polls nothing", async () => {
    h.row = { status: "cancelled", provider_kind: "pre-task", provider_task_id: null }
    await SETTLES["meta-ads-scrape"]!(true)
    expect(h.createCloudJob).toHaveBeenCalledTimes(1)
    expect(h.cloudFetch).toHaveBeenCalledTimes(1)
    expect(h.cloudFetch).toHaveBeenCalledWith("/v1/jobs/cloud-new/cancel", { method: "POST" })
    expect(h.waitForCloudJob).not.toHaveBeenCalled()
    expect(h.updates).toEqual([])
  })

  it("relay: a save that fails on the database leaves the cloud job alone — a live attempt may be polling it", async () => {
    h.updateError = { message: "connection reset" }
    await SETTLES["instagram-scrape"]!(true)
    expect(h.createCloudJob).toHaveBeenCalledTimes(1)
    expect(h.cloudFetch).not.toHaveBeenCalled()
    expect(h.waitForCloudJob).not.toHaveBeenCalled()
  })

  it("relay: a cancel that fails never hides why the save failed", async () => {
    h.row = { status: "cancelled", provider_kind: "pre-task", provider_task_id: null }
    h.cloudFetch.mockRejectedValueOnce(new Error("cloud unreachable"))
    await expect(cloudJobOf(scrapeRunTracker("job-1"), async () => "cloud-new")).rejects.toBeInstanceOf(ScrapeRunNotSavedError)
    expect(h.cloudFetch).toHaveBeenCalledWith("/v1/jobs/cloud-new/cancel", { method: "POST" })
  })

  it("a job no longer running (cancelled) saves nothing: the run just started is given up and nothing waits on it", async () => {
    h.row = { status: "cancelled", provider_kind: "pre-task", provider_task_id: null }
    await SETTLES["web-scrape"]!(false)
    expect(h.abort).toHaveBeenCalledTimes(1)
    expect(h.waitForFinish).not.toHaveBeenCalled()
    expect(h.updates).toEqual([])
  })
})

