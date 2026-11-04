import { describe, it, expect, vi, beforeEach } from "vitest"

/**
 * The audio-separation split records what Replicate billed for the run as the
 * job's `provider_cost`, beside the same `output_data` as before. The charge is
 * untouched: the run is fixed-priced, so it still commits the reserved tier.
 */

const mocks = vi.hoisted(() => ({
  separateAudio: vi.fn(),
  uploadToR2: vi.fn(async (_url: string, key: string) => `https://r2.example.com/audio/${key}.mp3`),
  markJobCompleted: vi.fn(async () => true),
  commitJobCredits: vi.fn(async () => undefined),
  shouldSaveJobResult: vi.fn(async () => true),
}))

vi.mock("@/providers/replicate/audio-separation.js", () => ({
  ReplicateAudioSeparationProvider: class {
    separateAudio = mocks.separateAudio
  },
}))
vi.mock("@/lib/storage.js", () => ({
  uploadToR2: mocks.uploadToR2,
  uploadBufferToR2: vi.fn(),
  uploadFileToR2: vi.fn(),
  mediaObjectKey: (id: string, type: string, ext: string) => `${type}s/${id}.${ext}`,
}))
vi.mock("@/lib/supabase.js", () => ({
  supabase: { from: vi.fn().mockReturnValue({ update: vi.fn().mockReturnValue({ eq: vi.fn().mockResolvedValue({ data: null, error: null }) }) }) },
}))
vi.mock("../../shared.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../shared.js")>()),
  commitJobCredits: mocks.commitJobCredits,
  markJobCompleted: mocks.markJobCompleted,
  shouldSaveJobResult: mocks.shouldSaveJobResult,
  setJobProgress: vi.fn(async () => undefined),
  withProgressRamp: vi.fn(async (_job: unknown, _id: unknown, _opts: unknown, fn: () => Promise<unknown>) => fn()),
}))

import { audioAIHandlers } from "../audio-ai.js"

const JOB_ID = "00000000-0000-4000-8000-000000000a01"
const USAGE_LOG_ID = "00000000-0000-4000-8000-000000000a02"
const ctx = { jobId: JOB_ID, jobUserId: "user-1", usageLogId: USAGE_LOG_ID, shouldWatermark: false }
const job = (data: Record<string, unknown>) => ({ name: "audio-separation", data: { jobId: JOB_ID, audioUrl: "https://example.com/song.mp3", ...data }, id: "bull-1", updateProgress: vi.fn() })
const r2 = (stem: string) => `https://r2.example.com/audio/${JOB_ID}-${stem}.mp3`

const VOCAL_SPLIT = { vocals: "https://replicate.example/vocals.mp3", instrumental: "https://replicate.example/inst.mp3" }
const VOCAL_SPLIT_OUTPUT = { vocalUrl: r2("vocals"), instrumentalUrl: r2("instrumental"), audioUrl: r2("vocals") }
const STEMS = {
  vocals: "https://replicate.example/vocals.mp3",
  drums: "https://replicate.example/drums.mp3",
  bass: "https://replicate.example/bass.mp3",
  other: "https://replicate.example/other.mp3",
}
const STEMS_OUTPUT = { vocalUrl: r2("vocals"), drumsUrl: r2("drums"), bassUrl: r2("bass"), otherUrl: r2("other"), audioUrl: r2("vocals") }

const run = (data: Record<string, unknown> = {}) => audioAIHandlers["audio-separation"](job(data) as never, ctx as never)
const completedWith = () => mocks.markJobCompleted.mock.calls[0] as unknown as [string, Record<string, unknown>]

beforeEach(() => {
  vi.clearAllMocks()
  mocks.markJobCompleted.mockResolvedValue(true)
  mocks.shouldSaveJobResult.mockResolvedValue(true)
})

describe("audio-separation — the recorded provider cost", () => {
  it("a vocal split records Replicate's figure beside the same stems as before", async () => {
    mocks.separateAudio.mockResolvedValueOnce({ ...VOCAL_SPLIT, cost: 0.0123 })
    await run()
    expect(completedWith()).toEqual([JOB_ID, { output_data: VOCAL_SPLIT_OUTPUT, provider_cost: 0.0123 }])
  })

  it("another run records its own figure (a full-stems split)", async () => {
    mocks.separateAudio.mockResolvedValueOnce({ ...STEMS, cost: 0.05 })
    await run({ mode: "stems" })
    expect(completedWith()).toEqual([JOB_ID, { output_data: STEMS_OUTPUT, provider_cost: 0.05 }])
  })

  it("a run with no cost writes exactly the output, as before", async () => {
    mocks.separateAudio.mockResolvedValueOnce({ ...VOCAL_SPLIT, cost: undefined })
    await run()
    expect(completedWith()).toEqual([JOB_ID, { output_data: VOCAL_SPLIT_OUTPUT }])
  })

  it("a null cost (no prediction metrics) writes exactly the output too", async () => {
    mocks.separateAudio.mockResolvedValueOnce({ ...VOCAL_SPLIT, cost: null })
    await run()
    expect(completedWith()).toEqual([JOB_ID, { output_data: VOCAL_SPLIT_OUTPUT }])
  })

  it("every run commits the reserved tier: exactly (usageLogId, jobId), whatever the cost", async () => {
    for (const cost of [0.0123, 0.05, undefined]) {
      mocks.commitJobCredits.mockClear()
      mocks.separateAudio.mockResolvedValueOnce({ ...VOCAL_SPLIT, cost })
      await run()
      expect(mocks.commitJobCredits).toHaveBeenCalledTimes(1)
      expect(mocks.commitJobCredits.mock.calls[0]).toEqual([USAGE_LOG_ID, JOB_ID])
    }
  })
})
