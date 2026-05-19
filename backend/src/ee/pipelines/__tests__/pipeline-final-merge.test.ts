import { describe, it, expect, vi, beforeEach } from "vitest"

// Mock low-level FFmpeg + storage + credit lifecycle helpers BEFORE importing
// the SUT so the SUT's static imports pick up the mocks. Paths are relative
// to the SUT (`services/pipeline-final-merge.ts`), NOT to this test file.
vi.mock("node:fs", () => ({
  promises: {
    writeFile: vi.fn().mockResolvedValue(undefined),
    readFile: vi.fn().mockResolvedValue(Buffer.from("")),
    rm: vi.fn().mockResolvedValue(undefined),
  },
}))

vi.mock("../../../providers/video/ffmpeg-utils.js", () => ({
  createWorkDir: vi.fn().mockResolvedValue("/tmp/test-workdir"),
  cleanupWorkDir: vi.fn().mockResolvedValue(undefined),
  downloadFile: vi.fn().mockResolvedValue(undefined),
  getVideoDuration: vi.fn().mockResolvedValue(5.0),
  runFfmpeg: vi.fn().mockResolvedValue(""),
  normalizeVideoForCombine: vi.fn().mockResolvedValue(undefined),
}))
vi.mock("../../../lib/storage.js", () => ({
  uploadFileToR2: vi.fn().mockResolvedValue("https://r2/final.mp4"),
}))
vi.mock("../../../lib/credits-job-lifecycle.js", () => ({
  commitReservedCreditsForJob: vi.fn().mockResolvedValue(undefined),
  refundReservedCreditsForJob: vi.fn().mockResolvedValue(undefined),
}))
vi.mock("../../billing/credits.js", () => ({
  CreditsService: {
    reserveCredits: vi.fn().mockResolvedValue({
      usageLogId: "log-1",
      creditsReserved: 3,
      watermark: false,
    }),
  },
}))

import {
  runFfmpeg,
  downloadFile,
  getVideoDuration,
} from "../../../providers/video/ffmpeg-utils.js"
import { uploadFileToR2 } from "../../../lib/storage.js"
import {
  commitReservedCreditsForJob,
  refundReservedCreditsForJob,
} from "../../../lib/credits-job-lifecycle.js"
import { pipelineFinalMerge } from "../services/pipeline-final-merge.js"

// Path-mapping note: vitest resolves these mocks against the SUT under
// `services/pipeline-final-merge.ts`. The SUT imports
// `../../../providers/video/ffmpeg-utils.js` (3 levels up = backend/src).
// The mock paths above mirror that walk-up FROM the test file location
// (`__tests__/`), which is also under `backend/src/ee/pipelines/`.

beforeEach(() => {
  vi.clearAllMocks()
})

// ─── Helpers ─────────────────────────────────────────────────────────────────

interface MakeSupabaseOpts {
  jobId?: string
  assetId?: string | null
  creditsActual?: number
}

