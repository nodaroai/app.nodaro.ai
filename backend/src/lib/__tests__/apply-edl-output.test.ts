import { describe, it, expect } from "vitest"
import { renderResultStamp } from "@nodaro/shared"
import { applyEdlOutputData } from "../apply-edl-output.js"

describe("applyEdlOutputData — what a finished Apply EDL render stores (A1b)", () => {
  it("a video render: the cut, its thumbnail, its quality and its clip", () => {
    expect(applyEdlOutputData({ medium: "video", mediaUrl: "v.mp4", thumbnailUrl: "t.jpg", quality: "proxy", clipKey: "0-9000" })).toEqual({
      videoUrl: "v.mp4", thumbnailUrl: "t.jpg", quality: "proxy", clipKey: "0-9000",
    })
  })

  it("an audio render with a remapped transcript; no clip key when the payload carried none", () => {
    expect(applyEdlOutputData({ medium: "audio", mediaUrl: "a.m4a", quality: "final", json: { words: [] } })).toEqual({
      audioUrl: "a.m4a", quality: "final", json: { words: [] },
    })
  })

  it("a render with no quality on its payload is a final (the route and the node default it)", () => {
    expect(applyEdlOutputData({ medium: "video", mediaUrl: "v.mp4", quality: undefined }).quality).toBe("final")
  })

  it("the stamp it writes is exactly what the shared reader reads back", () => {
    const od = applyEdlOutputData({ medium: "video", mediaUrl: "v.mp4", quality: "proxy", clipKey: "5-10" })
    expect(renderResultStamp(od)).toEqual({ quality: "proxy", clipKey: "5-10" })
  })
})
