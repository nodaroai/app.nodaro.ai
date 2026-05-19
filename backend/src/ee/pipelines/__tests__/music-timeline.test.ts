import { describe, it, expect, vi, beforeEach } from "vitest"

vi.mock("../events.js", () => ({
  pipelineEvents: { publish: vi.fn() },
}))
vi.mock("../services/pipeline-generate-music.js", () => ({
  pipelineGenerateMusic: vi.fn(),
}))
vi.mock("../services/pipeline-extract-beat-grid.js", () => ({
  pipelineExtractBeatGrid: vi.fn(),
}))

import { pipelineEvents } from "../events.js"
import { pipelineGenerateMusic } from "../services/pipeline-generate-music.js"
import { pipelineExtractBeatGrid } from "../services/pipeline-extract-beat-grid.js"
import { buildMusicPrompt, runMusicTimeline } from "../music-timeline.js"

beforeEach(() => vi.clearAllMocks())

describe("buildMusicPrompt", () => {
  it("uses explicit plan.prompt when present", () => {
    expect(buildMusicPrompt({ prompt: "ambient drone, slow build" })).toBe(
      "ambient drone, slow build",
    )
  })

  it("composes prompt from style + bpm_target", () => {
    expect(buildMusicPrompt({ style: "tense orchestral", bpm_target: 110 })).toBe(
      "tense orchestral, 110 bpm, instrumental, no vocals, cinematic score",
    )
  })

  it("falls back to generic instrumental score when plan is empty", () => {
    expect(buildMusicPrompt(undefined)).toBe("instrumental, no vocals, cinematic score")
    expect(buildMusicPrompt({})).toBe("instrumental, no vocals, cinematic score")
  })
})

