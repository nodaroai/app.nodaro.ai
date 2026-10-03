import { describe, it, expect } from "vitest"
import {
  EDL_VERSION,
  edlDurationMs,
  validateEdl,
  validateEdlClipSet,
  remapMsThroughEdl,
  remapTranscriptThroughEdl,
  speakerTurns,
  normalizeEdl,
  normalizeTranscript,
  transcriptDurationSec,
  type Edl,
  type Transcript,
} from "../edl.js"
import {
  unwrapEditPlanOutput,
  buildEditPlanCreditId,
  editPlanBucketMinutes,
  clampEditPlanClipCount,
  EDIT_PLAN_DEFAULT_CLIP_COUNT,
  EDIT_PLAN_MAX_CLIP_COUNT,
} from "../edit-plan-contract.js"
import { editPlanSourceDurationSec } from "../video-duration.js"

/** A minimal valid single-camera tighten EDL: two kept spans of the master. */
function tightenEdl(): Edl {
  return {
    version: 1,
    clock: "master",
    sources: [{ id: "master", url: "https://x/master.mp4", kind: "video", role: "master-audio" }],
    segments: [
      { id: "s0", inMs: 0, outMs: 5000, video: "master" },
      { id: "s1", inMs: 8000, outMs: 12000, video: "master" }, // 3000-8000 dropped
    ],
    dropped: [{ inMs: 5000, outMs: 8000, reason: "silence" }],
  }
}

describe("edlDurationMs (D17 overlap)", () => {
  it("sums segment durations with no transitions", () => {
    expect(edlDurationMs(tightenEdl())).toBe(9000) // 5000 + 4000
  })

  it("subtracts a crossfade transition (overlap compresses the timeline)", () => {
    const edl: Edl = {
      ...tightenEdl(),
      segments: [
        { id: "s0", inMs: 0, outMs: 5000, video: "master" },
        { id: "s1", inMs: 8000, outMs: 12000, video: "master", transition: { type: "crossfade", durationMs: 1000 } },
      ],
    }
    expect(edlDurationMs(edl)).toBe(8000) // 9000 - 1000 overlap
  })

  it("does NOT subtract a cut", () => {
    const edl: Edl = {
      ...tightenEdl(),
      segments: [
        { id: "s0", inMs: 0, outMs: 5000, video: "master" },
        { id: "s1", inMs: 8000, outMs: 12000, video: "master", transition: { type: "cut", durationMs: 0 } },
      ],
    }
    expect(edlDurationMs(edl)).toBe(9000)
  })

  it("subtracts an xfade:* layout transition but not pan/zoom", () => {
    const base = tightenEdl()
    const withXfade: Edl = {
      ...base,
      sources: [
        { id: "a", url: "https://x/a.mp4", kind: "video", role: "master-audio" },
        { id: "b", url: "https://x/b.mp4", kind: "video" },
      ],
      segments: [
        { id: "s0", inMs: 0, outMs: 5000, video: "a" },
        { id: "s1", inMs: 8000, outMs: 12000, video: "b", layout: { mode: "single", transition: { type: "xfade:slide-left", durationMs: 800 } } },
      ],
      dropped: undefined,
    }
    expect(edlDurationMs(withXfade)).toBe(8200)
    const withPan: Edl = {
      ...withXfade,
      segments: [
        withXfade.segments[0],
        { ...withXfade.segments[1], layout: { mode: "single", transition: { type: "pan", durationMs: 800 } } },
      ],
    }
    expect(edlDurationMs(withPan)).toBe(9000)
  })
})

describe("remapMsThroughEdl", () => {
  it("maps kept instants to the compacted output clock and drops removed ones", () => {
    const edl = tightenEdl()
    expect(remapMsThroughEdl(edl, 0)).toBe(0)
    expect(remapMsThroughEdl(edl, 4999)).toBe(4999)
    expect(remapMsThroughEdl(edl, 6000)).toBeNull() // dropped span
    expect(remapMsThroughEdl(edl, 8000)).toBe(5000) // start of 2nd segment lands right after the 1st
    expect(remapMsThroughEdl(edl, 11999)).toBe(8999)
  })

  it("is monotonic over kept instants", () => {
    const edl = tightenEdl()
    let prev = -1
    for (const ms of [0, 1000, 2500, 4999, 8000, 9000, 11999]) {
      const out = remapMsThroughEdl(edl, ms)
      if (out === null) continue
      expect(out).toBeGreaterThan(prev)
      prev = out
    }
  })

  it("applies the D19 source offset (masterMs = sourceMs + offsetMs)", () => {
    const edl: Edl = {
      version: 1,
      clock: "master",
      sources: [
        { id: "master", url: "https://x/m.mp4", kind: "video", role: "master-audio" },
        { id: "cam", url: "https://x/c.mp4", kind: "video", offsetMs: 1200 },
      ],
      segments: [{ id: "s0", inMs: 0, outMs: 10000, video: "master" }],
    }
    // A cam instant at 0 is at master 1200.
    expect(remapMsThroughEdl(edl, 0, "cam")).toBe(1200)
    // Without a sourceId the instant is already on the master clock.
    expect(remapMsThroughEdl(edl, 0)).toBe(0)
  })
})

