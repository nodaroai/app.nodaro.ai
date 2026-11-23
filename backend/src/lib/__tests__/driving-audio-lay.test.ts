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
    const store = vi.fn().mockResolvedValue("https://r2/videos/j.mp4")
    const out = await layDrivingAudioIfSilent(args({ probe: vi.fn().mockResolvedValue({ hasAudio: false, hasVideo: true }), merge, store }, watermark))
    expect(out).toEqual({ kind: "stored", url: "https://r2/videos/j.mp4" })
    expect(merge.mock.calls[0]![0]).toMatchObject({ videoUrl: "https://x/out.mp4", fitAudioToVideo: true })
    expect(store).toHaveBeenCalledTimes(1)
    expect(store).toHaveBeenCalledWith("/tmp/work-1/merged.mp4", "j", "u", watermark)
    expect(JSON.stringify(store.mock.calls)).not.toContain("-driving-audio")
  })

  it("a probe or merge failure never fails the paid render", async () => {
    expect(await layDrivingAudioIfSilent(args({ probe: vi.fn().mockRejectedValue(new Error("x")) }))).toEqual({ kind: "as-rendered" })
    expect(await layDrivingAudioIfSilent(args({ probe: vi.fn().mockResolvedValue({ hasAudio: false }), merge: vi.fn().mockRejectedValue(new Error("y")) }))).toEqual({ kind: "as-rendered" })
  })
})