describe("runMusicTimeline", () => {
  it("returns early with disabled result when music_enabled=false", async () => {
    const supabase = {} as never
    const result = await runMusicTimeline({
      supabase,
      pipelineId: "p1",
      stageId: "stage-7",
      userId: "u1",
      totalDurationSec: 60,
      config: { music_enabled: false },
      plan: {},
    })
    expect(result.enabled).toBe(false)
    expect(result.musicAssetUrl).toBe("")
    expect(result.beatGrid).toEqual([])
    expect(pipelineGenerateMusic).not.toHaveBeenCalled()
    expect(pipelineExtractBeatGrid).not.toHaveBeenCalled()
    expect(pipelineEvents.publish).not.toHaveBeenCalled()
  })

  it("happy path: generates music, extracts beat grid, emits pipeline:music_ready", async () => {
    ;(pipelineGenerateMusic as ReturnType<typeof vi.fn>).mockResolvedValue({
      jobId: "music-job-1",
      assetId: "asset-1",
      assetUrl: "https://r2/raw.mp3",
      creditsSpent: 0,
    })
    ;(pipelineExtractBeatGrid as ReturnType<typeof vi.fn>).mockResolvedValue({
      trimmedAssetUrl: "https://r2/trimmed.mp3",
      beatGridSeconds: [0.5, 1.0, 1.5, 2.0],
      detectedBPM: 120,
    })

    const supabase = {} as never
    const result = await runMusicTimeline({
      supabase,
      pipelineId: "p1",
      stageId: "stage-7",
      userId: "u1",
      totalDurationSec: 60,
      config: {},
      plan: { music_plan: { bpm_target: 120, style: "epic" } },
    })

    expect(result.enabled).toBe(true)
    expect(result.musicAssetUrl).toBe("https://r2/trimmed.mp3")
    expect(result.beatGrid).toEqual([0.5, 1.0, 1.5, 2.0])
    expect(result.detectedBPM).toBe(120)
    expect(result.plannedBPM).toBe(120)
    expect(result.realignmentNeeded).toBe(false)

    // Suno call sized at target + 5s.
    expect(pipelineGenerateMusic).toHaveBeenCalledWith(
      expect.objectContaining({ durationSec: 65 }),
    )
    expect(pipelineExtractBeatGrid).toHaveBeenCalledWith(
      expect.objectContaining({
        musicUrl: "https://r2/raw.mp3",
        targetDurationSec: 60,
      }),
    )
    expect(pipelineEvents.publish).toHaveBeenCalledWith({
      type: "pipeline:music_ready",
      pipelineId: "p1",
      musicAssetUrl: "https://r2/trimmed.mp3",
      beatGridLength: 4,
    })
  })

  it("realignmentNeeded=true when |detected - planned| > 2 BPM", async () => {
    ;(pipelineGenerateMusic as ReturnType<typeof vi.fn>).mockResolvedValue({
      jobId: "j",
      assetId: "a",
      assetUrl: "https://r2/m.mp3",
      creditsSpent: 0,
    })
    ;(pipelineExtractBeatGrid as ReturnType<typeof vi.fn>).mockResolvedValue({
      trimmedAssetUrl: "https://r2/trim.mp3",
      beatGridSeconds: [0, 0.5, 1.0],
      detectedBPM: 130, // 130 - 110 = 20 > 2
    })

    const result = await runMusicTimeline({
      supabase: {} as never,
      pipelineId: "p1",
      stageId: "stage-7",
      userId: "u1",
      totalDurationSec: 30,
      config: { music_enabled: true },
      plan: { music_plan: { bpm_target: 110 } },
    })

    expect(result.realignmentNeeded).toBe(true)
    expect(result.detectedBPM).toBe(130)
    expect(result.plannedBPM).toBe(110)
  })

  it("realignmentNeeded=false when no plannedBPM is set (no drift signal)", async () => {
    ;(pipelineGenerateMusic as ReturnType<typeof vi.fn>).mockResolvedValue({
      jobId: "j",
      assetId: "a",
      assetUrl: "https://r2/m.mp3",
      creditsSpent: 0,
    })
    ;(pipelineExtractBeatGrid as ReturnType<typeof vi.fn>).mockResolvedValue({
      trimmedAssetUrl: "https://r2/trim.mp3",
      beatGridSeconds: [0, 0.5, 1.0],
      detectedBPM: 120,
    })

    const result = await runMusicTimeline({
      supabase: {} as never,
      pipelineId: "p1",
      stageId: "stage-7",
      userId: "u1",
      totalDurationSec: 30,
      config: {},
      plan: {},
    })

    expect(result.plannedBPM).toBe(0)
    expect(result.realignmentNeeded).toBe(false)
  })

  it("Suno failure bubbles up to caller", async () => {
    ;(pipelineGenerateMusic as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("Suno backend error"),
    )

    await expect(
      runMusicTimeline({
        supabase: {} as never,
        pipelineId: "p1",
        stageId: "stage-7",
        userId: "u1",
        totalDurationSec: 30,
        config: {},
        plan: {},
      }),
    ).rejects.toThrow("Suno backend error")

    expect(pipelineExtractBeatGrid).not.toHaveBeenCalled()
    expect(pipelineEvents.publish).not.toHaveBeenCalled()
  })

  it("beat-grid extraction failure degrades gracefully to empty grid", async () => {
    ;(pipelineGenerateMusic as ReturnType<typeof vi.fn>).mockResolvedValue({
      jobId: "j",
      assetId: "a",
      assetUrl: "https://r2/raw.mp3",
      creditsSpent: 0,
    })
    // Internal extractor swallows ffmpeg errors and resolves with empty grid;
    // but if something exotic throws (uncovered case), the orchestrator falls
    // back to the un-trimmed Suno URL + empty grid.
    ;(pipelineExtractBeatGrid as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("R2 upload failed"),
    )

    const result = await runMusicTimeline({
      supabase: {} as never,
      pipelineId: "p1",
      stageId: "stage-7",
      userId: "u1",
      totalDurationSec: 30,
      config: {},
      plan: {},
    })

    expect(result.musicAssetUrl).toBe("https://r2/raw.mp3")
    expect(result.beatGrid).toEqual([])
    expect(result.detectedBPM).toBe(0)
    // Still emits pipeline:music_ready so the UI can render the un-trimmed track.
    expect(pipelineEvents.publish).toHaveBeenCalled()
  })
})