describe("remapTranscriptThroughEdl", () => {
  it("drops words in removed spans and clips straddlers; identity+offset round-trips", () => {
    const edl = tightenEdl()
    const t: Transcript = {
      version: 1,
      words: [
        { text: "keep", startMs: 100, endMs: 400 },
        { text: "gone", startMs: 6000, endMs: 6500 }, // dropped span
        { text: "back", startMs: 8100, endMs: 8500 },
      ],
    }
    const out = remapTranscriptThroughEdl(edl, t)
    expect(out.words.map(w => w.text)).toEqual(["keep", "back"])
    expect(out.words[0]).toMatchObject({ startMs: 100, endMs: 400 })
    expect(out.words[1]).toMatchObject({ startMs: 5100, endMs: 5500 })
  })

  it("applies the offset via transcript.sourceId (no silent drift)", () => {
    const edl: Edl = {
      version: 1,
      clock: "master",
      sources: [
        { id: "master", url: "https://x/m.mp4", kind: "video", role: "master-audio" },
        { id: "cam", url: "https://x/c.mp4", kind: "video", offsetMs: 1000 },
      ],
      segments: [{ id: "s0", inMs: 0, outMs: 10000, video: "master" }],
    }
    // A word at cam-time 500 is at master 1500 → output 1500 (identity segment).
    const t: Transcript = { version: 1, sourceId: "cam", words: [{ text: "hi", startMs: 500, endMs: 900 }] }
    const out = remapTranscriptThroughEdl(edl, t)
    expect(out.words[0]).toMatchObject({ startMs: 1500, endMs: 1900 })
  })
})

describe("validateEdl", () => {
  it("accepts a well-formed tighten EDL", () => {
    expect(validateEdl(tightenEdl())).toEqual({ ok: true, issues: [], warnings: [] })
  })

  it("rejects outMs <= inMs, unknown source ids, and dropped∩segments", () => {
    const bad: Edl = {
      version: 1,
      clock: "master",
      sources: [{ id: "m", url: "x", kind: "video", role: "master-audio" }],
      segments: [
        { id: "s0", inMs: 0, outMs: 0, video: "m" },
        { id: "s1", inMs: 100, outMs: 200, video: "ghost" },
      ],
      dropped: [{ inMs: 150, outMs: 180, reason: "silence" }],
    }
    const r = validateEdl(bad)
    expect(r.ok).toBe(false)
    expect(r.issues.join("\n")).toMatch(/outMs .* must be > inMs/)
    expect(r.issues.join("\n")).toMatch(/video source "ghost" not in sources/)
    expect(r.issues.join("\n")).toMatch(/overlaps kept segment/)
  })

  it("forbids a transition on segments[0] and both transition fields on one segment", () => {
    const e1: Edl = { ...tightenEdl(), segments: [{ id: "s0", inMs: 0, outMs: 5000, video: "master", transition: { type: "crossfade", durationMs: 100 } }, { id: "s1", inMs: 8000, outMs: 12000, video: "master" }], dropped: undefined }
    expect(validateEdl(e1).issues.join("\n")).toMatch(/segments\[0\] cannot have a transition/)
    const e2: Edl = { ...tightenEdl(), segments: [{ id: "s0", inMs: 0, outMs: 5000, video: "master" }, { id: "s1", inMs: 8000, outMs: 12000, video: "master", transition: { type: "crossfade", durationMs: 100 }, layout: { mode: "single", transition: { type: "xfade:x", durationMs: 100 } } }], dropped: undefined }
    expect(validateEdl(e2).issues.join("\n")).toMatch(/both EdlSegment.transition and EdlLayout.transition/)
  })

  it("enforces the 0.9*min(adjacent) transition bound (the executor's real clamp)", () => {
    // adjacent min duration is 4000 → bound is 3600. 3800 must fail; 3600 must pass.
    const over: Edl = { ...tightenEdl(), segments: [{ id: "s0", inMs: 0, outMs: 5000, video: "master" }, { id: "s1", inMs: 8000, outMs: 12000, video: "master", transition: { type: "crossfade", durationMs: 3800 } }], dropped: undefined }
    expect(validateEdl(over).ok).toBe(false)
    const okEdl: Edl = { ...over, segments: [over.segments[0], { ...over.segments[1], transition: { type: "crossfade", durationMs: 3600 } }] }
    expect(validateEdl(okEdl).ok).toBe(true)
  })

  it("rejects segment.region when the layout has >1 slot (D20)", () => {
    const e: Edl = {
      version: 1,
      clock: "master",
      sources: [{ id: "a", url: "x", kind: "video", role: "master-audio" }, { id: "b", url: "y", kind: "video" }],
      segments: [{ id: "s0", inMs: 0, outMs: 1000, video: "a", region: { x: 0, y: 0, w: 0.5, h: 0.5 }, layout: { mode: "side-by-side", slots: [{ source: "a" }, { source: "b" }] } }],
    }
    expect(validateEdl(e).issues.join("\n")).toMatch(/segment.region is invalid when the layout has >1 slot/)
  })

  it("rejects >1 master-audio and a non-video slot source", () => {
    const e: Edl = {
      version: 1,
      clock: "master",
      sources: [
        { id: "a", url: "x", kind: "video", role: "master-audio" },
        { id: "b", url: "y", kind: "audio", role: "master-audio" },
      ],
      segments: [{ id: "s0", inMs: 0, outMs: 1000, video: "a", layout: { mode: "pip", slots: [{ source: "b" }] } }],
    }
    const r = validateEdl(e)
    expect(r.issues.join("\n")).toMatch(/more than one source has role:"master-audio"/)
    expect(r.issues.join("\n")).toMatch(/slots must be video/)
  })
})

