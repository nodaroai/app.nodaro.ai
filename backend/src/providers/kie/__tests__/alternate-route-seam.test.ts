import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

/**
 * The alternate-route seam inside the video provider (lib/alternate-route.ts):
 * reached once the default request is fully prepared, on both video lanes.
 *
 *   - No plugin service: the default request and its call options are
 *     byte-identical whether or not the handler opted in, and the seam makes
 *     no database call.
 *   - Taken: the default upstream is never called, and the result carries the
 *     route's own figure and no default-upstream task id.
 *   - Fallen back: the default upstream receives exactly the request it would
 *     have received without the plugin.
 */

const mocks = vi.hoisted(() => {
  const job: Record<string, unknown> = {}
  const builder = (patch?: Record<string, unknown>) => {
    const filters: Array<(j: Record<string, unknown>) => boolean> = []
    const matches = () => filters.every((f) => f(job))
    const chain = {
      // A JSON path (`a->b->>c`) is read through the row's nested objects; SQL: NULL <> x is not true.
      neq: (col: string, val: unknown) => (filters.push((j) => {
        const v = col.split(/->>?/).reduce<unknown>((o, k) => (o as Record<string, unknown> | null | undefined)?.[k], j)
        return v !== null && v !== undefined && v !== val
      }), chain),
      eq: (col: string, val: unknown) => (filters.push((j) => j[col] !== null && j[col] !== undefined && j[col] === val), chain),
      is: (col: string, val: unknown) => (filters.push((j) => (j[col] ?? null) === val), chain),
      in: (col: string, vals: unknown[]) => (filters.push((j) => vals.includes(j[col])), chain),
      maybeSingle: async () => ({ data: matches() ? structuredClone(job) : null, error: null }),
      select: async () => {
        if (!matches()) return { data: [], error: null }
        Object.assign(job, structuredClone(patch))
        return { data: [{ id: job.id }], error: null }
      },
    }
    return chain
  }
  return {
    job,
    from: vi.fn((_table: string) => ({ select: () => builder(), update: (patch: Record<string, unknown>) => builder(patch) })),
    mockRunKieTask: vi.fn(),
    mockRunVeoTask: vi.fn(),
    mockCreateSanitizedError: vi.fn((msg: string, ctx: string) => new Error(`[${ctx}] ${msg}`)),
    mockKling3Generate: vi.fn(),
    mockUploadBufferToR2: vi.fn(),
    mockSafeFetch: vi.fn(),
  }
})

vi.mock("../../../lib/supabase.js", () => ({ supabase: { from: mocks.from } }))
vi.mock("../../../lib/job-cost-columns.js", () => ({ jobCostColumns: async (cost: number) => ({ provider_cost: cost }) }))

vi.mock("../client.js", () => ({
  runKieTask: mocks.mockRunKieTask,
  runVeoTask: mocks.mockRunVeoTask,
  createSanitizedError: mocks.mockCreateSanitizedError,
  MAX_POLL_ATTEMPTS_VIDEO: 120,
  MAX_POLL_ATTEMPTS_LIP_SYNC_LONG: 120,
}))
vi.mock("../kling3-client.js", () => ({ kling3Generate: mocks.mockKling3Generate }))
vi.mock("../reference-video-reencode.js", () => ({ reencodeReferenceVideos: async (urls: string[]) => urls }))
vi.mock("../../../lib/storage.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../lib/storage.js")>()),
  uploadBufferToR2: mocks.mockUploadBufferToR2,
}))
vi.mock("../../../lib/safe-fetch.js", () => ({ safeFetch: mocks.mockSafeFetch }))
vi.mock("sharp", () => {
  const makeChain = () => {
    const chain: Record<string, unknown> = {}
    chain.metadata = () => Promise.resolve({ format: "jpeg", width: 1024, height: 576 })
    chain.rotate = () => chain
    chain.resize = () => chain
    chain.jpeg = () => chain
    chain.webp = () => chain
    chain.png = () => chain
    chain.toBuffer = () => Promise.resolve(Buffer.from("jpeg"))
    return chain
  }
  const mockSharp = () => makeChain()
  mockSharp.default = mockSharp
  return { default: mockSharp }
})

import { KieVideoProvider } from "../video.js"
import { setPluginServices, _resetPluginServicesForTests } from "../../../lib/private-plugins/services-registry.js"
import type { PluginAlternateRoutesService } from "../../../lib/private-plugins/types.js"
import type { ProviderOptions, ReconcileOpts } from "../../provider.interface.js"

const EDIT: ProviderOptions = {
  resolution: "720p",
  referenceImageUrls: ["https://media.example/jobs/j-1/ref.jpg"],
  referenceVideoUrls: ["https://media.example/jobs/j-1/clip.mp4"],
  referenceTaskType: "edit",
}
const onTaskCreated = async () => {}
const OPTED_IN: ReconcileOpts = { onTaskCreated, routeJob: { jobId: "j-1", jobType: "text-to-video" } }

