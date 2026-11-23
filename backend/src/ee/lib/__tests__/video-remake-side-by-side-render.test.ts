import { beforeEach, describe, expect, it, vi } from "vitest"

/**
 * The production render (`renderSideBySide`) and where it keeps the file:
 *
 *  - a run's own clip: the run's key family, recorded on the run's row;
 *  - a run KEPT OFF its row (a trend run, made for an administrator): the
 *    run's scratch folder under the keyed hash, and the row is never written
 *    (its owner reads `output_data` straight from the database and on their
 *    live updates).
 */
const fx = vi.hoisted(() => ({
  updates: [] as Array<Record<string, unknown>>,
  selects: 0,
  row: { output_data: { videoUrl: "https://cdn.nodaro.ai/videos/r.mp4" } } as Record<string, unknown> | null,
  uploadKey: vi.fn(async (_path: string, key: string) => `https://cdn.nodaro.ai/${key}`),
  uploadScratch: vi.fn(async (_path: string, name: string, ext: string, _type: string, jobId: string) => `https://cdn.nodaro.ai/tmp/provider-input/${jobId}/${name}-nonce.${ext}`),
  compose: vi.fn(async (_opts: Record<string, unknown>) => ({ outputPath: "/work/side-by-side.mp4", layout: "side" as const, width: 2160, height: 1920, frames: 97 })),
}))

vi.mock("../../../lib/config.js", () => ({ config: { INTERNAL_ORCHESTRATOR_SECRET: "s".repeat(32) } }))
vi.mock("../../../lib/supabase.js", () => ({
  supabase: {
    from: () => {
      const chain = {
        select: () => (fx.selects++, chain),
        update: (patch: Record<string, unknown>) => (fx.updates.push(patch), chain),
        eq: () => chain,
        is: () => chain,
        maybeSingle: async () => ({ data: fx.row, error: null }),
        then: (resolve: (v: { error: null }) => void) => resolve({ error: null }),
      }
      return chain
    },
  },
}))
vi.mock("../../../lib/storage.js", () => ({ uploadLocalFileToR2Key: fx.uploadKey, isStorageConfigured: () => true, listObjectsByPrefixWithMeta: vi.fn() }))
vi.mock("../../../lib/storage-delete.js", () => ({ deleteKeyRecordingFailure: vi.fn(async () => undefined), deleteKeysRecordingFailures: vi.fn() }))
vi.mock("../../../lib/job-scratch.js", () => ({ uploadJobScratchFile: fx.uploadScratch }))
vi.mock("../../../providers/video/side-by-side.js", () => ({ composeSideBySide: fx.compose }))
vi.mock("../../../providers/video/ffmpeg-utils.js", () => ({ createWorkDir: async () => "/work", cleanupWorkDir: async () => undefined }))
vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>()
  return { ...actual, promises: { ...actual.promises, stat: async () => ({ size: 1024 }) } }
})

const { renderSideBySide } = await import("../video-remake-side-by-side-job.js")
const { SIDE_BY_SIDE_FIELD, SIDE_BY_SIDE_RECIPE } = await import("../video-remake-side-by-side.js")
const { sideBySideKeyHash, sideBySideVideoKey } = await import("../../../lib/job-output-keys.js")
const { jobScratchPrefix } = await import("../../../lib/job-scratch-keys.js")

const RUN = "61c80648-e2e6-487c-8b04-2a865f6a0e63"
const work = (keepOffRun: boolean) => ({
  jobId: RUN,
  ownerId: "11111111-1111-4111-8111-111111111111",
  resultUrl: `https://cdn.nodaro.ai/videos/${RUN}.mp4`,
  source: { originalUrl: "https://cdn.nodaro.ai/trends/t/src.mp4", startSec: 0, lengthSec: 4 },
  keepOffRun,
})

beforeEach(() => {
  fx.updates = []
  fx.selects = 0
  fx.uploadKey.mockClear()
  fx.uploadScratch.mockClear()
  fx.compose.mockClear()
})

describe("renderSideBySide", () => {
  it("records a run's own side by side on its row, in the run's key family", async () => {
    const record = await renderSideBySide(work(false))
    expect(fx.uploadKey).toHaveBeenCalledWith("/work/side-by-side.mp4", sideBySideVideoKey(RUN, "s".repeat(32), SIDE_BY_SIDE_RECIPE), "video/mp4")
    expect(fx.updates).toHaveLength(1)
    expect((fx.updates[0]!.output_data as Record<string, unknown>)[SIDE_BY_SIDE_FIELD]).toEqual(record)
  })

  it("never writes, nor reads, the row of a run kept off it: the file goes to the run's scratch folder under its keyed hash", async () => {
    const record = await renderSideBySide(work(true))
    expect(fx.updates).toEqual([])
    expect(fx.selects).toBe(0)
    expect(fx.uploadKey).not.toHaveBeenCalled()
    const hash = sideBySideKeyHash(RUN, "s".repeat(32), SIDE_BY_SIDE_RECIPE)
    expect(fx.uploadScratch).toHaveBeenCalledWith("/work/side-by-side.mp4", `side-by-side-${hash}`, "mp4", "video/mp4", RUN)
    expect(record.url.includes(jobScratchPrefix(RUN))).toBe(true)
    expect(record).toMatchObject({ v: SIDE_BY_SIDE_RECIPE, width: 2160, height: 1920, layout: "side" })
  })

  it("renders under a deadline", async () => {
    await renderSideBySide(work(false))
    expect(fx.compose.mock.calls[0]![0].signal).toBeInstanceOf(AbortSignal)
  })
})