describe("validateEdlClipSet", () => {
  it("accepts a set of valid clips and reports a bad one", () => {
    const good = { version: 1 as const, clips: [tightenEdl(), tightenEdl()] }
    expect(validateEdlClipSet(good).ok).toBe(true)
    const bad = { version: 1 as const, clips: [tightenEdl(), { ...tightenEdl(), segments: [] }] }
    const r = validateEdlClipSet(bad)
    expect(r.ok).toBe(false)
    expect(r.issues.join("\n")).toMatch(/clip\[1\]: segments is empty/)
  })
})

describe("speakerTurns", () => {
  it("merges within the gap and drops short turns", () => {
    const t: Transcript = {
      version: 1,
      words: [
        { text: "a", startMs: 0, endMs: 300, speaker: "host" },
        { text: "b", startMs: 400, endMs: 900, speaker: "host" }, // gap 100 < merge
        { text: "c", startMs: 2000, endMs: 2100, speaker: "guest" }, // 100ms turn, dropped
        { text: "d", startMs: 3000, endMs: 5000, speaker: "guest" },
      ],
    }
    const turns = speakerTurns(t, { minTurnMs: 500, mergeGapMs: 200 })
    expect(turns).toEqual([
      { speaker: "host", startMs: 0, endMs: 900 },
      { speaker: "guest", startMs: 3000, endMs: 5000 },
    ])
  })
})

describe("normalizeEdl", () => {
  it("fills defaults, clamps regions, and is ms-only (no unit guessing)", () => {
    const n = normalizeEdl({
      segments: [{ inMs: 5, outMs: 12, region: { x: -1, y: 0.5, w: 2, h: 0.5 } }],
      sources: [{ id: "m", url: "u", kind: "video" }],
    })
    expect(n.version).toBe(EDL_VERSION)
    expect(n.clock).toBe("master")
    // ms preserved verbatim — an integer-seconds-looking value is NOT rescaled.
    expect(n.segments[0]).toMatchObject({ inMs: 5, outMs: 12 })
    expect(n.segments[0].region).toEqual({ x: 0, y: 0.5, w: 1, h: 0.5 })
  })

  it("preserves segment order verbatim (no destructive re-sort)", () => {
    const n = normalizeEdl({ segments: [{ id: "b", inMs: 900, outMs: 1000 }, { id: "a", inMs: 0, outMs: 100 }] })
    expect(n.segments.map(s => s.id)).toEqual(["b", "a"])
  })

  it("renames nothing but carries slots[].weight (D20)", () => {
    const n = normalizeEdl({ segments: [{ inMs: 0, outMs: 100, layout: { mode: "grid", slots: [{ source: "a", weight: 1 }, { source: "b", weight: 2 }] } }] })
    expect(n.segments[0].layout?.slots).toEqual([{ source: "a", weight: 1 }, { source: "b", weight: 1 }])
  })

  it("round-trips a normalized EDL through validateEdl cleanly", () => {
    const n = normalizeEdl(tightenEdl())
    expect(validateEdl(n).ok).toBe(true)
  })
})

describe("normalizeTranscript", () => {
  it("coerces words to ms and carries sourceId", () => {
    const t = normalizeTranscript({ sourceId: "cam", words: [{ text: "hi", startMs: 1.6, endMs: 2.4 }] })
    expect(t.version).toBe(EDL_VERSION)
    expect(t.sourceId).toBe("cam")
    expect(t.words[0]).toEqual({ text: "hi", startMs: 2, endMs: 2 })
  })

  it("never produces an inverted word (endMs >= startMs)", () => {
    const t = normalizeTranscript({ words: [{ text: "x", startMs: 500, endMs: 100 }] })
    expect(t.words[0].endMs).toBeGreaterThanOrEqual(t.words[0].startMs)
    expect(t.words[0].endMs).toBe(500)
  })
})

// ── Fixes from the 2026-09-17 adversarial review ──────────────────────────

/** A 3-segment fixture with two crossfades (exercises cumulative overlap). */
function threeSegOverlap(): Edl {
  return {
    version: 1,
    clock: "master",
    sources: [{ id: "m", url: "https://x/m.mp4", kind: "video", role: "master-audio" }],
    segments: [
      { id: "s0", inMs: 0, outMs: 4000, video: "m" },
      { id: "s1", inMs: 4000, outMs: 8000, video: "m", transition: { type: "crossfade", durationMs: 500 } },
      { id: "s2", inMs: 8000, outMs: 12000, video: "m", transition: { type: "crossfade", durationMs: 500 } },
    ],
  }
}

describe("edlDurationMs ↔ segmentOutputStarts invariant", () => {
  it("remap(lastSeg.outMs-1)+1 === edlDurationMs under cumulative overlap", () => {
    const edl = threeSegOverlap()
    expect(edlDurationMs(edl)).toBe(11000) // 12000 - 2*500
    const last = edl.segments[edl.segments.length - 1]
    const endOut = remapMsThroughEdl(edl, last.outMs - 1)!
    expect(endOut + 1).toBe(edlDurationMs(edl))
  })

  it("stays consistent even if a transition is (wrongly) on segments[0]", () => {
    // normalizeEdl strips it; but even on the raw object the two overlap paths must agree.
    const raw: Edl = {
      ...threeSegOverlap(),
      segments: [
        { id: "s0", inMs: 0, outMs: 4000, video: "m", transition: { type: "crossfade", durationMs: 500 } },
        { id: "s1", inMs: 4000, outMs: 8000, video: "m" },
      ],
    }
    const last = raw.segments[raw.segments.length - 1]
    expect(remapMsThroughEdl(raw, last.outMs - 1)! + 1).toBe(edlDurationMs(raw))
  })
})

