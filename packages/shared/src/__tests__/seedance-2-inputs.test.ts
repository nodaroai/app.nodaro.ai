import { describe, it, expect } from "vitest"
import { resolveSeedance2Inputs } from "../seedance-2-inputs.js"

describe("resolveSeedance2Inputs", () => {
  it("first frame only, no references → strict first-frame, no suffix", () => {
    const r = resolveSeedance2Inputs({ firstFrameUrl: "https://a/first.png" })
    expect(r.mode).toBe("first-frame")
    expect(r.firstFrameUrl).toBe("https://a/first.png")
    expect(r.lastFrameUrl).toBeUndefined()
    expect(r.referenceImageUrls).toEqual([])
    expect(r.promptSuffix).toBe("")
  })

  it("first + last frame, no references → strict first-last-frame", () => {
    const r = resolveSeedance2Inputs({ firstFrameUrl: "https://a/f.png", lastFrameUrl: "https://a/l.png" })
    expect(r.mode).toBe("first-last-frame")
    expect(r.firstFrameUrl).toBe("https://a/f.png")
    expect(r.lastFrameUrl).toBe("https://a/l.png")
    expect(r.promptSuffix).toBe("")
  })

  it("nothing connected → first-frame with no urls, no suffix", () => {
    const r = resolveSeedance2Inputs({})
    expect(r.mode).toBe("first-frame")
    expect(r.firstFrameUrl).toBeUndefined()
    expect(r.referenceImageUrls).toEqual([])
    expect(r.promptSuffix).toBe("")
  })

  it("first frame + one reference image → reference mode, frame appended last, ordinal 2", () => {
    const r = resolveSeedance2Inputs({ firstFrameUrl: "https://a/first.png", refImageUrls: ["https://a/ref.png"] })
    expect(r.mode).toBe("reference")
    expect(r.firstFrameUrl).toBeUndefined()
    expect(r.lastFrameUrl).toBeUndefined()
    expect(r.referenceImageUrls).toEqual(["https://a/ref.png", "https://a/first.png"])
    expect(r.promptSuffix).toBe("Use @image_2 as the opening (first) frame of the video.")
  })

  it("first + last frame + two reference images → reference, frames at 3 and 4", () => {
    const r = resolveSeedance2Inputs({
      firstFrameUrl: "https://a/f.png", lastFrameUrl: "https://a/l.png",
      refImageUrls: ["https://a/r1.png", "https://a/r2.png"],
    })
    expect(r.referenceImageUrls).toEqual(["https://a/r1.png", "https://a/r2.png", "https://a/f.png", "https://a/l.png"])
    expect(r.promptSuffix).toBe("Use @image_3 as the opening (first) frame and @image_4 as the closing (last) frame of the video.")
  })

  it("reference audio + first frame (no images/videos) → reference mode, frame as Image 1, audio passed through", () => {
    const r = resolveSeedance2Inputs({ firstFrameUrl: "https://a/f.png", refAudioUrls: ["https://a/voice.mp3"] })
    expect(r.mode).toBe("reference")
    expect(r.referenceImageUrls).toEqual(["https://a/f.png"])
    expect(r.referenceAudioUrls).toEqual(["https://a/voice.mp3"])
    expect(r.promptSuffix).toBe("Use @image_1 as the opening (first) frame of the video.")
  })

  it("last frame only, no first frame, no references → reference, closing-frame hint", () => {
    const r = resolveSeedance2Inputs({ lastFrameUrl: "https://a/l.png" })
    expect(r.mode).toBe("reference")
    expect(r.referenceImageUrls).toEqual(["https://a/l.png"])
    expect(r.promptSuffix).toBe("Use @image_1 as the closing (last) frame of the video.")
  })

  it("9 user images + first + last → frames kept, 2 user images dropped, ordinals 8 and 9", () => {
    const refs = Array.from({ length: 9 }, (_, i) => `https://a/r${i}.png`)
    const r = resolveSeedance2Inputs({ firstFrameUrl: "https://a/f.png", lastFrameUrl: "https://a/l.png", refImageUrls: refs })
    expect(r.referenceImageUrls).toHaveLength(9)
    expect(r.referenceImageUrls[7]).toBe("https://a/f.png")
    expect(r.referenceImageUrls[8]).toBe("https://a/l.png")
    expect(r.droppedRefImages).toBe(2)
    expect(r.promptSuffix).toBe("Use @image_8 as the opening (first) frame and @image_9 as the closing (last) frame of the video.")
  })

  it("blank/whitespace urls are ignored", () => {
    const r = resolveSeedance2Inputs({ firstFrameUrl: "   ", refImageUrls: ["", "  ", "https://a/r.png"] })
    expect(r.mode).toBe("reference")
    expect(r.referenceImageUrls).toEqual(["https://a/r.png"])
    expect(r.promptSuffix).toBe("")
  })

  it("caps reference videos at 3 and audio at 3", () => {
    const r = resolveSeedance2Inputs({
      refImageUrls: ["https://a/r.png"],
      refVideoUrls: ["v1", "v2", "v3", "v4"], refAudioUrls: ["a1", "a2", "a3", "a4"],
    })
    expect(r.referenceVideoUrls).toEqual(["v1", "v2", "v3"])
    expect(r.referenceAudioUrls).toEqual(["a1", "a2", "a3"])
  })

  // ---------------------------------------------------------------------------
  // Frame-ordinal ↔ array-position INVARIANT (drift guard).
  //
  // The frame `@image_N` numbers the resolver writes into `promptSuffix` must be
  // the literal 1-based positions of `firstFrameUrl` / `lastFrameUrl` in the
  // returned `referenceImageUrls`, AND must be strictly greater than the count
  // of user reference images (frames always come AFTER user refs, never in a
  // user-ref slot). This locks the resolver's internal numbering so a future
  // refactor of the append order or suffix wording can't silently desync the
  // ordinal it tells the model from where the frame actually sits in the array.
  //
  // NB: this guards the resolver in ISOLATION. The combined-case interaction
  // (a @-mentioned character that also fills the i2v start-frame slot while
  // other refs are present) is covered at the payload-builder + provider seam —
  // see backend `seedance2-multimodal.test.ts` "combined case" tests.
  // ---------------------------------------------------------------------------
  describe("frame-ordinal ↔ array-position invariant", () => {
    // Parse every `@image_N` ordinal out of the suffix in document order. The
    // regex tolerates both the `@image_N` form (current) and a legacy `Image N`
    // form so the invariant holds across the REF_BINDING swap-point flip.
    const ordinalsIn = (suffix: string): number[] =>
      Array.from(suffix.matchAll(/@?image[_ ](\d+)/gi)).map((m) => parseInt(m[1], 10))

    const refShapes: Array<{ name: string; refs: string[] }> = [
      { name: "0 user refs", refs: [] },
      { name: "1 user ref", refs: ["https://a/u1.png"] },
      { name: "2 user refs", refs: ["https://a/u1.png", "https://a/u2.png"] },
    ]
    const frameShapes: Array<{ name: string; first?: string; last?: string }> = [
      { name: "first-only", first: "https://a/first.png" },
      { name: "first+last", first: "https://a/first.png", last: "https://a/last.png" },
      { name: "last-only", last: "https://a/last.png" },
    ]

    for (const rs of refShapes) {
      for (const fs of frameShapes) {
        it(`${rs.name} × ${fs.name}: suffix ordinals == array positions, all > user-ref count`, () => {
          const r = resolveSeedance2Inputs({
            firstFrameUrl: fs.first,
            lastFrameUrl: fs.last,
            refImageUrls: rs.refs,
          })

          // Strict first/last-frame mode (a first frame with NO references) does
          // not number anything: frames ride `firstFrameUrl`/`lastFrameUrl` and
          // the suffix is empty. The frame-ordinal invariant is reference-mode
          // only, so assert the strict-mode contract and stop here.
          if (r.mode !== "reference") {
            expect(rs.refs.length).toBe(0)
            expect(r.referenceImageUrls).toEqual([])
            expect(r.promptSuffix).toBe("")
            expect(r.firstFrameUrl).toBe(fs.first)
            return
          }

          const userRefCount = rs.refs.length
          const arr = r.referenceImageUrls

          // 1-based position of each frame URL in the final array (0 = absent).
          const firstPos = fs.first ? arr.indexOf(fs.first) + 1 : 0
          const lastPos = fs.last ? arr.indexOf(fs.last) + 1 : 0

          // Every frame URL present must actually be in the array.
          if (fs.first) expect(firstPos).toBeGreaterThan(0)
          if (fs.last) expect(lastPos).toBeGreaterThan(0)

          // Frames sit strictly AFTER every user-ref slot (no collision).
          if (firstPos) expect(firstPos).toBeGreaterThan(userRefCount)
          if (lastPos) expect(lastPos).toBeGreaterThan(userRefCount)

          // The suffix's `@image_N` ordinals are EXACTLY the array positions, in
          // the order the suffix names them (first frame before last frame).
          const expectedOrdinals: number[] = []
          if (firstPos) expectedOrdinals.push(firstPos)
          if (lastPos) expectedOrdinals.push(lastPos)
          expect(ordinalsIn(r.promptSuffix)).toEqual(expectedOrdinals)

          // User refs occupy the first `userRefCount` slots verbatim — frames
          // never displace them.
          expect(arr.slice(0, userRefCount)).toEqual(rs.refs)
        })
      }
    }
  })
})