const lanes = {
  "text-to-video": (p: KieVideoProvider, opts: ReconcileOpts) =>
    p.textToVideo("Swap the jacket in @video_1 for the one in @image_1", "seedance-2-5", -1, "adaptive", EDIT, opts),
  "image-to-video": (p: KieVideoProvider, opts: ReconcileOpts) =>
    p.imageToVideo(undefined, "Swap the jacket in @video_1 for the one in @image_1", "seedance-2-5", -1, undefined, EDIT, opts),
} as const

/** What the default upstream was sent: [taskModel, body, opts] per call. */
const sent = () => mocks.mockRunKieTask.mock.calls.map((c) => ({ taskModel: c[0], body: c[1], opts: c[4] as Record<string, unknown> }))

beforeEach(() => {
  vi.clearAllMocks()
  _resetPluginServicesForTests()
  for (const k of Object.keys(mocks.job)) delete mocks.job[k]
  Object.assign(mocks.job, { id: "j-1", status: "processing", parent_job_id: null, provider_kind: "pre-task", provider_task_id: null, input_data: {} })
  mocks.mockRunKieTask.mockResolvedValue({ resultJson: { resultUrls: ["https://default.example/v.mp4"] }, taskId: "default-1" })
  mocks.mockUploadBufferToR2.mockResolvedValue("https://media.example/converted.jpg")
  mocks.mockSafeFetch.mockResolvedValue({ ok: true, status: 200, arrayBuffer: () => Promise.resolve(new ArrayBuffer(100)) })
  vi.spyOn(console, "warn").mockImplementation(() => {})
  vi.spyOn(console, "log").mockImplementation(() => {})
})

afterEach(() => _resetPluginServicesForTests())

describe.each(Object.keys(lanes) as Array<keyof typeof lanes>)("%s lane", (lane) => {
  const run = lanes[lane]
  const optedIn: ReconcileOpts = { ...OPTED_IN, routeJob: { jobId: "j-1", jobType: lane } }

  it("no plugin service: the same request and call options with or without the opt-in, and no database call", async () => {
    await run(new KieVideoProvider(), { onTaskCreated })
    await run(new KieVideoProvider(), optedIn)
    const [without, withOptIn] = sent()
    expect(withOptIn!.taskModel).toBe(without!.taskModel)
    expect(JSON.stringify(withOptIn!.body)).toBe(JSON.stringify(without!.body))
    expect(Object.keys(withOptIn!.opts).sort()).toEqual(Object.keys(without!.opts).sort())
    expect(withOptIn!.opts).not.toHaveProperty("routeJob")
    // The image lane's credit audit writes its own table, with or without the
    // opt-in; the seam reads and writes `jobs`, and does neither here.
    expect(mocks.from.mock.calls.filter((c) => c[0] !== "credit_cost_audit")).toEqual([])
  })

  it("taken: the default upstream is not called; the result has the route's figure and no default task id", async () => {
    setPluginServices({
      alternateRoutes: {
        accepts: () => ({ routeId: "route-1" }),
        start: async () => ({ taskRef: "task-9" }),
        poll: async () => ({ state: "done", resultUrl: "https://out.example/v.mp4", providerCostUsd: 0.42 }),
      } satisfies PluginAlternateRoutesService,
    })
    const result = await run(new KieVideoProvider(), optedIn)
    expect(mocks.mockRunKieTask).not.toHaveBeenCalled()
    expect(result).toEqual({ url: "https://out.example/v.mp4", cost: 0.42, routedVia: "route-1" })
    expect(result).not.toHaveProperty("kieTaskId")
  })

  it("fallen back: the default upstream receives exactly the request it gets with no plugin", async () => {
    await run(new KieVideoProvider(), { onTaskCreated })
    const baseline = sent()[0]!
    mocks.mockRunKieTask.mockClear()
    setPluginServices({
      alternateRoutes: {
        accepts: () => ({ routeId: "route-1" }),
        start: async () => ({ taskRef: "task-9" }),
        poll: async () => ({ state: "failed", message: "refused" }),
      } satisfies PluginAlternateRoutesService,
    })
    const result = await run(new KieVideoProvider(), optedIn)
    const [fellBack] = sent()
    expect(sent()).toHaveLength(1)
    expect(fellBack!.taskModel).toBe(baseline.taskModel)
    expect(JSON.stringify(fellBack!.body)).toBe(JSON.stringify(baseline.body))
    expect(fellBack!.opts).not.toHaveProperty("routeJob")
    expect(result.url).toBe("https://default.example/v.mp4")
    expect(result).not.toHaveProperty("routedVia")
  })
})