describe("remapTranscriptThroughEdl segments (envelope, not endpoint-probe)", () => {
  it("does not collapse a segment straddling into dropped material", () => {
    const edl = tightenEdl() // s0[0,5000), dropped[5000,8000), s1[8000,12000)
    const t: Transcript = { version: 1, words: [], segments: [{ startMs: 4000, endMs: 6000, text: "spanning" }] }
    const out = remapTranscriptThroughEdl(edl, t).segments!
    // kept portion is [4000,5000) master → output [4000,5000), NOT a 1ms stub
    expect(out[0]).toMatchObject({ startMs: 4000, endMs: 5000 })
  })

  it("never inverts across a crossfade boundary", () => {
    const edl: Edl = {
      version: 1,
      clock: "master",
      sources: [{ id: "m", url: "u", kind: "video", role: "master-audio" }],
      segments: [
        { id: "s0", inMs: 0, outMs: 5000, video: "m" },
        { id: "s1", inMs: 5000, outMs: 9000, video: "m", transition: { type: "crossfade", durationMs: 1000 } },
      ],
    }
    const t: Transcript = { version: 1, words: [], segments: [{ startMs: 4700, endMs: 5300, text: "x" }] }
    const out = remapTranscriptThroughEdl(edl, t).segments![0]
    expect(out.endMs).toBeGreaterThanOrEqual(out.startMs)
  })

  it("spans both when a segment straddles two contiguous kept segments", () => {
    const edl: Edl = {
      version: 1,
      clock: "master",
      sources: [{ id: "m", url: "u", kind: "video", role: "master-audio" }],
      segments: [
        { id: "s0", inMs: 0, outMs: 5000, video: "m" },
        { id: "s1", inMs: 5000, outMs: 9000, video: "m" },
      ],
    }
    const t: Transcript = { version: 1, words: [], segments: [{ startMs: 4000, endMs: 6000, text: "x" }] }
    const out = remapTranscriptThroughEdl(edl, t).segments![0]
    expect(out).toMatchObject({ startMs: 4000, endMs: 6000 })
  })
})

describe("remap boundary exclusivity & range", () => {
  it("outMs is exclusive; out-of-range instants are null", () => {
    const edl = tightenEdl()
    expect(remapMsThroughEdl(edl, 5000)).toBeNull() // == s0.outMs (exclusive) and inside the dropped span
    expect(remapMsThroughEdl(edl, -1)).toBeNull()
    expect(remapMsThroughEdl(edl, 999_999)).toBeNull()
  })

  it("keeps a zero-width word sitting in kept material", () => {
    const edl = tightenEdl()
    const t: Transcript = { version: 1, words: [{ text: "pt", startMs: 2000, endMs: 2000 }] }
    const out = remapTranscriptThroughEdl(edl, t)
    expect(out.words).toHaveLength(1)
    expect(out.words[0]).toMatchObject({ startMs: 2000, endMs: 2000 })
  })
})

describe("validateEdl — transition bound applies only to overlap types", () => {
  it("accepts a long pan/zoom/cut (no xfade, no time consumed)", () => {
    const mk = (type: string): Edl => ({
      version: 1,
      clock: "master",
      sources: [{ id: "m", url: "u", kind: "video", role: "master-audio" }],
      segments: [
        { id: "s0", inMs: 0, outMs: 10000, video: "m" },
        { id: "s1", inMs: 10000, outMs: 20000, video: "m", layout: { mode: "single", transition: { type, durationMs: 9500 } } },
      ],
    })
    expect(validateEdl(mk("pan")).ok).toBe(true)
    expect(validateEdl(mk("zoom")).ok).toBe(true)
    const cut: Edl = {
      version: 1,
      clock: "master",
      sources: [{ id: "m", url: "u", kind: "video", role: "master-audio" }],
      segments: [
        { id: "s0", inMs: 0, outMs: 300, video: "m" },
        { id: "s1", inMs: 300, outMs: 600, video: "m", transition: { type: "cut", durationMs: 5000 } },
      ],
    }
    expect(validateEdl(cut).ok).toBe(true) // a cut's durationMs is inert
  })

  it("still rejects an over-long crossfade with the 0.9·min message", () => {
    const over: Edl = { ...tightenEdl(), segments: [{ id: "s0", inMs: 0, outMs: 5000, video: "master" }, { id: "s1", inMs: 8000, outMs: 12000, video: "master", transition: { type: "crossfade", durationMs: 3800 } }], dropped: undefined }
    expect(validateEdl(over).issues.join("\n")).toMatch(/exceeds 0.9·min/)
  })
})

