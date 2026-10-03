/**
 * Unit tests for the apply-edl effective-EDL + pricing helper — the ONE module
 * the route, the payload-builder and the worker all depend on for the SAME
 * normalized EDL, reserve and remap. The reserve fixtures below are the exact
 * worked examples in docs/nodes/processing-video/apply-edl.md (CLAUDE.md:
 * "Worked examples in docs MUST match the test cases in code").
 */
import { describe, it, expect } from "vitest"
import { validateEdl, edlDurationMs, type Edl } from "@nodaro/shared"
import {
  buildEffectiveEdl,
  applyEdlReserveMinutes,
  applyEdlBaseCredits,
  validateEffectiveEdl,
  APPLY_EDL_CREDITS_PER_OUTPUT_MINUTE,
} from "../apply-edl-plan.js"

const oneSegment = (durMs: number): Edl => ({
  version: 1,
  clock: "master",
  sources: [{ id: "A", url: "https://m.test/a.mp4", kind: "video" }],
  segments: [{ id: "s0", inMs: 0, outMs: durMs, video: "A", audio: "A" }],
})

describe("apply-edl pricing (matches the docs worked examples)", () => {
  it("bills per RENDERED minute, ceil, floor 1 minute", () => {
    // docs table: 40 s → 10 · 3 min 10 s (190 s) → 40 · 12 min (720 s) → 120
    expect(applyEdlBaseCredits(oneSegment(40_000))).toBe(10)
    expect(applyEdlBaseCredits(oneSegment(190_000))).toBe(40)
    expect(applyEdlBaseCredits(oneSegment(720_000))).toBe(120)
  })

  it("reserve minutes = ceil(edlDurationMs/60000), floor 1", () => {
    expect(applyEdlReserveMinutes(oneSegment(40_000))).toBe(1)
    expect(applyEdlReserveMinutes(oneSegment(190_000))).toBe(4)
    expect(applyEdlReserveMinutes(oneSegment(720_000))).toBe(12)
    // base = per-minute × minutes
    expect(applyEdlBaseCredits(oneSegment(190_000))).toBe(APPLY_EDL_CREDITS_PER_OUTPUT_MINUTE * 4)
  })

  it("reserves on the OVERLAP-COMPRESSED duration (a crossfade shortens the bill)", () => {
    const edl = buildEffectiveEdl(
      {
        version: 1,
        clock: "master",
        sources: [{ id: "A", url: "u", kind: "video" }],
        segments: [
          { id: "s0", inMs: 0, outMs: 60_000, video: "A", audio: "A" },
          { id: "s1", inMs: 0, outMs: 60_000, video: "A", audio: "A", transition: { type: "crossfade", durationMs: 30_000 } },
        ],
      },
      {},
    )
    // 60000 + 60000 − 30000 = 90000 ms → 2 minutes.
    expect(edlDurationMs(edl)).toBe(90_000)
    expect(applyEdlReserveMinutes(edl)).toBe(2)
  })
})

describe("buildEffectiveEdl — default crossfade injection", () => {
  const two = (segTwoTransition?: Edl["segments"][number]["transition"]): unknown => ({
    version: 1,
    clock: "master",
    sources: [{ id: "A", url: "u", kind: "video" }],
    segments: [
      { id: "s0", inMs: 0, outMs: 10_000, video: "A", audio: "A" },
      { id: "s1", inMs: 0, outMs: 600, video: "A", audio: "A", ...(segTwoTransition ? { transition: segTwoTransition } : {}) },
    ],
  })

  it("injects a crossfade on a boundary with no transition, clamped to floor(0.9·min(adjacent))", () => {
    const edl = buildEffectiveEdl(two(), { crossfadeMs: 5000 })
    // min(adjacent) = min(10000, 600) = 600 → floor(0.9·600) = 540.
    expect(edl.segments[1].transition).toEqual({ type: "crossfade", durationMs: 540 })
    // The clamp keeps the result VALID (the R5 promise: never inject a blend
    // validateEdl would then reject).
    expect(validateEdl(edl).ok).toBe(true)
  })

  it("never overwrites an EXPLICIT transition with the node default", () => {
    const edl = buildEffectiveEdl(two({ type: "cut" }), { crossfadeMs: 5000 })
    expect(edl.segments[1].transition?.type).toBe("cut")
  })

  it("crossfadeMs 0 (default) leaves hard cuts", () => {
    const edl = buildEffectiveEdl(two(), {})
    expect(edl.segments[1].transition).toBeUndefined()
    expect(edlDurationMs(edl)).toBe(10_600)
  })
})

