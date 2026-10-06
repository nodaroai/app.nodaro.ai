import { describe, it, expect } from "vitest"
import { normalizeEdl } from "@nodaro/shared"
import { cutRange, cutReason, keptSetOf, reasonSpans, restoredOf, snapToWords } from "../kept-set"
import { keepReason, keepSpan } from "./review-fixtures"

const iv = (inMs: number, outMs: number) => ({ inMs, outMs })
const word = (text: string, startMs: number, endMs: number, speaker?: string) => ({
  text,
  startMs,
  endMs,
  ...(speaker ? { speaker } : {}),
})

// seg-0 | filler | seg-1 · seg-2 (abutting: a camera split) | tangent, with a silence inside it | seg-3
const plan = normalizeEdl({
  version: 1,
  clock: "master",
  sources: [
    { id: "cam-a", url: "https://cdn.test/a.mp4", kind: "video" },
    { id: "cam-b", url: "https://cdn.test/b.mp4", kind: "video" },
  ],
  segments: [
    { id: "seg-0", inMs: 0, outMs: 1000, video: "cam-a" },
    { id: "seg-1", inMs: 1300, outMs: 2000, video: "cam-a" },
    { id: "seg-2", inMs: 2000, outMs: 3000, video: "cam-b" },
    { id: "seg-3", inMs: 6000, outMs: 7000, video: "cam-a" },
  ],
  dropped: [
    { inMs: 1000, outMs: 1300, reason: "filler" },
    { inMs: 3000, outMs: 6000, reason: "tangent" },
    { inMs: 3500, outMs: 3800, reason: "silence" },
  ],
})

const K0 = keptSetOf(plan)

describe("the kept set K", () => {
  it("is the union of the plan's segments: abutting segments merge, order is by time", () => {
    expect(K0).toEqual([iv(0, 1000), iv(1300, 3000), iv(6000, 7000)])
  })

  it("ignores a segment with no length, as the render does", () => {
    const edl = normalizeEdl({ ...plan, segments: [...plan.segments, { id: "z", inMs: 8000, outMs: 8000, video: "cam-a" }] })
    expect(keptSetOf(edl)).toEqual(K0)
  })
})

describe("snapToWords: a manual cut is whole words", () => {
  const words = [word("So", 100, 300), word("the", 1400, 1600), word("thing", 1650, 1900), word("is", 2300, 2500)]

  it("a word selection cuts exactly from its first word's start to its last word's end", () => {
    expect(snapToWords(iv(1400, 1900), words)).toEqual(iv(1400, 1900))
  })

  it("a range that starts or ends inside a word takes the whole word", () => {
    expect(snapToWords(iv(1500, 1700), words)).toEqual(iv(1400, 1900))
  })

  it("a range that ends in a gap ends at the last word it touches", () => {
    expect(snapToWords(iv(1390, 2100), words)).toEqual(iv(1400, 1900))
  })

  it("a range that touches no word cuts nothing", () => {
    expect(snapToWords(iv(1950, 2250), words)).toBeNull()
    expect(snapToWords(iv(1500, 1500), words)).toBeNull()
    expect(snapToWords(iv(1500, 1400), words)).toBeNull()
  })

  it("never splits a word that overlaps the cut (crosstalk), however far the overlap chains", () => {
    const talk = [...words, word("yeah", 1850, 2200, "B"), word("right", 2150, 2400, "B")]
    expect(snapToWords(iv(1400, 1900), talk)).toEqual(iv(1400, 2500))
  })

  it("a word with no length is touched only by a range that holds its instant", () => {
    const point = [word("[laugh]", 2000, 2000)]
    expect(snapToWords(iv(1990, 2010), point)).toBeNull()
    expect(snapToWords(iv(1990, 2010), [...point, word("ok", 1995, 2100)])).toEqual(iv(1995, 2100))
  })

  it("applies the transcript's source offset (master = source + offset)", () => {
    // "the" is 1400–1600 on its source, so 1900–2100 on the master clock.
    expect(snapToWords(iv(2000, 2050), words, 500)).toEqual(iv(1900, 2100))
    expect(snapToWords(iv(1500, 1550), words, 500)).toBeNull()
  })
})

describe("cutRange", () => {
  const words = [word("So", 100, 300), word("the", 1400, 1600), word("thing", 1650, 1900)]

  it("removes the snapped whole-word range from K", () => {
    expect(cutRange(K0, iv(1500, 1700), words)).toEqual([iv(0, 1000), iv(1300, 1400), iv(1900, 3000), iv(6000, 7000)])
  })

  it("is idempotent, and changes nothing when the range touches no word", () => {
    const once = cutRange(K0, iv(150, 160), words)
    expect(once).toEqual([iv(0, 100), iv(300, 1000), iv(1300, 3000), iv(6000, 7000)])
    expect(cutRange(once, iv(150, 160), words)).toEqual(once)
    expect(cutRange(K0, iv(2950, 2990), words)).toEqual(K0)
  })
})

describe("restoredOf: derived from K, never stored", () => {
  it("is empty for the plan as made", () => {
    expect(restoredOf(plan, K0)).toEqual([])
  })

  it("is each plan span's part that K keeps, with its reason; overlapping rows each report theirs", () => {
    const k = keepReason(keepSpan(K0, plan.dropped![0]), plan, "silence")
    expect(restoredOf(plan, k)).toEqual([
      { inMs: 1000, outMs: 1300, reason: "filler" },
      { inMs: 3500, outMs: 3800, reason: "tangent" },
      { inMs: 3500, outMs: 3800, reason: "silence" },
    ])
  })

  it("forgets a restore once its time is cut again", () => {
    const words = [word("um", 1000, 1300)]
    const k = cutRange(keepSpan(K0, plan.dropped![0]), iv(1000, 1300), words)
    expect(restoredOf(plan, k)).toEqual([])
  })
})

describe("cutReason: the reasons box's cut (A3-2)", () => {
  it("cuts every span the plan dropped for the reason, wherever K keeps it again", () => {
    const k = keepReason(K0, plan, "tangent")
    expect(cutReason(k, plan, "tangent")).toEqual(K0)
  })

  it("cuts only that reason: a silence restored inside a cut tangent stays as K has it", () => {
    const k = keepReason(keepReason(K0, plan, "tangent"), plan, "filler")
    expect(cutReason(k, plan, "filler")).toEqual(keepReason(K0, plan, "tangent"))
  })

  it("is idempotent, and a reason nothing was dropped for changes nothing", () => {
    const k = keepReason(K0, plan, "silence")
    const once = cutReason(k, plan, "silence")
    expect(cutReason(once, plan, "silence")).toEqual(once)
    expect(cutReason(k, plan, "breath")).toEqual(k)
  })

  it("never cuts time the plan kept: the reviewer's own cuts (manual) have no plan spans to cut again", () => {
    // K keeps no history, so a manual cut once restored is the plan's kept time.
    expect(cutReason(K0, plan, "manual")).toEqual(K0)
  })

  it("reasonSpans lives beside it: the plan's spans of a reason, and for manual the plan's kept time too", () => {
    expect(reasonSpans(plan, "tangent")).toEqual([iv(3000, 6000)])
    expect(reasonSpans(plan, "manual")).toEqual(K0)
  })
})