describe("validateEdl — more branches", () => {
  it("rejects duplicate source id, wrong version, bad clock, audio-typed video, empty url", () => {
    const dup: Edl = { ...tightenEdl(), sources: [{ id: "master", url: "u", kind: "video", role: "master-audio" }, { id: "master", url: "u2", kind: "video" }] }
    expect(validateEdl(dup).issues.join("\n")).toMatch(/duplicate source id/)
    const badV = { ...tightenEdl(), version: 2 } as unknown as Edl
    expect(validateEdl(badV).ok).toBe(false)
    const badClock = { ...tightenEdl(), clock: "wall" } as unknown as Edl
    expect(validateEdl(badClock).issues.join("\n")).toMatch(/clock must be/)
    const audioVideo: Edl = {
      version: 1, clock: "master",
      sources: [{ id: "a", url: "u", kind: "audio", role: "master-audio" }, { id: "v", url: "w", kind: "video" }],
      segments: [{ id: "s", inMs: 0, outMs: 1000, video: "a" }],
    }
    expect(validateEdl(audioVideo).issues.join("\n")).toMatch(/video source "a" is kind:"audio"/)
    const emptyUrl: Edl = { version: 1, clock: "master", sources: [{ id: "m", url: "", kind: "video", role: "master-audio" }], segments: [{ id: "s", inMs: 0, outMs: 1000, video: "m" }] }
    expect(validateEdl(emptyUrl).issues.join("\n")).toMatch(/url is empty/)
  })

  it("accepts a segment whose audio falls back to the master-audio source", () => {
    const edl: Edl = {
      version: 1, clock: "master",
      sources: [{ id: "aud", url: "u", kind: "audio", role: "master-audio" }, { id: "cam", url: "w", kind: "video" }],
      segments: [{ id: "s", inMs: 0, outMs: 1000, video: "cam" }], // no explicit audio → master-audio
    }
    expect(validateEdl(edl).ok).toBe(true)
  })

  it("rejects a segment with no audio and no master-audio/video fallback", () => {
    const edl: Edl = {
      version: 1, clock: "master",
      sources: [{ id: "aud", url: "u", kind: "audio" }], // no master-audio role
      segments: [{ id: "s", inMs: 0, outMs: 1000 }], // no audio, no video
    }
    expect(validateEdl(edl).issues.join("\n")).toMatch(/no audio source and no master-audio\/video fallback/)
  })
})

describe("normalizeEdl — coerce never reject (round-trip through validateEdl)", () => {
  it("handles degenerate input without throwing", () => {
    for (const x of [{}, null, "x", 42, [], { segments: null }]) {
      const n = normalizeEdl(x)
      expect(n.version).toBe(EDL_VERSION)
      expect(n.clock).toBe("master")
      expect(Array.isArray(n.segments)).toBe(true)
    }
    expect(validateEdl(normalizeEdl({})).issues.join("\n")).toMatch(/segments is empty/)
  })

  it("fits a region that per-axis clamping alone would leave out of the frame", () => {
    const n = normalizeEdl({ sources: [{ id: "m", url: "u", kind: "video", role: "master-audio" }], segments: [{ id: "s", inMs: 0, outMs: 1000, video: "m", region: { x: 0.9, y: 0.9, w: 0.5, h: 0.5 } }] })
    expect(validateEdl(n).ok).toBe(true)
    const r = n.segments[0].region!
    expect(r.x + r.w).toBeLessThanOrEqual(1)
    expect(r.y + r.h).toBeLessThanOrEqual(1)
  })

  it("defaults a layout with no mode to \"single\" and keeps its slots + transition", () => {
    const n = normalizeEdl({ segments: [{ id: "a", inMs: 0, outMs: 100 }, { id: "s", inMs: 100, outMs: 200, layout: { slots: [{ source: "a" }, { source: "b" }], transition: { type: "xfade:x", durationMs: 50 } } }] })
    expect(n.segments[1].layout?.mode).toBe("single")
    expect(n.segments[1].layout?.slots).toHaveLength(2)
    expect(n.segments[1].layout?.transition).toMatchObject({ type: "xfade:x" })
  })

  it("strips a transition on segments[0] so validateEdl does not reject a fixable EDL", () => {
    const n = normalizeEdl({
      sources: [{ id: "m", url: "u", kind: "video", role: "master-audio" }],
      segments: [
        { id: "s0", inMs: 0, outMs: 5000, video: "m", transition: { type: "crossfade", durationMs: 100 } },
        { id: "s1", inMs: 8000, outMs: 12000, video: "m" },
      ],
    })
    expect(n.segments[0].transition).toBeUndefined()
    expect(validateEdl(n).ok).toBe(true)
  })

  it("property: a normalized EDL whose only inherent defect is empty-segments/unresolved-ids validates otherwise", () => {
    // A grab-bag of repairable garbage; normalize must not throw, and any
    // remaining issues must be ones normalize genuinely cannot repair.
    const samples = [
      { clock: "weird", sources: [{ id: "m", url: "u", kind: "video", role: "master-audio" }], segments: [{ inMs: 0, outMs: 1000, video: "m", region: { x: 2, y: -1, w: 5, h: 5 } }] },
      { sources: [{ id: "m", url: "u", kind: "video", role: "master-audio" }], segments: [{ inMs: 0, outMs: 1000, video: "m", transition: { type: "crossfade", durationMs: 1e9 } }] },
    ]
    for (const s of samples) {
      const n = normalizeEdl(s)
      const r = validateEdl(n)
      // These specific samples are repairable to valid (region fitted, seg[0]
      // transition stripped) — so they should validate clean.
      expect(r.ok).toBe(true)
    }
  })
})

describe("validateEdlClipSet with a diverse set", () => {
  it("validates a mixed-length clip set", () => {
    const clipA = tightenEdl()
    const clipB: Edl = { version: 1, clock: "master", sources: clipA.sources, segments: [{ id: "c", inMs: 0, outMs: 3000, video: "master" }], meta: { hook: "watch this" } }
    expect(validateEdlClipSet({ version: 1, clips: [clipA, clipB] }).ok).toBe(true)
  })
})

