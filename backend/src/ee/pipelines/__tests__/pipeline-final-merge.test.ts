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
  // d028845e added a dialogue probe to the final mix. Default false = no scene
  // dialogue, so these (pre-dialogue) cases mix exactly as before. Tests that
  // exercise the dialogue path override this per-case.
  hasAudioStream: vi.fn().mockResolvedValue(false),
}))
vi.mock("../../../lib/storage.js", () => ({
  uploadFileToR2: vi.fn().mockResolvedValue("https://r2/final.mp4"),
}))
vi.mock("../../../lib/credits-job-lifecycle.js", () => ({
  commitReservedCreditsForJob: vi.fn().mockResolvedValue(undefined),
  refundReservedCreditsForJob: vi.fn().mockResolvedValue(undefined),
}))
vi.mock("../pipeline-payer.js", () => ({
  getPipelineBillingContext: vi.fn(async (_sb: unknown, _pid: string, userId: string) => ({ payer: "user", userId })),
}))

// P14: the reader's answer must ride BOTH the job row and the reservation —
// asserted in test 1 below via the reserveCredits options.

// The completion funnel and the one failure writer. Mocked (rather than run
// against the fake client below) because they are module-level: they write
// through `lib/supabase.js`, not through the client this service is handed.
const markJobCompletedDetailedMock = vi.fn(async () => "completed" as
  "completed" | "lost_race" | "blocked" | "held")
const markJobFailedMock = vi.fn(async () => true)
vi.mock("../../../workers/shared.js", () => ({
  markJobCompletedDetailed: (...args: unknown[]) => markJobCompletedDetailedMock(...(args as [])),
}))
vi.mock("../../../lib/job-failure.js", () => ({
  markJobFailed: (...args: unknown[]) => markJobFailedMock(...(args as [])),
}))