describe("buildEffectiveEdl — positional source overrides", () => {
  it("replaces EdlSource[i].url in edge order, leaving unspecified sources intact", () => {
    const raw: unknown = {
      version: 1,
      clock: "master",
      sources: [
        { id: "A", url: "https://orig/a.mp4", kind: "video" },
        { id: "B", url: "https://orig/b.mp4", kind: "video" },
      ],
      segments: [{ id: "s0", inMs: 0, outMs: 1000, video: "A", audio: "A" }],
    }
    const edl = buildEffectiveEdl(raw, { sourceOverrides: [undefined, "https://new/b.mp4"] })
    expect(edl.sources[0].url).toBe("https://orig/a.mp4")
    expect(edl.sources[1].url).toBe("https://new/b.mp4")
  })

  it("ignores a non-string override without throwing (computeCredits runs on raw pre-Zod body → clean 400, not 500)", () => {
    const raw: unknown = {
      version: 1,
      clock: "master",
      sources: [{ id: "A", url: "https://orig/a.mp4", kind: "video" }],
      segments: [{ id: "s0", inMs: 0, outMs: 1000, video: "A", audio: "A" }],
    }
    const edl = buildEffectiveEdl(raw, { sourceOverrides: [123 as unknown as string] })
    expect(edl.sources[0].url).toBe("https://orig/a.mp4")
  })
})

describe("validateEffectiveEdl — output-aware picture requirement", () => {
  const pictureless: Edl = {
    version: 1,
    clock: "master",
    sources: [{ id: "M", url: "https://m.test/m.m4a", kind: "audio", role: "master-audio" }],
    segments: [{ id: "s0", inMs: 0, outMs: 2000, audio: "M" }],
  }

  it("rejects a picture-less segment for a VIDEO output", () => {
    const r = validateEffectiveEdl(pictureless, "video")
    expect(r.ok).toBe(false)
    expect(r.issues.some((i) => /no video source/.test(i))).toBe(true)
  })

  it("accepts the same EDL for an AUDIO output", () => {
    expect(validateEffectiveEdl(pictureless, "audio").ok).toBe(true)
  })

  it("names an unresolvable source url rather than passing it to the renderer", () => {
    const edl = buildEffectiveEdl(
      {
        version: 1,
        clock: "master",
        sources: [{ id: "A", url: "", kind: "video" }],
        segments: [{ id: "s0", inMs: 0, outMs: 1000, video: "A", audio: "A" }],
      },
      {},
    )
    const r = validateEffectiveEdl(edl, "video")
    expect(r.ok).toBe(false)
    expect(r.issues.some((i) => i.includes("A"))).toBe(true)
  })
})

