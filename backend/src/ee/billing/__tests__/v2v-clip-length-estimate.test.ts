// @test-units-by-name estimates only the video-to-video and upload nodes it builds by name
import { describe, it, expect } from "vitest"
import { CreditsService } from "../credits.js"

/**
 * The server's run estimate of a Video to Video on HappyHorse Edit / Wan 2.7
 * VideoEdit (decided 2026-11-18): the clip's length its `video` wire gives
 * (an upload at its recorded length), priced as a run charges it, else the
 * model's longest clip. Base credits at the seeded rows, no markup.
 */
const upload = (sec: number) => ({ id: "v", type: "upload-video", data: { url: "https://m.test/clip.mp4", videoDurationSec: sec, duration: sec } })
const v2v = (data: Record<string, unknown>) => ({ id: "x", type: "video-to-video", data })
const wire = [{ id: "e", source: "v", target: "x", targetHandle: "video" }]
const estimate = (data: Record<string, unknown>, sec?: number) =>
  sec === undefined
    ? CreditsService.estimateWorkflowBaseCredits([v2v(data)], [])
    : CreditsService.estimateWorkflowBaseCredits([v2v(data), upload(sec)], wire)

describe("the server's run estimate of a clip-priced Video to Video", () => {
  it("HappyHorse Edit: started half-seconds of the wired clip, at the size sent", () => {
    expect(estimate({ provider: "happyhorse-edit" }, 3)).toBe(420)
    expect(estimate({ provider: "happyhorse-edit" }, 10.04)).toBe(1470)
    expect(estimate({ provider: "happyhorse-edit", v2vResolution: "1080p" }, 3)).toBe(720)
    expect(estimate({ provider: "happyhorse-edit", v2vResolution: "480p" }, 3)).toBe(420)
  })

  it("Wan 2.7 VideoEdit: the larger of its flat row and its rate", () => {
    expect(estimate({ provider: "wan-videoedit" }, 5)).toBe(320)
    expect(estimate({ provider: "wan-videoedit" }, 6)).toBe(360)
    expect(estimate({ provider: "wan-videoedit", videoEditDuration: "5" }, 10)).toBe(320)
  })

  it("a clip the graph does not know: the model's longest", () => {
    expect(estimate({ provider: "happyhorse-edit" })).toBe(8400)
    expect(estimate({ provider: "wan-videoedit" })).toBe(600)
  })
})