describe("transition.durationMs is optional (inert for non-overlap types)", () => {
  it("accepts a cut with no durationMs and counts no overlap", () => {
    const edl: Edl = {
      version: 1,
      clock: "master",
      sources: [{ id: "m", url: "u", kind: "video", role: "master-audio" }],
      segments: [
        { id: "s0", inMs: 0, outMs: 5000, video: "m" },
        { id: "s1", inMs: 8000, outMs: 12000, video: "m", transition: { type: "cut" } },
      ],
    }
    expect(validateEdl(edl).ok).toBe(true)
    expect(edlDurationMs(edl)).toBe(9000)
  })

  it("normalizeEdl zeroes a cut's durationMs (inert)", () => {
    const n = normalizeEdl({
      sources: [{ id: "m", url: "u", kind: "video", role: "master-audio" }],
      segments: [
        { id: "s0", inMs: 0, outMs: 5000, video: "m" },
        { id: "s1", inMs: 8000, outMs: 12000, video: "m", transition: { type: "cut", durationMs: 5000 } },
      ],
    })
    expect(n.segments[1].transition).toEqual({ type: "cut", durationMs: 0 })
  })

  it("validateEdl does not throw on a raw object that skipped normalize", () => {
    expect(() => validateEdl({ version: 1, clock: "master" } as unknown as Edl)).not.toThrow()
    expect(validateEdl({ version: 1, clock: "master" } as unknown as Edl).ok).toBe(false)
  })
})

describe("unwrapEditPlanOutput — the app-side clips/tighten/chapters unwrap", () => {
  it("clips: EdlClipSet { version, clips: Edl[] } → the BARE Edl[] (fans out)", () => {
    const clips = [tightenEdl(), tightenEdl()]
    const out = unwrapEditPlanOutput({ version: 1, clips, viaNodaroCloud: true })
    // The bare array, ready for the `list` fan-out (Array.isArray on generatedJson);
    // each element is one Edl a downstream `edl` input normalizeEdl-parses.
    expect(Array.isArray(out)).toBe(true)
    expect(out).toEqual(clips)
    // A round-trip through JSON.stringify (the fan-out per-item form) still parses
    // to a valid EDL — the whole point of the bare-array shape.
    const perItem = (out as Edl[]).map((c) => JSON.stringify(c))
    expect(validateEdl(normalizeEdl(JSON.parse(perItem[0]))).ok).toBe(true)
  })

  it("chapters: { version, chapters } → the object minus bookkeeping", () => {
    const chapters = [{ startMs: 0, title: "Intro" }, { startMs: 60000, title: "Topic" }]
    const out = unwrapEditPlanOutput({ version: 1, chapters, viaNodaroCloud: true })
    expect(out).toEqual({ version: EDL_VERSION, chapters })
    expect(Array.isArray(out)).toBe(false)
  })

  it("tighten: the Edl at top level → the Edl, with viaNodaroCloud stripped", () => {
    const edl = tightenEdl()
    const out = unwrapEditPlanOutput({ ...edl, viaNodaroCloud: true })
    expect(out).toEqual(edl)
    expect((out as Record<string, unknown>).viaNodaroCloud).toBeUndefined()
  })

  it("passes a non-object through unchanged", () => {
    expect(unwrapEditPlanOutput(undefined)).toBeUndefined()
    expect(unwrapEditPlanOutput(null)).toBeNull()
  })
})

describe("edit-plan credit-id scheme", () => {
  it("rounds a probed duration UP to the covering bucket; unknown → the ceiling", () => {
    expect(editPlanBucketMinutes(45 * 60)).toBe(60)
    expect(editPlanBucketMinutes(60 * 60)).toBe(60)
    expect(editPlanBucketMinutes(61 * 60)).toBe(90)
    expect(editPlanBucketMinutes(10 * 3600)).toBe(180) // capped
    expect(editPlanBucketMinutes(undefined)).toBe(180) // ceiling
  })

  it("builds `edit-plan:<mode>:<tier>:<bucket>m`", () => {
    expect(buildEditPlanCreditId("tighten", "standard", 45 * 60)).toBe("edit-plan:tighten:standard:60m")
    expect(buildEditPlanCreditId("clips", "premium", undefined)).toBe("edit-plan:clips:premium:180m")
  })
})

describe("editPlanSourceDurationSec — audio-master lane (avoids the ceiling overbill)", () => {
  it("reads an audio master's length from metadata.durationSeconds (upload-audio writes it there ONLY)", () => {
    // A 45-minute podcast master → 2700s → the 60m bucket, NOT the 180m ceiling.
    expect(editPlanSourceDurationSec({ metadata: { durationSeconds: 2700 } })).toBe(2700)
    expect(buildEditPlanCreditId("tighten", "standard", editPlanSourceDurationSec({ metadata: { durationSeconds: 2700 } }))).toBe("edit-plan:tighten:standard:60m")
  })

  it("still prefers the video lane (generatedResults / data.duration) when present", () => {
    expect(editPlanSourceDurationSec({ generatedResults: [{ duration: 120 }], activeResultIndex: 0 })).toBe(120)
    expect(editPlanSourceDurationSec({ duration: 90 })).toBe(90)
  })

  it("returns undefined (→ ceiling bucket) when no duration is known", () => {
    expect(editPlanSourceDurationSec({})).toBeUndefined()
    expect(editPlanSourceDurationSec({ metadata: {} })).toBeUndefined()
    expect(editPlanSourceDurationSec(undefined)).toBeUndefined()
  })
})