// What the phase-1 renderer cannot render is refused at ingress, never silently
// dropped: it ignores layout/region fields, but `edlDurationMs` still subtracts a
// layout xfade's overlap — so a dropped xfade meant a hard-cut render reserved
// and caption-remapped as if it were shorter. A 400 naming the segment, instead.
describe("validateEffectiveEdl — refuses what the renderer cannot render", () => {
  const src = [
    { id: "A", url: "https://m.test/a.mp4", kind: "video" as const },
    { id: "B", url: "https://m.test/b.mp4", kind: "video" as const },
  ]
  const one = (seg: Record<string, unknown>): Edl =>
    ({ version: 1, clock: "master", sources: src, segments: [{ id: "s0", inMs: 0, outMs: 2000, video: "A", ...seg }] }) as unknown as Edl

  it("rejects a multi-slot layout, naming the segment", () => {
    const r = validateEffectiveEdl(one({ layout: { mode: "side-by-side", slots: [{ source: "A" }, { source: "B" }] } }), "video")
    expect(r.ok).toBe(false)
    expect(r.issues.some((i) => /segment\[0\] "s0".*2 slots/.test(i))).toBe(true)
  })

  it("rejects a layout transition the renderer would drop (xfade / pan / zoom) — but accepts an explicit cut", () => {
    // A transition is "into THIS segment", so it lives on a second segment
    // (the structural validator refuses any transition on segments[0]).
    const second = (transition: Record<string, unknown>): Edl =>
      ({
        version: 1, clock: "master", sources: src,
        segments: [
          { id: "s0", inMs: 0, outMs: 2000, video: "A" },
          { id: "s1", inMs: 2000, outMs: 4000, video: "B", layout: { mode: "single", transition } },
        ],
      }) as unknown as Edl
    for (const type of ["xfade:fade", "pan", "zoom"]) {
      const r = validateEffectiveEdl(second({ type, durationMs: 500 }), "video")
      expect(r.ok, type).toBe(false)
      expect(r.issues.some((i) => i.includes(`segment[1] "s1"`) && i.includes(`layout transition "${type}"`)), type).toBe(true)
    }
    expect(validateEffectiveEdl(second({ type: "cut" }), "video").ok).toBe(true)
  })

  it("a layout xfade cannot slip through buildEffectiveEdl as a silent hard cut at a compressed reserve", () => {
    const edl = buildEffectiveEdl(
      {
        version: 1, clock: "master", sources: src,
        segments: [
          { id: "s0", inMs: 0, outMs: 4000, video: "A" },
          { id: "s1", inMs: 4000, outMs: 8000, video: "B", layout: { mode: "single", transition: { type: "xfade:fade", durationMs: 1000 } } },
        ],
      },
      { crossfadeMs: 500 },
    )
    // buildEffectiveEdl leaves the editorial layout transition alone (no default
    // crossfade injected under it) — and validation then refuses it outright.
    expect(edl.segments[1]!.transition).toBeUndefined()
    expect(validateEffectiveEdl(edl, "video").ok).toBe(false)
  })

  it("rejects region crops on a segment, a slot, or a source", () => {
    const region = { x: 0.1, y: 0.1, w: 0.5, h: 0.5 }
    expect(validateEffectiveEdl(one({ region }), "video").ok).toBe(false)
    expect(validateEffectiveEdl(one({ layout: { mode: "single", slots: [{ source: "A", region }] } }), "video").ok).toBe(false)
    const withSourceRegion: Edl = { ...one({}), sources: [{ ...src[0]!, region }, src[1]!] } as Edl
    const r = validateEffectiveEdl(withSourceRegion, "video")
    expect(r.ok).toBe(false)
    expect(r.issues.some((i) => /source "A": region/.test(i))).toBe(true)
  })

  // A layout is renderable only when it describes exactly what this renderer
  // does anyway — "single", the one slot IS segment.video, no emphasis, a cut.
  // Anything else would render as something other than what the EDL says.
  it("rejects a layout mode other than \"single\" — one source full-frame is all this renderer shows", () => {
    for (const mode of ["side-by-side", "pip", "grid"]) {
      const r = validateEffectiveEdl(one({ layout: { mode, slots: [{ source: "A" }] } }), "video")
      expect(r.ok, mode).toBe(false)
      expect(r.issues.some((i) => i.includes(`segment[0] "s0"`) && i.includes(`layout mode "${mode}"`)), mode).toBe(true)
    }
  })

  it("rejects a single slot that names a different source than segment.video (the renderer shows segment.video)", () => {
    const r = validateEffectiveEdl(one({ layout: { mode: "single", slots: [{ source: "B" }] } }), "video")
    expect(r.ok).toBe(false)
    expect(r.issues.some((i) => i.includes(`slot shows "B"`) && i.includes(`video is "A"`))).toBe(true)
  })

  it("rejects a layout emphasis other than \"none\" (dropped by the renderer) — and accepts \"none\"", () => {
    const r = validateEffectiveEdl(one({ layout: { mode: "single", emphasis: { style: "scale", durationMs: 300 } } }), "video")
    expect(r.ok).toBe(false)
    expect(r.issues.some((i) => i.includes(`layout emphasis "scale"`))).toBe(true)
    expect(validateEffectiveEdl(one({ layout: { mode: "single", emphasis: { style: "none", durationMs: 0 } } }), "video").ok).toBe(true)
  })

  it("accepts a single-slot layout on segment.video with no transition, emphasis or region", () => {
    expect(validateEffectiveEdl(one({ layout: { mode: "single", slots: [{ source: "A" }] } }), "video").ok).toBe(true)
  })
})