function makeSupabase(opts: MakeSupabaseOpts = {}) {
  const jobUpdates: Array<Record<string, unknown>> = []
  const assetInserts: Array<Record<string, unknown>> = []
  return {
    from: (table: string) => {
      if (table === "jobs") {
        return {
          insert: () => ({
            select: () => ({
              single: async () => ({
                data: { id: opts.jobId ?? "job-1" },
                error: null,
              }),
            }),
          }),
          update: (patch: Record<string, unknown>) => ({
            eq: async () => {
              jobUpdates.push(patch)
              return { data: null, error: null }
            },
          }),
          select: () => ({
            eq: () => ({
              single: async () => ({
                data: { credits_actual: opts.creditsActual ?? 3 },
                error: null,
              }),
            }),
          }),
        }
      }
      if (table === "assets") {
        return {
          insert: (row: Record<string, unknown>) => ({
            select: () => ({
              single: async () => {
                assetInserts.push(row)
                return {
                  data: { id: opts.assetId ?? "asset-1" },
                  error: null,
                }
              },
            }),
          }),
        }
      }
      throw new Error(`Unmocked table: ${table}`)
    },
    _jobUpdates: jobUpdates,
    _assetInserts: assetInserts,
  } as never
}

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("pipelineFinalMerge", () => {
  it("1. single scene, no music → final = trimmed scene, no concat call", async () => {
    const supabase = makeSupabase()
    const result = await pipelineFinalMerge({
      supabase,
      pipelineId: "p1",
      userId: "u1",
      scenes: [
        {
          sceneEntityId: "scene-1",
          compositeUrl: "https://r2/scene-1.mp4",
          shots: [
            { shot_id: "shot_01", duration_seconds: 5 },
          ],
        },
      ],
      musicAssetUrl: "",
    })

    expect(result.finalAssetUrl).toBe("https://r2/final.mp4")
    expect(result.finalAssetId).toBe("asset-1")
    expect(downloadFile).toHaveBeenCalledWith(
      "https://r2/scene-1.mp4",
      expect.any(String),
    )
    // For single scene with no trim, no music: should still go through
    // normalize → chainCombine returns the single clip → final fade-only
    // ffmpeg call.
    expect(commitReservedCreditsForJob).toHaveBeenCalledWith("job-1")
    expect(refundReservedCreditsForJob).not.toHaveBeenCalled()
  })

  it("2. multi-scene with hard_cut transitions + music → concat demuxer + audio overlay", async () => {
    const supabase = makeSupabase()
    const result = await pipelineFinalMerge({
      supabase,
      pipelineId: "p1",
      userId: "u1",
      scenes: [
        {
          sceneEntityId: "scene-1",
          compositeUrl: "https://r2/scene-1.mp4",
          shots: [
            {
              shot_id: "shot_01",
              duration_seconds: 5,
              cut_decision: {
                in_offset_sec: 0,
                out_offset_sec: 0,
                transition_to_next: "hard_cut",
              },
            },
          ],
        },
        {
          sceneEntityId: "scene-2",
          compositeUrl: "https://r2/scene-2.mp4",
          shots: [
            {
              shot_id: "shot_02",
              duration_seconds: 5,
              cut_decision: {
                in_offset_sec: 0,
                out_offset_sec: 0,
                transition_to_next: "hard_cut",
              },
            },
          ],
        },
      ],
      musicAssetUrl: "https://r2/music.mp3",
    })

    expect(result.finalAssetUrl).toBe("https://r2/final.mp4")
    // Music URL downloaded.
    const downloads = (downloadFile as ReturnType<typeof vi.fn>).mock.calls.map(
      (c) => c[0] as string,
    )
    expect(downloads).toContain("https://r2/music.mp3")

    // At least one ffmpeg call should reference the music input with the
    // afade music overlay shape.
    const ffmpegCalls = (runFfmpeg as ReturnType<typeof vi.fn>).mock.calls
    const hasMusicOverlay = ffmpegCalls.some((call) => {
      const args = call[0] as string[]
      return args.some((a) => /afade=t=out/.test(a) && /\[1:a\]/.test(a))
    })
    expect(hasMusicOverlay).toBe(true)
  })

  it("3. multi-scene with dissolve transition → xfade applied", async () => {
    const supabase = makeSupabase()
    await pipelineFinalMerge({
      supabase,
      pipelineId: "p1",
      userId: "u1",
      scenes: [
        {
          sceneEntityId: "scene-1",
          compositeUrl: "https://r2/scene-1.mp4",
          shots: [
            {
              shot_id: "shot_01",
              duration_seconds: 5,
              cut_decision: {
                in_offset_sec: 0,
                out_offset_sec: 0,
                transition_to_next: "dissolve",
                transition_duration_sec: 0.6,
              },
            },
          ],
        },
        {
          sceneEntityId: "scene-2",
          compositeUrl: "https://r2/scene-2.mp4",
          shots: [
            { shot_id: "shot_02", duration_seconds: 5 },
          ],
        },
      ],
      musicAssetUrl: "",
    })

    // At least one ffmpeg call should reference the xfade filter.
    const ffmpegCalls = (runFfmpeg as ReturnType<typeof vi.fn>).mock.calls
    const hasXfade = ffmpegCalls.some((call) => {
      const args = call[0] as string[]
      return args.some((a) => /xfade=transition=fade/.test(a))
    })
    expect(hasXfade).toBe(true)
  })

  it("4. music disabled → no music input arg in any ffmpeg call", async () => {
    const supabase = makeSupabase()
    await pipelineFinalMerge({
      supabase,
      pipelineId: "p1",
      userId: "u1",
      scenes: [
        {
          sceneEntityId: "scene-1",
          compositeUrl: "https://r2/scene-1.mp4",
          shots: [{ shot_id: "shot_01", duration_seconds: 5 }],
        },
      ],
      musicAssetUrl: "",
    })

    // No download call should target music.mp3.
    const downloads = (downloadFile as ReturnType<typeof vi.fn>).mock.calls.map(
      (c) => c[0] as string,
    )
    expect(downloads.some((url) => /music/.test(url))).toBe(false)

    // No ffmpeg call should contain the music-overlay filter shape.
    const ffmpegCalls = (runFfmpeg as ReturnType<typeof vi.fn>).mock.calls
    const hasMusicOverlay = ffmpegCalls.some((call) => {
      const args = call[0] as string[]
      return args.some((a) => /\[1:a\]afade=t=out/.test(a))
    })
    expect(hasMusicOverlay).toBe(false)
  })

  it("5. FFmpeg failure → refund credits + throw", async () => {
    ;(runFfmpeg as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
      new Error("ffmpeg: invalid filter"),
    )
    const supabase = makeSupabase()

    await expect(
      pipelineFinalMerge({
        supabase,
        pipelineId: "p1",
        userId: "u1",
        scenes: [
          {
            sceneEntityId: "scene-1",
            compositeUrl: "https://r2/scene-1.mp4",
            shots: [{ shot_id: "shot_01", duration_seconds: 5 }],
          },
        ],
        musicAssetUrl: "",
      }),
    ).rejects.toThrow(/ffmpeg/)

    expect(refundReservedCreditsForJob).toHaveBeenCalledWith("job-1")
    expect(commitReservedCreditsForJob).not.toHaveBeenCalled()

    // Job should be marked failed.
    const jobUpdates = (supabase as never as {
      _jobUpdates: Array<Record<string, unknown>>
    })._jobUpdates
    expect(jobUpdates.some((u) => u.status === "failed")).toBe(true)
  })

  // ─── Phase 1C.2.1 §G5 — narration audio overlay ──────────────────────────

  it("G5: narration + music → amix with music ducked to 0.6 volume", async () => {
    const supabase = makeSupabase()
    await pipelineFinalMerge({
      supabase,
      pipelineId: "p1",
      userId: "u1",
      scenes: [
        {
          sceneEntityId: "scene-1",
          compositeUrl: "https://r2/scene-1.mp4",
          shots: [{ shot_id: "shot_01", duration_seconds: 5 }],
        },
      ],
      musicAssetUrl: "https://r2/music.mp3",
      narrationAssetUrl: "https://r2/narration.mp3",
    })

    // Both music + narration should be downloaded.
    const downloads = (downloadFile as ReturnType<typeof vi.fn>).mock.calls.map(
      (c) => c[0] as string,
    )
    expect(downloads).toContain("https://r2/music.mp3")
    expect(downloads).toContain("https://r2/narration.mp3")

    // The final ffmpeg call should reference all three inputs (video, music,
    // narration) and the amix filter with music ducked to 0.6.
    const ffmpegCalls = (runFfmpeg as ReturnType<typeof vi.fn>).mock.calls
    const mixCall = ffmpegCalls.find((call) => {
      const args = call[0] as string[]
      return args.some((a) => /amix=inputs=2/.test(a))
    })
    expect(mixCall).toBeDefined()
    const args = mixCall![0] as string[]
    // Music input precedes narration input.
    const musicIdx = args.indexOf("https://r2/music.mp3") // not in args (downloadFile copies to tmp)
    expect(musicIdx).toBe(-1) // downloaded to /tmp/.../music.mp3
    // The filter_complex string carries the amix + ducked-volume pieces.
    const filterArg = args.find((a) => /amix=inputs=2/.test(a))
    expect(filterArg).toBeDefined()
    expect(filterArg!).toMatch(/\[1:a\]volume=0\.6/)
    expect(filterArg!).toMatch(/amix=inputs=2:duration=longest/)
    // Verify the input ordering: -i concat -i music -i narration.
    const iIndices = args
      .map((a, idx) => (a === "-i" ? idx : -1))
      .filter((i) => i >= 0)
    expect(iIndices.length).toBe(3)
    // The narration input should be 3rd (last).
    expect(args[iIndices[2]! + 1]).toMatch(/narration\.mp3$/)
  })

  it("G5: narration only (no music) → narration is sole audio track", async () => {
    const supabase = makeSupabase()
    await pipelineFinalMerge({
      supabase,
      pipelineId: "p1",
      userId: "u1",
      scenes: [
        {
          sceneEntityId: "scene-1",
          compositeUrl: "https://r2/scene-1.mp4",
          shots: [{ shot_id: "shot_01", duration_seconds: 5 }],
        },
      ],
      musicAssetUrl: "",
      narrationAssetUrl: "https://r2/narration.mp3",
    })

    const downloads = (downloadFile as ReturnType<typeof vi.fn>).mock.calls.map(
      (c) => c[0] as string,
    )
    expect(downloads).toContain("https://r2/narration.mp3")
    expect(downloads.every((url) => !/music/.test(url))).toBe(true)

    // The final ffmpeg call should reference 2 inputs (video + narration)
    // and apply afade on [1:a] (the narration track).
    const ffmpegCalls = (runFfmpeg as ReturnType<typeof vi.fn>).mock.calls
    const narrationOnlyCall = ffmpegCalls.find((call) => {
      const args = call[0] as string[]
      const iCount = args.filter((a) => a === "-i").length
      return iCount === 2 && args.some((a) => /\[1:a\]afade/.test(a))
    })
    expect(narrationOnlyCall).toBeDefined()
    // Importantly: NO amix filter (only narration → no mix).
    expect(
      ffmpegCalls.some((call) => {
        const args = call[0] as string[]
        return args.some((a) => /amix=inputs=2/.test(a))
      }),
    ).toBe(false)
  })

  it("G5: music only (no narration) → existing behavior preserved (no amix)", async () => {
    const supabase = makeSupabase()
    await pipelineFinalMerge({
      supabase,
      pipelineId: "p1",
      userId: "u1",
      scenes: [
        {
          sceneEntityId: "scene-1",
          compositeUrl: "https://r2/scene-1.mp4",
          shots: [{ shot_id: "shot_01", duration_seconds: 5 }],
        },
      ],
      musicAssetUrl: "https://r2/music.mp3",
      // narrationAssetUrl omitted (undefined).
    })

    const ffmpegCalls = (runFfmpeg as ReturnType<typeof vi.fn>).mock.calls
    // No amix call — music-only path is the existing 1C.2 single-music-track
    // behavior.
    expect(
      ffmpegCalls.some((call) => {
        const args = call[0] as string[]
        return args.some((a) => /amix=inputs=2/.test(a))
      }),
    ).toBe(false)
    // Music overlay filter is still present.
    expect(
      ffmpegCalls.some((call) => {
        const args = call[0] as string[]
        return args.some((a) => /\[1:a\]afade=t=out/.test(a))
      }),
    ).toBe(true)
  })

  it("G5: neither narration nor music → existing video-only fade behavior", async () => {
    const supabase = makeSupabase()
    await pipelineFinalMerge({
      supabase,
      pipelineId: "p1",
      userId: "u1",
      scenes: [
        {
          sceneEntityId: "scene-1",
          compositeUrl: "https://r2/scene-1.mp4",
          shots: [{ shot_id: "shot_01", duration_seconds: 5 }],
        },
      ],
      musicAssetUrl: "",
      // narrationAssetUrl omitted.
    })

    // No music download, no narration download.
    const downloads = (downloadFile as ReturnType<typeof vi.fn>).mock.calls.map(
      (c) => c[0] as string,
    )
    expect(downloads.every((url) => !/music/.test(url) && !/narration/.test(url))).toBe(true)

    // No amix call.
    const ffmpegCalls = (runFfmpeg as ReturnType<typeof vi.fn>).mock.calls
    expect(
      ffmpegCalls.some((call) => {
        const args = call[0] as string[]
        return args.some((a) => /amix=inputs=2/.test(a))
      }),
    ).toBe(false)
  })

  it("G5: amix failure falls back to fade-only output (pipeline still ships)", async () => {
    // Fail ONLY the amix ffmpeg call; everything else (normalize, concat,
    // fallback fade) succeeds. The downstream fade-only call is at the end
    // of the catch path, so we let it succeed with the default mock.
    const ffmpeg = runFfmpeg as ReturnType<typeof vi.fn>
    ffmpeg.mockImplementation((args: string[]) => {
      if (args.some((a) => /amix=inputs=2/.test(a))) {
        return Promise.reject(new Error("ffmpeg: amix filter exploded"))
      }
      return Promise.resolve("")
    })

    const supabase = makeSupabase()
    const result = await pipelineFinalMerge({
      supabase,
      pipelineId: "p1",
      userId: "u1",
      scenes: [
        {
          sceneEntityId: "scene-1",
          compositeUrl: "https://r2/scene-1.mp4",
          shots: [{ shot_id: "shot_01", duration_seconds: 5 }],
        },
      ],
      musicAssetUrl: "https://r2/music.mp3",
      narrationAssetUrl: "https://r2/narration.mp3",
    })

    // The merge still produced a final asset URL (fallback worked).
    expect(result.finalAssetUrl).toBe("https://r2/final.mp4")
    // Credits committed (the dispatch did NOT throw — only the inner mix
    // failed, which is caught and degraded to fade-only).
    expect(commitReservedCreditsForJob).toHaveBeenCalledWith("job-1")
    expect(refundReservedCreditsForJob).not.toHaveBeenCalled()
  })

  it("6. per-scene head trim applied via -ss + -t when cut_decision.in_offset_sec > 0", async () => {
    ;(getVideoDuration as ReturnType<typeof vi.fn>).mockResolvedValue(5.0)
    const supabase = makeSupabase()
    await pipelineFinalMerge({
      supabase,
      pipelineId: "p1",
      userId: "u1",
      scenes: [
        {
          sceneEntityId: "scene-1",
          compositeUrl: "https://r2/scene-1.mp4",
          shots: [
            {
              shot_id: "shot_01",
              duration_seconds: 5,
              cut_decision: {
                in_offset_sec: 0.5,
                out_offset_sec: 0.3,
                transition_to_next: "hard_cut",
              },
            },
          ],
        },
      ],
      musicAssetUrl: "",
    })

    const ffmpegCalls = (runFfmpeg as ReturnType<typeof vi.fn>).mock.calls
    const hasTrim = ffmpegCalls.some((call) => {
      const args = call[0] as string[]
      const ssIdx = args.indexOf("-ss")
      return ssIdx >= 0 && args[ssIdx + 1] === "0.5"
    })
    expect(hasTrim).toBe(true)
  })
})
