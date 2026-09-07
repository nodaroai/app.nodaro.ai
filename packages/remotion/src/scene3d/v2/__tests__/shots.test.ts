import { describe, expect, it } from "vitest"
import { buildShotTimeline } from "../shots"
import { TABLE_SHOTS } from "./v2-fixtures"

describe("shot timeline", () => {
  it("tiles the spec's own table example exactly", () => {
    // [0,360) [360,432) [432,492) [492,720) — the acceptance fixture.
    const timeline = buildShotTimeline(TABLE_SHOTS, 720)
    expect(timeline.shotAt(0).id).toBe("wide")
    expect(timeline.shotAt(359).id).toBe("wide")
    expect(timeline.shotAt(360).id).toBe("ots-a")
    expect(timeline.shotAt(431).id).toBe("ots-a")
    expect(timeline.shotAt(432).id).toBe("ots-b")
    expect(timeline.shotAt(491).id).toBe("ots-b")
    expect(timeline.shotAt(492).id).toBe("orbit")
    expect(timeline.shotAt(719).id).toBe("orbit")
  })

  it("assigns every frame to exactly one shot", () => {
    const timeline = buildShotTimeline(TABLE_SHOTS, 720)
    const counts = new Map<string, number>()
    for (let frame = 0; frame < 720; frame++) {
      const id = timeline.shotAt(frame).id
      counts.set(id, (counts.get(id) ?? 0) + 1)
    }
    expect([...counts.entries()].sort((a, b) => a[0].localeCompare(b[0]))).toEqual([
      ["orbit", 228],
      ["ots-a", 72],
      ["ots-b", 60],
      ["wide", 360],
    ])
  })

  it("accepts shots given out of order", () => {
    const timeline = buildShotTimeline([...TABLE_SHOTS].reverse(), 720)
    expect(timeline.shots.map((s) => s.id)).toEqual(["wide", "ots-a", "ots-b", "orbit"])
  })

  it("rejects a gap", () => {
    const gapped = TABLE_SHOTS.map((shot) =>
      shot.id === "ots-a" ? { ...shot, startFrame: 361 } : shot,
    )
    expect(() => buildShotTimeline(gapped, 720)).toThrow(/must be contiguous/)
  })

  it("rejects an overlap", () => {
    const overlapping = TABLE_SHOTS.map((shot) =>
      shot.id === "ots-a" ? { ...shot, startFrame: 350 } : shot,
    )
    expect(() => buildShotTimeline(overlapping, 720)).toThrow(/must be contiguous/)
  })

  it("rejects a timeline that does not start at frame 0", () => {
    const shifted = TABLE_SHOTS.map((shot) =>
      shot.id === "wide" ? { ...shot, startFrame: 1 } : shot,
    )
    expect(() => buildShotTimeline(shifted, 720)).toThrow(/must start at frame 0/)
  })

  it("rejects a timeline that stops short of the plan duration", () => {
    expect(() => buildShotTimeline(TABLE_SHOTS, 721)).toThrow(/but the plan is 721 frames long/)
  })

  it("rejects an empty or inverted range", () => {
    expect(() =>
      buildShotTimeline([{ id: "x", startFrame: 0, endFrameExclusive: 0 }], 0),
    ).toThrow(/empty or inverted/)
    expect(() =>
      buildShotTimeline([{ id: "x", startFrame: 10, endFrameExclusive: 5 }], 10),
    ).toThrow(/empty or inverted/)
  })

  it("rejects duplicate shot ids (a camera override must scope to one shot)", () => {
    expect(() =>
      buildShotTimeline(
        [
          { id: "a", startFrame: 0, endFrameExclusive: 10 },
          { id: "a", startFrame: 10, endFrameExclusive: 20 },
        ],
        20,
      ),
    ).toThrow(/duplicate shot id/)
  })

  it("rejects an empty shot list", () => {
    expect(() => buildShotTimeline([], 10)).toThrow(/at least one shot/)
  })

  it("rejects non-integer boundaries", () => {
    expect(() =>
      buildShotTimeline([{ id: "a", startFrame: 0, endFrameExclusive: 10.5 }], 10.5),
    ).toThrow(/must be integers/)
  })

  it("rejects more than 32 shots", () => {
    const many = Array.from({ length: 33 }, (_, i) => ({
      id: `s${i}`,
      startFrame: i,
      endFrameExclusive: i + 1,
    }))
    expect(() => buildShotTimeline(many, 33)).toThrow(/exceeds the limit of 32/)
  })

  it("clamps out-of-range lookups to the first/last shot", () => {
    const timeline = buildShotTimeline(TABLE_SHOTS, 720)
    expect(timeline.shotAt(-1).id).toBe("wide")
    expect(timeline.shotAt(720).id).toBe("orbit")
  })
})
