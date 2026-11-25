import { describe, it, expect, vi } from "vitest"
import { layDrivingAudioIfSilent } from "../driving-audio-lay.js"

/**
 * Audio-to-video's sound (decided 2026-11-23): a silent render gets its
 * driving clip laid on, fitted to the picture, and is stored ONCE at the
 * job's own key — watermarked when the job is — as the job's media.
 */
describe("layDrivingAudioIfSilent", () => {
  const args = (deps: Record<string, unknown>, watermark = false) => ({
    videoUrl: "https://x/out.mp4", audioUrl: "https://x/a.mp3", jobId: "j", userId: "u", watermark, deps: deps as never,
  })

  it("a render with sound is left to be stored as usual", async () => {
    const merge = vi.fn()
    const store = vi.fn()
    expect(await layDrivingAudioIfSilent(args({ probe: vi.fn().mockResolvedValue({ hasAudio: true, hasVideo: true }), merge, store }))).toEqual({ kind: "as-rendered" })
    expect(merge).not.toHaveBeenCalled()
    expect(store).not.toHaveBeenCalled()
  })

  it.each([true, false])("a silent render is laid on, fitted to the picture, and stored once at the job's key (watermark %s)", async (watermark) => {
    const merge = vi.fn().mockResolvedValue("/tmp/work-1/merged.mp4")
    // Through the video result funnel: its stored video comes back.
    const store = vi.fn().mockResolvedValue({ videoUrl: "https://r2/videos/j.mp4" })
    const out = await layDrivingAudioIfSilent(args({ probe: vi.fn().mockResolvedValue({ hasAudio: false, hasVideo: true }), merge, store }, watermark))
    expect(out).toEqual({ kind: "stored", url: "https://r2/videos/j.mp4", stored: { videoUrl: "https://r2/videos/j.mp4" } })
    expect(merge.mock.calls[0]![0]).toMatchObject({ videoUrl: "https://x/out.mp4", fitAudioToVideo: true })
    expect(store).toHaveBeenCalledTimes(1)
    expect(store).toHaveBeenCalledWith("/tmp/work-1/merged.mp4", "j", "u", watermark)
    expect(JSON.stringify(store.mock.calls)).not.toContain("-driving-audio")
  })

  it("a cancel from the store is rethrown, never stored again as rendered", async () => {
    const verdict = Object.assign(new Error("Job j was cancelled"), { name: "JobCancelledError" })
    const store = vi.fn().mockRejectedValue(verdict)
    await expect(layDrivingAudioIfSilent(args({ probe: vi.fn().mockResolvedValue({ hasAudio: false }), merge: vi.fn().mockResolvedValue("/tmp/w/m.mp4"), store }))).rejects.toBe(verdict)
  })

  it("an unusable verdict on our own merge output falls back to the provider's render as it came (before and after the migration)", async () => {
    const verdict = Object.assign(new Error("unusable-video: the video delivered for j has no picture that decodes"), { name: "UnusableVideoError", deterministic: true })
    const store = vi.fn().mockRejectedValue(verdict)
    expect(await layDrivingAudioIfSilent(args({ probe: vi.fn().mockResolvedValue({ hasAudio: false }), merge: vi.fn().mockResolvedValue("/tmp/w/m.mp4"), store }))).toEqual({ kind: "as-rendered" })
  })

  it("a probe or merge failure never fails the paid render", async () => {
    expect(await layDrivingAudioIfSilent(args({ probe: vi.fn().mockRejectedValue(new Error("x")) }))).toEqual({ kind: "as-rendered" })
    expect(await layDrivingAudioIfSilent(args({ probe: vi.fn().mockResolvedValue({ hasAudio: false }), merge: vi.fn().mockRejectedValue(new Error("y")) }))).toEqual({ kind: "as-rendered" })
  })
})