describe("transcriptDurationSec — the URL-source reserve fallback (beneath the probe)", () => {
  it("reads the source clock from the MAX word endMs", () => {
    // A 59.4-min episode: latest word ends at 3,564,000 ms → 3564s → the 60m
    // bucket, NOT the 180m ceiling (the reported over-reservation).
    const t = { version: 1, words: [{ text: "hi", startMs: 0, endMs: 500 }, { text: "bye", startMs: 3_563_000, endMs: 3_564_000 }] }
    expect(transcriptDurationSec(t)).toBe(3564)
    expect(buildEditPlanCreditId("tighten", "standard", transcriptDurationSec(t))).toBe("edit-plan:tighten:standard:60m")
  })

  it("takes the MAX endMs so an out-of-order words array can't under-report", () => {
    const t = { words: [{ endMs: 3_564_000 }, { endMs: 12_000 }, { endMs: 1_000 }] }
    expect(transcriptDurationSec(t)).toBe(3564)
  })

  it("reads segments when a transcript carries no words", () => {
    expect(transcriptDurationSec({ segments: [{ startMs: 0, endMs: 90_000 }] })).toBe(90)
  })

  it("takes the MAX over BOTH words and segments (a segment tail past the last word wins)", () => {
    // The plugin's transcriptDurationMs maxes both; a words-only or
    // segments-only-when-empty read would under-report the tail.
    const t = {
      words: [{ endMs: 3_540_000 }], // 59.0 min
      segments: [{ startMs: 0, endMs: 3_600_000 }], // 60.0 min tail
    }
    expect(transcriptDurationSec(t)).toBe(3600)
  })

  it("returns undefined (→ ceiling, safe direction) for an empty / unmeasurable transcript", () => {
    expect(transcriptDurationSec({ words: [] })).toBeUndefined()
    expect(transcriptDurationSec({})).toBeUndefined()
    expect(transcriptDurationSec(undefined)).toBeUndefined()
    expect(transcriptDurationSec("not-an-object")).toBeUndefined()
    expect(transcriptDurationSec({ words: [{ endMs: "x" }, { endMs: NaN }] })).toBeUndefined()
    expect(buildEditPlanCreditId("tighten", "standard", transcriptDurationSec({ words: [] }))).toBe("edit-plan:tighten:standard:180m")
  })
})

describe("clampEditPlanClipCount", () => {
  it("clamps into [1, EDIT_PLAN_MAX_CLIP_COUNT] and floors", () => {
    expect(clampEditPlanClipCount(5)).toBe(5)
    expect(clampEditPlanClipCount(7.9)).toBe(7)
    expect(clampEditPlanClipCount(0.4)).toBe(1)
    expect(clampEditPlanClipCount(9000)).toBe(EDIT_PLAN_MAX_CLIP_COUNT)
  })
  it("is undefined for anything that is not a positive finite number", () => {
    for (const bad of [undefined, null, 0, -3, Number.NaN, Number.POSITIVE_INFINITY, "12", {}]) {
      expect(clampEditPlanClipCount(bad)).toBeUndefined()
    }
  })
  it("the default sits inside the allowed range", () => {
    expect(EDIT_PLAN_DEFAULT_CLIP_COUNT).toBeGreaterThanOrEqual(1)
    expect(EDIT_PLAN_DEFAULT_CLIP_COUNT).toBeLessThanOrEqual(EDIT_PLAN_MAX_CLIP_COUNT)
  })
})

// ── Warning class (F2): registry judgements never flip `ok` ───────────────

/** A two-camera EDL on a master mic, every field valid; each case below bends ONE thing. */
function multicamEdl(): Edl {
  return {
    version: 1,
    clock: "master",
    sources: [
      { id: "mic", url: "https://x/m.wav", kind: "audio", role: "master-audio" },
      { id: "wide", url: "https://x/w.mp4", kind: "video", role: "wide" },
      { id: "camA", url: "https://x/a.mp4", kind: "video", role: "camera" },
      { id: "camB", url: "https://x/b.mp4", kind: "video", role: "camera" },
    ],
    segments: [
      { id: "s0", inMs: 0, outMs: 4000, video: "wide" },
      { id: "s1", inMs: 4000, outMs: 8000, video: "camA" },
    ],
    meta: { targetAspect: "16:9" },
  }
}

/** Replace segment[1] with extra fields. */
function withSeg1(extra: Partial<Edl["segments"][number]>, base: Edl = multicamEdl()): Edl {
  return { ...base, segments: [base.segments[0], { ...base.segments[1], ...extra }] }
}

function expectWarnOnly(edl: Edl, pattern: RegExp): void {
  const r = validateEdl(edl)
  expect(r.issues).toEqual([])
  expect(r.ok).toBe(true)
  expect(r.warnings.length).toBeGreaterThanOrEqual(1)
  expect(r.warnings.join("\n")).toMatch(pattern)
}

