import { describe, it, expect } from "vitest"
import { videoFormatSelector, VIDEO_FORMAT_SELECTOR } from "../video-format.js"

// The exact uncapped selector shipping today. Hardcoded (not derived) so this
// test FAILS if the constant ever drifts — it's the byte-for-byte backward-
// compatibility anchor the platform's youtube-video-node depends on.
const UNCAPPED =
  "bv*[vcodec^=avc1]+ba[ext=m4a]/bv*[vcodec^=avc1]+ba/bv*+ba/b[vcodec^=avc1]/b[vcodec^=h264]/b[ext=mp4]/b"

describe("videoFormatSelector — uncapped (maxHeight absent)", () => {
  it("returns the current constant, byte-for-byte", () => {
    expect(videoFormatSelector()).toBe(UNCAPPED)
    expect(videoFormatSelector(undefined)).toBe(UNCAPPED)
  })

  it("is the exact value the VIDEO_FORMAT_SELECTOR constant exposes", () => {
    expect(VIDEO_FORMAT_SELECTOR).toBe(UNCAPPED)
    expect(videoFormatSelector()).toBe(VIDEO_FORMAT_SELECTOR)
  })
})

describe("videoFormatSelector — capped (maxHeight set)", () => {
  it("injects [height<=H] into every video branch and appends a bare `b`", () => {
    expect(videoFormatSelector(720)).toBe(
      "bv*[vcodec^=avc1][height<=720]+ba[ext=m4a]/" +
        "bv*[vcodec^=avc1][height<=720]+ba/" +
        "bv*[height<=720]+ba/" +
        "b[vcodec^=avc1][height<=720]/" +
        "b[vcodec^=h264][height<=720]/" +
        "b[ext=mp4][height<=720]/" +
        "b[height<=720]/" +
        "b",
    )
  })

  it("caps every branch EXCEPT the trailing last-resort `b`", () => {
    const branches = videoFormatSelector(1080).split("/")
    // 7 base branches, each capped, + 1 trailing bare `b`.
    expect(branches).toHaveLength(8)
    for (const branch of branches.slice(0, -1)) {
      expect(branch).toContain("[height<=1080]")
    }
    // The final branch is the bare "download anything" fallback: it fires only
    // when NO format satisfies the cap, so the import never fails outright.
    expect(branches.at(-1)).toBe("b")
  })

  it("caps only the VIDEO half — the +ba audio selector keeps no height filter", () => {
    const capped = videoFormatSelector(480)
    // Audio halves survive verbatim...
    expect(capped).toContain("[height<=480]+ba[ext=m4a]")
    expect(capped).toContain("[height<=480]+ba/")
    // ...and never carry a height filter of their own.
    expect(capped).not.toContain("ba[ext=m4a][height")
    expect(capped).not.toContain("+ba[height")
  })

  it("substitutes the exact height into the filter (no rounding, no clamping)", () => {
    // The route owns range-clamping; the builder is a pure string substitution.
    expect(videoFormatSelector(144)).toContain("[height<=144]")
    expect(videoFormatSelector(4320)).toContain("[height<=4320]")
  })
})