// The creation funnel — where the REQUEST gate lives. Mocked so a block can be
// simulated without registering a policy; the default answer is the same row
// the fake client below would have returned.
const insertInternalJobMock = vi.fn(async () => ({ data: { id: "job-1" }, error: null }) as {
  data: { id: string } | null
  error: { message: string; blocked?: { code: "job_blocked"; policyId: string; message: string } } | null
})
vi.mock("../../../lib/insert-job.js", () => ({
  insertInternalJob: (...args: unknown[]) => insertInternalJobMock(...(args as [])),
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
  markJobCompletedDetailedMock.mockResolvedValue("completed")
  markJobFailedMock.mockResolvedValue(true)
  insertInternalJobMock.mockResolvedValue({ data: { id: "job-1" }, error: null })
})

// ─── Helpers ─────────────────────────────────────────────────────────────────

interface MakeSupabaseOpts {
  jobId?: string
  assetId?: string | null
  creditsActual?: number
  errorHint?: Record<string, unknown> | null
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
                // `error_hint` is what the result gate wrote when it blocked
                // this job — the service reads it back so the pipeline stage
                // records the POLICY's reason, not a generic merge failure.
                data: { credits_actual: opts.creditsActual ?? 3, error_hint: opts.errorHint ?? null },
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
    // P14: the durable payer stamp rides the reservation options (the carry
    // was compile-checked only until this pin).
    const { CreditsService } = await import("../../billing/credits.js")
    const reserveOptions = vi.mocked(CreditsService.reserveCredits).mock.calls[0]?.[5] as { billingContext?: { payer: string; userId: string } }
    expect(reserveOptions.billingContext).toEqual({ payer: "user", userId: "u1" })
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

    // Marked failed through the ONE failure writer. It was a bare
    // `update({status:"failed"}).eq("id")` with no status predicate at all —
    // able to trample a row the user had just cancelled.
    expect(markJobFailedMock).toHaveBeenCalledWith("job-1", expect.objectContaining({
      error_message: expect.stringContaining("ffmpeg"),
    }))
    const jobUpdates = (supabase as never as {
      _jobUpdates: Array<Record<string, unknown>>
    })._jobUpdates
    expect(jobUpdates.some((u) => u.status === "failed")).toBe(false)
  })

  it("5b. the refund rides markJobFailed's boolean — a row we did not flip is not ours to refund", async () => {
    ;(runFfmpeg as ReturnType<typeof vi.fn>).mockRejectedValueOnce(new Error("ffmpeg: boom"))
    markJobFailedMock.mockResolvedValue(false)
    const supabase = makeSupabase()

    await expect(
      pipelineFinalMerge({
        supabase,
        pipelineId: "p1",
        userId: "u1",
        scenes: [{ sceneEntityId: "s1", compositeUrl: "https://r2/s1.mp4", shots: [{ shot_id: "shot_01", duration_seconds: 5 }] }],
        musicAssetUrl: "",
      }),
    ).rejects.toThrow(/ffmpeg/)

    expect(refundReservedCreditsForJob).not.toHaveBeenCalled()
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

    // The final ffmpeg call should reference 2 inputs (video + narration) and
    // route narration as the sole audio track WITH a tail fade — narration VO
    // fades out like the music bed so it doesn't cut off abruptly when it runs
    // to the end of the film: [1:a]volume=1.0,afade=t=out...[narr].
    const ffmpegCalls = (runFfmpeg as ReturnType<typeof vi.fn>).mock.calls
    const narrationOnlyCall = ffmpegCalls.find((call) => {
      const args = call[0] as string[]
      const iCount = args.filter((a) => a === "-i").length
      return iCount === 2 && args.some((a) => /\[1:a\]volume=1\.0,afade=t=out/.test(a))
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
    // Music overlay filter is still present — post-d028845e the music branch is
    // [1:a]volume=<vol>,afade=t=out (was a bare [1:a]afade before the rework).
    expect(
      ffmpegCalls.some((call) => {
        const args = call[0] as string[]
        return args.some((a) => /\[1:a\]volume=[\d.]+,afade=t=out/.test(a))
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

// ---------------------------------------------------------------------------
// The final merge is a MEDIA PUBLICATION that used to bypass the completion
// funnel entirely: `update({status:"completed", output_data:{videoUrl}})` with
// no CAS and no gate. Its output is the pipeline's finished film — the single
// most consequential object the platform publishes — and nothing could see it.
//
// A pipeline child is hold-INELIGIBLE (`pipeline_id` is non-null — D8), so
// `held` is unreachable here; it is asserted anyway, because the failure mode
// if eligibility ever widened is the expensive one: a released reservation on
// a job whose output a human is still holding.
// ---------------------------------------------------------------------------
describe("pipelineFinalMerge — the completion funnel", () => {
  const run = (supabase: never) =>
    pipelineFinalMerge({
      supabase,
      pipelineId: "p1",
      userId: "u1",
      scenes: [{ sceneEntityId: "s1", compositeUrl: "https://r2/s1.mp4", shots: [{ shot_id: "shot_01", duration_seconds: 5 }] }],
      musicAssetUrl: "",
    })

  it("completes through markJobCompletedDetailed, never a direct status write", async () => {
    const supabase = makeSupabase()
    const result = await run(supabase)

    expect(result.finalAssetId).toBe("asset-1")
    expect(markJobCompletedDetailedMock).toHaveBeenCalledWith("job-1", {
      output_data: { videoUrl: "https://r2/final.mp4", durationSec: expect.any(Number) },
    })
    const jobUpdates = (supabase as never as { _jobUpdates: Array<Record<string, unknown>> })._jobUpdates
    expect(jobUpdates.some((u) => u.status === "completed")).toBe(false)
    expect(commitReservedCreditsForJob).toHaveBeenCalledWith("job-1")
  })

  it("a result-gate BLOCK throws JobBlockedError carrying the policy's own reason — no commit", async () => {
    markJobCompletedDetailedMock.mockResolvedValue("blocked")
    markJobFailedMock.mockResolvedValue(false) // the gate already failed the row
    const supabase = makeSupabase({
      errorHint: { kind: "policy-block", policyId: "sai-moderation", reason: "Withheld by content policy", hookPoint: "result" },
    })

    const err = await run(supabase).catch((e: unknown) => e)

    expect((err as { code?: string }).code).toBe("job_blocked")
    expect((err as Error).message).toBe("Withheld by content policy")
    expect(commitReservedCreditsForJob).not.toHaveBeenCalled()
    // The gate already refunded in full (D19) — this catch must not fire a
    // second release, which is exactly what gating on the boolean buys.
    expect(refundReservedCreditsForJob).not.toHaveBeenCalled()
  })

  it("a HOLD throws and leaves the reservation alone (contract guard — unreachable while pipeline children are hold-ineligible)", async () => {
    markJobCompletedDetailedMock.mockResolvedValue("held")
    markJobFailedMock.mockResolvedValue(false) // FAILABLE_STATUSES excludes pending_review
    const supabase = makeSupabase()

    const err = await run(supabase).catch((e: unknown) => e)

    // A hold is NOT a block — nobody judged this output, a human just has not
    // looked at it. `policy_hold` is the reason the stage must record.
    expect((err as { failureReason?: string }).failureReason).toBe("policy_hold")
    expect((err as { code?: string }).code).toBeUndefined()
    expect(commitReservedCreditsForJob).not.toHaveBeenCalled()
    expect(refundReservedCreditsForJob).not.toHaveBeenCalled()
  })

  it("a lost race (cancelled mid-merge) throws rather than returning a stale asset id", async () => {
    markJobCompletedDetailedMock.mockResolvedValue("lost_race")
    const supabase = makeSupabase()

    await expect(run(supabase)).rejects.toThrow(/already terminal|not published/i)
    expect(commitReservedCreditsForJob).not.toHaveBeenCalled()
  })

  it("a request-gate block at insert time throws JobBlockedError before any ffmpeg work", async () => {
    insertInternalJobMock.mockResolvedValue({
      data: null,
      error: {
        message: "blocked",
        blocked: { code: "job_blocked", policyId: "sai-moderation", message: "Not allowed here" },
      },
    })
    const supabase = makeSupabase()

    const err = await run(supabase).catch((e: unknown) => e)

    expect((err as { code?: string }).code).toBe("job_blocked")
    expect(downloadFile).not.toHaveBeenCalled()
  })
})