describe("validateEdl — warnings (registry class; ok stays true)", () => {
  it("the valid multicam fixture has neither issues nor warnings", () => {
    expect(validateEdl(multicamEdl())).toEqual({ ok: true, issues: [], warnings: [] })
  })

  it("an unknown source role warns (known roles are listed)", () => {
    const base = multicamEdl()
    const edl: Edl = { ...base, sources: base.sources.map((s) => (s.id === "camB" ? { ...s, role: "b-roll" } : s)) }
    expectWarnOnly(edl, /source "camB": unknown role "b-roll" \(known: master-audio, camera, wide, screen\)/)
  })

  it("a typo'd master-audio stays visible: normalizeEdl passes the role through and it warns", () => {
    const n = normalizeEdl({ ...multicamEdl(), sources: [{ id: "mic", url: "u", kind: "audio", role: "master-audo" }, { id: "wide", url: "w", kind: "video" }, { id: "camA", url: "a", kind: "video" }] })
    expect(n.sources[0].role).toBe("master-audo")
    expect(validateEdl(n).warnings.join("\n")).toMatch(/unknown role "master-audo"/)
  })

  it("an unknown meta.targetAspect warns — and the type accepts it (open like role)", () => {
    const edl: Edl = { ...multicamEdl(), meta: { targetAspect: "21:9" } }
    expectWarnOnly(edl, /meta\.targetAspect "21:9"/)
  })

  it("a JSON null for an absent field is absent: null targetAspect / null role never warn", () => {
    const edl = {
      ...multicamEdl(),
      meta: { targetAspect: null },
      sources: multicamEdl().sources.map((s, i) => (i === 0 ? { ...s, role: null } : s)),
    } as unknown as Edl
    expect(validateEdl(edl).warnings).toEqual([])
  })

  it("a known-atom emphasis that breaks the set rules says which rule, not 'unknown'", () => {
    expectWarnOnly(withSeg1({ layout: { mode: "single", emphasis: { style: "none+scale", durationMs: 200 } } }), /"none" must stand alone/)
    expectWarnOnly(withSeg1({ layout: { mode: "single", emphasis: { style: "glow", durationMs: 200 } } }), /unknown emphasis style "glow"/)
  })

  it("an unknown layout mode warns (mode stays an open string)", () => {
    expectWarnOnly(withSeg1({ layout: { mode: "carousel" } }), /segment\[1\] "s1": unknown layout mode "carousel"/)
  })

  it("a known layout whose slot count is outside [min, max] warns", () => {
    const edl = withSeg1({ layout: { mode: "side-by-side", slots: [{ source: "camA" }, { source: "camB" }, { source: "wide" }] } })
    expectWarnOnly(edl, /layout "side-by-side" takes 2 slot\(s\), got 3/)
  })

  it("a known layout not drawn for the known targetAspect warns", () => {
    const base = { ...multicamEdl(), meta: { targetAspect: "9:16" as const } }
    const edl = withSeg1({ layout: { mode: "side-by-side", slots: [{ source: "camA" }, { source: "camB" }] } }, base)
    expectWarnOnly(edl, /layout "side-by-side" is not drawn for targetAspect 9:16/)
    // …and the same layout on 16:9 is silent.
    expect(validateEdl(withSeg1({ layout: { mode: "side-by-side", slots: [{ source: "camA" }, { source: "camB" }] } })).warnings).toEqual([])
  })

  it("an unknown layout transition type warns", () => {
    expectWarnOnly(withSeg1({ layout: { mode: "single", transition: { type: "wipe" } } }), /unknown layout transition "wipe"/)
    // A known xfade id is silent.
    expect(validateEdl(withSeg1({ layout: { mode: "single", transition: { type: "xfade:fade", durationMs: 200 } } })).warnings).toEqual([])
  })

  it("a same-source switch (pan) between two DIFFERENT single picture sources warns", () => {
    expectWarnOnly(withSeg1({ layout: { mode: "single", transition: { type: "pan" } } }), /switch "pan" moves within ONE picture source.*"wide".*"camA"/)
  })

  it("pan within one source, or across a multi-slot neighbour, does not warn (no defined 'picture source' there)", () => {
    const same = withSeg1({ video: "wide", region: { x: 0.5, y: 0, w: 0.5, h: 1 }, layout: { mode: "single", transition: { type: "pan" } } })
    expect(validateEdl(same).warnings).toEqual([])
    const multi = withSeg1({ layout: { mode: "side-by-side", slots: [{ source: "camA" }, { source: "camB" }], transition: { type: "pan" } } })
    expect(validateEdl(multi).warnings).toEqual([])
    // zoom is not a same-source switch.
    expect(validateEdl(withSeg1({ layout: { mode: "single", transition: { type: "zoom" } } })).warnings).toEqual([])
  })

  it("an unknown emphasis style (any unknown atom) warns; a known '+'-joined set does not", () => {
    expectWarnOnly(withSeg1({ layout: { mode: "single", emphasis: { style: "scale+glow", durationMs: 200 } } }), /unknown emphasis style "scale\+glow"/)
    expect(validateEdl(withSeg1({ layout: { mode: "single", emphasis: { style: "scale+border", durationMs: 200 } } })).warnings).toEqual([])
  })

  it("a slots-only layout with ≥2 slots WARNS after normalizeEdl defaults its mode to \"single\" — that EDL is ambiguous; do not 'fix' normalize by guessing a mode", () => {
    const n = normalizeEdl({ ...multicamEdl(), segments: [multicamEdl().segments[0], { id: "s1", inMs: 4000, outMs: 8000, video: "camA", layout: { slots: [{ source: "camA" }, { source: "camB" }] } }] })
    expect(n.segments[1].layout?.mode).toBe("single")
    expectWarnOnly(n, /layout "single" takes 1 slot\(s\), got 2/)
  })

  it("an existing error case still yields ok:false (warnings never mask issues)", () => {
    const base = multicamEdl()
    const edl: Edl = {
      ...base,
      sources: [...base.sources, { id: "mic2", url: "u", kind: "audio", role: "master-audio" }, { id: "x", url: "u", kind: "video", role: "b-roll" }],
    }
    const r = validateEdl(edl)
    expect(r.ok).toBe(false)
    expect(r.issues.join("\n")).toMatch(/more than one source has role:"master-audio"/)
    expect(r.warnings.join("\n")).toMatch(/unknown role "b-roll"/)
  })

  it("validateEdlClipSet propagates warnings with the clip[i] prefix and stays ok", () => {
    const warned = withSeg1({ layout: { mode: "carousel" } })
    const r = validateEdlClipSet({ version: 1, clips: [multicamEdl(), warned] })
    expect(r.ok).toBe(true)
    expect(r.issues).toEqual([])
    expect(r.warnings).toEqual([expect.stringMatching(/^clip\[1\]: segment\[1\] "s1": unknown layout mode "carousel"/)])
  })
})
