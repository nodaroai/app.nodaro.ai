import { describe, it, expect } from "vitest"
import { videoOverlayListRowFields, videoOverlayRunOutputFields } from "../video-overlay-run-output"
import { videoOverlayResultFresh } from "../video-overlay-composition"

describe("videoOverlayRunOutputFields — the ONE mapping every landing lane calls", () => {
  it("copies the freshness key a backend run stamped (resultCompositionKey)", () => {
    expect(videoOverlayRunOutputFields({ videoUrl: "https://cdn/o.mp4", resultCompositionKey: "K1" })).toEqual({
      warnings: [],
      width: undefined,
      height: undefined,
      durationSec: undefined,
      resultCompositionKey: "K1",
    })
  })

  it("an output without the key writes undefined — the key is always present, so a later unstamped run overwrites an earlier stamp and reads old", () => {
    const fields = videoOverlayRunOutputFields({ videoUrl: "https://cdn/o.mp4" })
    expect("resultCompositionKey" in fields).toBe(true)
    expect(fields.resultCompositionKey).toBeUndefined()
    expect(videoOverlayResultFresh("K1", fields)).toBe(false)
    expect(videoOverlayRunOutputFields({ resultCompositionKey: 42 }).resultCompositionKey).toBeUndefined()
    expect(videoOverlayRunOutputFields({ resultCompositionKey: "" }).resultCompositionKey).toBeUndefined()
    expect(videoOverlayRunOutputFields(null).resultCompositionKey).toBeUndefined()
  })
})

describe("videoOverlayListRowFields — a fan-out row's own key, by its URL", () => {
  const output = { listResults: ["https://v/a.mp4", "", "https://v/c.mp4"], listResultCompositionKeys: ["KA", "", "KC"] }
  it("pairs each row with the key at its own list position", () => {
    const row = videoOverlayListRowFields("video-overlay", output)
    expect(row("https://v/a.mp4")).toEqual({ resultCompositionKey: "KA" })
    expect(row("https://v/c.mp4")).toEqual({ resultCompositionKey: "KC" })
    expect(row("https://v/other.mp4")).toEqual({ resultCompositionKey: undefined })
  })
  it("no keys → every row unstamped (reads old); another node type → nothing", () => {
    expect(videoOverlayListRowFields("video-overlay", { listResults: output.listResults })("https://v/a.mp4")).toEqual({ resultCompositionKey: undefined })
    expect(videoOverlayListRowFields("generate-video", output)("https://v/a.mp4")).toEqual({})
  })
})