// The shared contract files an unknown `role` as a WARNING (a newer producer may
// know more roles); this executor knows exactly EDL_SOURCE_ROLES and acts on
// "master-audio", so a misspelled one would silently use each camera's own
// sound. Ingress PROMOTES it to an issue.
describe("validateEffectiveEdl — an unknown source role is refused", () => {
  const withRole = (role: string): Edl =>
    buildEffectiveEdl({
      version: 1,
      clock: "master",
      sources: [
        { id: "mic", url: "https://m.test/m.wav", kind: "audio", role },
        { id: "A", url: "https://m.test/a.mp4", kind: "video", role: "camera" },
      ],
      segments: [{ id: "s0", inMs: 0, outMs: 2000, video: "A" }],
    })

  it("promotes the shared-contract warning to an issue naming the source and the known roles", () => {
    const edl = withRole("master-audo")
    // The shared validator only warns…
    expect(validateEdl(edl).ok).toBe(true)
    expect(validateEdl(edl).warnings.join("\n")).toMatch(/unknown role "master-audo"/)
    // …the executor refuses.
    const r = validateEffectiveEdl(edl, "video")
    expect(r.ok).toBe(false)
    expect(r.issues).toContainEqual(expect.stringMatching(/^source "mic": unknown role "master-audo" — this renderer knows only master-audio, camera, wide, screen/))
  })

  it("accepts every known role", () => {
    for (const role of ["master-audio", "camera", "wide", "screen"]) {
      expect(validateEffectiveEdl(withRole(role), "video").issues, role).toEqual([])
    }
  })
})

// `masterMs = sourceMs + offsetMs`: a segment starting before a source's origin
// would read negative source time. The renderer used to clamp that to 0 and
// deliver the wrong picture; ingress now names the segment and the source.
describe("validateEffectiveEdl — a segment must start on its source", () => {
  const edlWith = (sources: Edl["sources"], seg: Record<string, unknown>): Edl =>
    ({ version: 1, clock: "master", sources, segments: [{ id: "s0", ...seg }] }) as unknown as Edl

  it("rejects a segment that starts before its VIDEO source's offset, naming both", () => {
    const r = validateEffectiveEdl(
      edlWith([{ id: "cam", url: "https://m.test/cam.mp4", kind: "video", offsetMs: 5000 }], { inMs: 2000, outMs: 9000, video: "cam" }),
      "video",
    )
    expect(r.ok).toBe(false)
    expect(r.issues.some((i) => /segment\[0\] "s0".*source "cam" begins at 5000ms/.test(i))).toBe(true)
  })

  it("checks the AUDIO source too — explicit, master-audio role, or the picture source by default", () => {
    const explicit = edlWith(
      [
        { id: "cam", url: "https://m.test/cam.mp4", kind: "video" },
        { id: "mic", url: "https://m.test/mic.m4a", kind: "audio", offsetMs: 3000 },
      ],
      { inMs: 1000, outMs: 6000, video: "cam", audio: "mic" },
    )
    expect(validateEffectiveEdl(explicit, "video").issues.some((i) => /source "mic" begins at 3000ms/.test(i))).toBe(true)
    const master = edlWith(
      [
        { id: "cam", url: "https://m.test/cam.mp4", kind: "video" },
        { id: "mic", url: "https://m.test/mic.m4a", kind: "audio", role: "master-audio", offsetMs: 3000 },
      ],
      { inMs: 1000, outMs: 6000, video: "cam" },
    )
    expect(validateEffectiveEdl(master, "video").issues.some((i) => /source "mic" begins at 3000ms/.test(i))).toBe(true)
  })

  it("accepts a segment that starts exactly at the source's offset, and any segment on an un-offset source", () => {
    expect(validateEffectiveEdl(
      edlWith([{ id: "cam", url: "https://m.test/cam.mp4", kind: "video", offsetMs: 5000 }], { inMs: 5000, outMs: 9000, video: "cam" }),
      "video",
    ).ok).toBe(true)
    expect(validateEffectiveEdl(
      edlWith([{ id: "cam", url: "https://m.test/cam.mp4", kind: "video" }], { inMs: 0, outMs: 9000, video: "cam" }),
      "video",
    ).ok).toBe(true)
  })

  // "Reads" is the executor's rule: an audio-only output never touches the
  // picture source, so a late-starting camera cannot refuse an audio cut that
  // reads only the master mic — while the same EDL as a video edit is refused.
  it("for an audio-only output, checks only the sound source — a late-starting camera does not refuse the cut", () => {
    const edl = edlWith(
      [
        { id: "cam", url: "https://m.test/cam.mp4", kind: "video", offsetMs: 5000 },
        { id: "mic", url: "https://m.test/mic.m4a", kind: "audio", role: "master-audio" },
      ],
      { inMs: 2000, outMs: 9000, video: "cam" },
    )
    expect(validateEffectiveEdl(edl, "audio").ok).toBe(true)
    expect(validateEffectiveEdl(edl, "video").issues.some((i) => /source "cam" begins at 5000ms/.test(i))).toBe(true)
  })
})
