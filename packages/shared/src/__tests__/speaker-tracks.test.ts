import { readFileSync } from "node:fs"
import { describe, it, expect } from "vitest"
import {
  SPEAKER_TRACKS_VERSION,
  SPEAKER_TRACK_ATTRIBUTION_METHODS,
  SPEAKER_TRACKS_MAX_BOXES_PER_SOURCE,
  SPEAKER_TRACKS_MAX_BYTES,
  normalizeSpeakerTracks,
  validateSpeakerTracks,
  describeSpeakerTracks,
  normalizeSpeakerTrackSetDescriptor,
  validateSpeakerTrackSetDescriptor,
  edlSpeakerSpace,
  type SpeakerTrackSet,
} from "../speaker-tracks.js"
import { normalizeEdl, remapMsThroughEdl, type Edl } from "../edl.js"
import * as shared from "../index.js"

interface Fixture {
  readonly name: string
  readonly edl?: string
  readonly edls?: readonly string[]
  readonly input: unknown
  /** Validate `input` exactly as given, without normalizing it first. */
  readonly validateInput?: boolean
  readonly normalized?: unknown
  readonly validation: { readonly ok: boolean; readonly issues: readonly string[]; readonly warnings: readonly string[] }
}
const FIXTURES = JSON.parse(
  readFileSync(new URL("./fixtures/speaker-tracks.fixtures.json", import.meta.url), "utf8"),
) as { edls: Record<string, unknown>; cases: Fixture[] }

function fixtureEdl(f: Fixture): Edl | Edl[] | undefined {
  if (f.edls) return f.edls.map((k) => normalizeEdl(FIXTURES.edls[k]))
  if (f.edl) return normalizeEdl(FIXTURES.edls[f.edl])
  return undefined
}

// ─────────────────────────────────────────────────────────────────────────
//  A seeded generator (no property-testing dependency): deterministic, so a
//  failure reproduces from its seed.
// ─────────────────────────────────────────────────────────────────────────
function rng(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

/** Arbitrary, often malformed, input: wrong types, out-of-range numbers,
 *  unsorted boxes, fractional ms, extra keys. */
function garbageSet(r: () => number): unknown {
  const pick = <T,>(xs: readonly T[]): T => xs[Math.floor(r() * xs.length)]
  const anyNum = () => pick([r() * 2 - 0.5, r() * 100000, -r() * 1000, NaN, Infinity, Math.round(r() * 9000) + r()])
  const anyVal = () => pick<unknown>([anyNum(), "1", null, undefined, {}, [], true])
  const box = () =>
    r() < 0.15
      ? anyVal()
      : { ms: r() < 0.9 ? anyNum() : anyVal(), x: anyNum(), y: anyNum(), w: anyNum(), h: anyNum(), ...(r() < 0.5 ? { score: anyNum() } : {}), junk: anyVal() }
  const track = () => ({
    ...(r() < 0.8 ? { id: pick(["a", "b", "", 7, "wide/t1"]) } : {}),
    ...(r() < 0.6 ? { speaker: pick(["Host", "Guest", "", 3]) } : {}),
    ...(r() < 0.6 ? { attribution: pick<unknown>([{ method: pick(["manual", "region", "x", 1]), confidence: anyNum() }, null, "manual"]) } : {}),
    boxes: r() < 0.9 ? Array.from({ length: Math.floor(r() * 6) }, box) : anyVal(),
  })
  const source = () => ({
    sourceId: pick<unknown>(["wide", "camA", "", 5]),
    ...(r() < 0.9 ? { clock: pick(["source", "source", "master"]) } : {}),
    frame: r() < 0.8 ? { w: anyNum(), h: anyNum() } : anyVal(),
    sampledSpans: r() < 0.9 ? Array.from({ length: Math.floor(r() * 4) }, () => ({ startMs: anyNum(), endMs: anyNum() })) : anyVal(),
    tracks: r() < 0.9 ? Array.from({ length: Math.floor(r() * 4) }, track) : anyVal(),
    ...(r() < 0.5 ? { cuts: Array.from({ length: Math.floor(r() * 3) }, anyVal) } : {}),
  })
  if (r() < 0.05) return anyVal()
  return {
    version: pick<unknown>([1, 1, 2, "1"]),
    sampleFps: anyNum(),
    detector: r() < 0.8 ? { id: "example:face-detector", version: anyVal() } : anyVal(),
    sources: r() < 0.9 ? Array.from({ length: Math.floor(r() * 3) }, source) : anyVal(),
  }
}

const round3 = (v: number): number => Math.round(v * 1000) / 1000

/** A well-formed set: every box inside a sampled span, strictly increasing,
 *  in-frame; tracks never straddle a cut. */
function validSet(r: () => number): SpeakerTrackSet {
  const sources = (["wide", "camA", "camB"] as const).slice(0, 1 + Math.floor(r() * 3)).map((sourceId) => {
    const spanStart = Math.floor(r() * 5000)
    const spanEnd = spanStart + 2000 + Math.floor(r() * 20000)
    const tracks = Array.from({ length: Math.floor(r() * 3) }, (_, k) => {
      const boxes: { ms: number; x: number; y: number; w: number; h: number; score?: number }[] = []
      let ms = spanStart + Math.floor(r() * 500)
      while (ms < spanEnd && boxes.length < 12) {
        // Rounded, with slack to the frame edge, so a well-formed box never
        // meets the normalizer's fit by a float ulp.
        const w = round3(0.05 + r() * 0.3)
        const h = round3(0.05 + r() * 0.3)
        boxes.push({ ms, x: round3(r() * (1 - w - 0.01)), y: round3(r() * (1 - h - 0.01)), w, h, ...(r() < 0.5 ? { score: round3(r()) } : {}) })
        ms += 500
      }
      return { id: `${sourceId}/t${k + 1}`, ...(r() < 0.5 ? { speaker: "Host" } : {}), boxes }
    })
    return {
      sourceId,
      clock: "source" as const,
      frame: { w: 1920, h: 1080 },
      sampledSpans: [{ startMs: spanStart, endMs: spanEnd }],
      tracks,
    }
  })
  return { version: 1, sampleFps: 2, detector: { id: "example:face-detector" }, sources }
}

const PROPERTY_RUNS = 300

// ─────────────────────────────────────────────────────────────────────────
//  The shared fixtures
// ─────────────────────────────────────────────────────────────────────────
describe("speaker-tracks fixtures (plain data any implementation must agree on)", () => {
  for (const f of FIXTURES.cases) {
    it(f.name, () => {
      const n = normalizeSpeakerTracks(f.input)
      if (f.normalized !== undefined) expect(n).toEqual(f.normalized)
      const v = validateSpeakerTracks(f.validateInput ? (f.input as SpeakerTrackSet) : n, { edl: fixtureEdl(f) })
      expect(v.issues).toEqual(f.validation.issues)
      expect(v.warnings).toEqual(f.validation.warnings)
      expect(v.ok).toBe(f.validation.ok)
    })
  }

  it("every fixture's normalized form survives a JSON round trip unchanged", () => {
    for (const f of FIXTURES.cases) {
      const n = normalizeSpeakerTracks(f.input)
      expect(JSON.parse(JSON.stringify(n))).toEqual(n)
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────
//  Properties
// ─────────────────────────────────────────────────────────────────────────
describe("normalizeSpeakerTracks — properties", () => {
  it("never throws, and is idempotent, on arbitrary input", () => {
    for (let seed = 1; seed <= PROPERTY_RUNS; seed++) {
      const input = garbageSet(rng(seed))
      const once = normalizeSpeakerTracks(input)
      expect(normalizeSpeakerTracks(once), `seed ${seed}`).toEqual(once)
      expect(normalizeSpeakerTracks(JSON.parse(JSON.stringify(once))), `seed ${seed}`).toEqual(once)
      expect(() => validateSpeakerTracks(once), `seed ${seed}`).not.toThrow()
    }
  })

  it("cropped, never moved: a box keeps its exact geometry when in frame, and otherwise becomes its visible part", () => {
    const fit = (b: { x: number; y: number; w: number; h: number }) =>
      normalizeSpeakerTracks({
        version: 1, sampleFps: 2, detector: { id: "d" },
        sources: [{ sourceId: "wide", clock: "source", frame: { w: 1920, h: 1080 }, sampledSpans: [{ startMs: 0, endMs: 1000 }], tracks: [{ id: "t", boxes: [{ ms: 0, ...b }] }] }],
      }).sources[0].tracks[0].boxes[0]
    // A left or top overhang is cropped exactly like a right or bottom one.
    expect(fit({ x: -0.1, y: 0.2, w: 0.3, h: 0.2 })).toEqual({ ms: 0, x: 0, y: 0.2, w: -0.1 + 0.3, h: 0.2 })
    expect(fit({ x: 0.2, y: -0.1, w: 0.2, h: 0.3 })).toEqual({ ms: 0, x: 0.2, y: 0, w: 0.2, h: -0.1 + 0.3 })
    expect(fit({ x: 0.8, y: 0.2, w: 0.3, h: 0.2 })).toEqual({ ms: 0, x: 0.8, y: 0.2, w: 1 - 0.8, h: 0.2 })
    // A box entirely outside the frame is no face in it.
    expect(fit({ x: 0.2, y: -0.5, w: 0.2, h: 0.4 })).toBeUndefined()
    expect(fit({ x: 1.2, y: 0.2, w: 0.2, h: 0.2 })).toBeUndefined()
    expect(fit({ x: -0.3, y: 0.2, w: 0.3, h: 0.2 })).toBeUndefined()

    const axis = (p: number, s: number, op: number, os: number, seed: number) => {
      const lo = Math.max(p, 0)
      const hi = Math.min(p + s, 1)
      expect(op, `seed ${seed}`).toBeCloseTo(lo, 12)
      expect(op + os, `seed ${seed}`).toBeCloseTo(hi, 12)
      // The centre moves only when the box was clipped, and only toward the visible part.
      const c = p + s / 2
      const oc = op + os / 2
      if (p >= 0 && p + s <= 1) expect(oc, `seed ${seed}`).toBe(c)
      else if (p < 0 && p + s <= 1) expect(oc, `seed ${seed}`).toBeGreaterThan(c)
      else if (p >= 0 && p + s > 1) expect(oc, `seed ${seed}`).toBeLessThan(c)
    }
    for (let seed = 1; seed <= PROPERTY_RUNS * 10; seed++) {
      const r = rng(seed)
      const raw = { x: round3(r() * 1.6 - 0.4), y: round3(r() * 1.6 - 0.4), w: round3(0.01 + r() * 0.6), h: round3(0.01 + r() * 0.6) }
      const out = fit(raw)
      const visible = raw.x < 1 && raw.x + raw.w > 0 && raw.y < 1 && raw.y + raw.h > 0
      if (!visible) {
        expect(out, `seed ${seed}`).toBeUndefined()
        continue
      }
      expect(out, `seed ${seed}`).toBeDefined()
      const inFrame = raw.x >= 0 && raw.x + raw.w <= 1 && raw.y >= 0 && raw.y + raw.h <= 1
      if (inFrame) expect(out, `seed ${seed}`).toEqual({ ms: 0, ...raw })
      axis(raw.x, raw.w, out!.x, out!.w, seed)
      axis(raw.y, raw.h, out!.y, out!.h, seed)
    }
  })

  it("monotonic: every track's boxes come out sorted by time", () => {
    for (let seed = 1; seed <= PROPERTY_RUNS; seed++) {
      for (const s of normalizeSpeakerTracks(garbageSet(rng(seed))).sources) {
        for (const t of s.tracks) {
          for (let i = 1; i < t.boxes.length; i++) expect(t.boxes[i].ms, `seed ${seed}`).toBeGreaterThanOrEqual(t.boxes[i - 1].ms)
        }
      }
    }
  })

  it("clamped: every box is a finite in-frame region and every score/confidence is 0..1", () => {
    for (let seed = 1; seed <= PROPERTY_RUNS; seed++) {
      for (const s of normalizeSpeakerTracks(garbageSet(rng(seed))).sources) {
        for (const t of s.tracks) {
          if (t.attribution) expect(t.attribution.confidence >= 0 && t.attribution.confidence <= 1, `seed ${seed}`).toBe(true)
          for (const b of t.boxes) {
            for (const v of [b.x, b.y, b.w, b.h]) expect(Number.isFinite(v) && v >= 0 && v <= 1, `seed ${seed}`).toBe(true)
            expect(b.w > 0 && b.h > 0, `seed ${seed}`).toBe(true)
            expect(b.x + b.w <= 1 + 1e-9 && b.y + b.h <= 1 + 1e-9, `seed ${seed}`).toBe(true)
            if (b.score !== undefined) expect(b.score >= 0 && b.score <= 1, `seed ${seed}`).toBe(true)
          }
        }
      }
    }
  })

  it("ms-only: every time is an integer and is never rescaled (no seconds→ms guessing)", () => {
    for (let seed = 1; seed <= PROPERTY_RUNS; seed++) {
      const n = normalizeSpeakerTracks(garbageSet(rng(seed)))
      for (const s of n.sources) {
        for (const sp of s.sampledSpans) expect(Number.isInteger(sp.startMs) && Number.isInteger(sp.endMs), `seed ${seed}`).toBe(true)
        for (const c of s.cuts ?? []) expect(Number.isInteger(c), `seed ${seed}`).toBe(true)
        for (const t of s.tracks) for (const b of t.boxes) expect(Number.isInteger(b.ms), `seed ${seed}`).toBe(true)
      }
    }
    // A set written in seconds stays in seconds (and then fails validation
    // against its spans) — it is never multiplied by 1000.
    const secs = normalizeSpeakerTracks({
      version: 1, sampleFps: 2, detector: { id: "d" },
      sources: [{ sourceId: "wide", clock: "source", frame: { w: 1920, h: 1080 }, sampledSpans: [{ startMs: 0, endMs: 60 }], tracks: [{ id: "t", boxes: [{ ms: 12, x: 0.1, y: 0.1, w: 0.2, h: 0.2 }] }] }],
    })
    expect(secs.sources[0].tracks[0].boxes[0].ms).toBe(12)
    expect(secs.sources[0].sampledSpans[0]).toEqual({ startMs: 0, endMs: 60 })
  })

  it("sampled spans come out sorted, positive and non-overlapping; cuts sorted and unique", () => {
    for (let seed = 1; seed <= PROPERTY_RUNS; seed++) {
      for (const s of normalizeSpeakerTracks(garbageSet(rng(seed))).sources) {
        s.sampledSpans.forEach((sp, i) => {
          expect(sp.endMs, `seed ${seed}`).toBeGreaterThan(sp.startMs)
          if (i > 0) expect(sp.startMs, `seed ${seed}`).toBeGreaterThan(s.sampledSpans[i - 1].endMs)
        })
        const cuts = s.cuts ?? []
        for (let i = 1; i < cuts.length; i++) expect(cuts[i], `seed ${seed}`).toBeGreaterThan(cuts[i - 1])
      }
    }
  })

  it("a generated well-formed set normalizes to itself and validates clean", () => {
    for (let seed = 1; seed <= PROPERTY_RUNS; seed++) {
      const set = validSet(rng(seed))
      const n = normalizeSpeakerTracks(set)
      expect(n, `seed ${seed}`).toEqual(set)
      const v = validateSpeakerTracks(n)
      expect(v.issues, `seed ${seed}`).toEqual([])
    }
  })
})

describe("offset mapping (D19: masterMs = sourceMs + offsetMs) — boxes stay on the source clock", () => {
  it("a box on a source with a ± offset lands at sourceMs + offsetMs on the master clock, and nowhere when that instant was dropped", () => {
    for (let seed = 1; seed <= PROPERTY_RUNS; seed++) {
      const r = rng(seed)
      const offsetMs = Math.round((r() * 2 - 1) * 10000) // − and + offsets
      const inMs = 20000 + Math.floor(r() * 5000)
      const outMs = inMs + 3000 + Math.floor(r() * 5000)
      const edl: Edl = normalizeEdl({
        version: 1,
        clock: "master",
        sources: [{ id: "cam", url: "https://media.example/cam.mp4", kind: "video", offsetMs }],
        segments: [{ id: "s", inMs, outMs, video: "cam", speaker: "Host" }],
      })
      // The producer samples the source-clock span that the segment keeps.
      const spanStart = inMs - offsetMs
      const spanEnd = outMs - offsetMs
      const boxMs = spanStart + Math.floor(r() * (spanEnd - spanStart))
      const set = normalizeSpeakerTracks({
        version: 1, sampleFps: 2, detector: { id: "d" },
        sources: [{ sourceId: "cam", clock: "source", frame: { w: 1920, h: 1080 }, sampledSpans: [{ startMs: spanStart, endMs: spanEnd }],
          tracks: [{ id: "cam/t1", speaker: "Host", boxes: [{ ms: boxMs, x: 0.1, y: 0.1, w: 0.2, h: 0.2 }] }] }],
      })
      const v = validateSpeakerTracks(set, { edl })
      expect(v.issues, `seed ${seed}`).toEqual([])
      // Normalize never applies the offset itself: the box keeps its source ms.
      expect(set.sources[0].tracks[0].boxes[0].ms, `seed ${seed}`).toBe(boxMs)
      expect(remapMsThroughEdl(edl, boxMs, "cam"), `seed ${seed}`).toBe(boxMs + offsetMs - inMs)
      // One ms before the kept span on the source clock is a dropped instant.
      expect(remapMsThroughEdl(edl, spanStart - 1, "cam"), `seed ${seed}`).toBeNull()
    }
  })
})

// ─────────────────────────────────────────────────────────────────────────
//  Size caps
// ─────────────────────────────────────────────────────────────────────────
describe("validateSpeakerTracks — the hard size cap", () => {
  const big = (boxes: number): SpeakerTrackSet => ({
    version: 1,
    sampleFps: 2,
    detector: { id: "d" },
    sources: [{
      sourceId: "wide",
      clock: "source",
      frame: { w: 1920, h: 1080 },
      sampledSpans: [{ startMs: 0, endMs: boxes * 500 + 1 }],
      tracks: [{ id: "wide/t1", boxes: Array.from({ length: boxes }, (_, i) => ({ ms: i * 500, x: 0.1, y: 0.1, w: 0.2, h: 0.2 })) }],
    }],
  })

  it("exports the default caps as named constants", () => {
    expect(SPEAKER_TRACKS_MAX_BOXES_PER_SOURCE).toBeGreaterThan(0)
    expect(SPEAKER_TRACKS_MAX_BYTES).toBeGreaterThan(0)
    // The 180-minute ceiling at 2 samples per second with several faces in frame fits under the per-source cap.
    expect(SPEAKER_TRACKS_MAX_BOXES_PER_SOURCE).toBeGreaterThanOrEqual(180 * 60 * 2 * 3)
  })

  it("refuses a source with more boxes than the cap", () => {
    const v = validateSpeakerTracks(big(11), { maxBoxesPerSource: 10 })
    expect(v.ok).toBe(false)
    expect(v.issues).toEqual(['source "wide": 11 boxes is over the cap of 10'])
    expect(validateSpeakerTracks(big(10), { maxBoxesPerSource: 10 }).ok).toBe(true)
  })

  it("bounds the per-box findings: a systematic producer bug yields a short refusal, not one line per box", () => {
    // A clock bug puts every box outside the sampled spans.
    const set = big(50_000)
    const shifted: SpeakerTrackSet = {
      ...set,
      sources: set.sources.map((s) => ({ ...s, sampledSpans: [{ startMs: 100_000_000, endMs: 100_000_001 }] })),
    }
    const v = validateSpeakerTracks(shifted)
    expect(v.ok).toBe(false)
    expect(v.issues.length).toBeLessThanOrEqual(10)
    expect(v.issues.slice(0, 5)).toEqual([0, 1, 2, 3, 4].map((j) => `track "wide/t1" box[${j}]: ms ${j * 500} is outside every sampled span of source "wide"`))
    expect(v.issues[5]).toBe('track "wide/t1": 49995 more boxes outside every sampled span of source "wide"')
    expect(v.issues).toHaveLength(6)
  })

  it("bounds the whole issue list: many tracks with one bad box each still yield a bounded refusal", () => {
    const tracks = Array.from({ length: 5000 }, (_, i) => ({ id: `wide/t${i}`, boxes: [{ ms: 999_999, x: 0.1, y: 0.1, w: 0.2, h: 0.2 }] }))
    const set: SpeakerTrackSet = {
      version: 1, sampleFps: 2, detector: { id: "d" },
      sources: [{ sourceId: "wide", clock: "source", frame: { w: 1920, h: 1080 }, sampledSpans: [{ startMs: 0, endMs: 1000 }], tracks }],
    }
    const v = validateSpeakerTracks(set)
    expect(v.ok).toBe(false)
    expect(v.issues.length).toBeLessThanOrEqual(101)
    expect(v.issues[0]).toBe('track "wide/t0" box[0]: ms 999999 is outside every sampled span of source "wide"')
    expect(v.issues[v.issues.length - 1]).toMatch(/^\d+ more issues not listed$/)
    const listed = v.issues.length - 1
    expect(v.issues[v.issues.length - 1]).toBe(`${5000 - listed} more issues not listed`)
  })

  it("refuses a set whose serialized size is over the byte cap (measured, or as given by the caller)", () => {
    const set = big(20)
    const bytes = new TextEncoder().encode(JSON.stringify(set)).length
    expect(validateSpeakerTracks(set, { maxBytes: bytes }).ok).toBe(true)
    expect(validateSpeakerTracks(set, { maxBytes: bytes - 1 }).issues).toEqual([`the track set is ${bytes} bytes, over the cap of ${bytes - 1}`])
    // A caller that already knows the fetched body's length passes it and skips the re-serialization.
    expect(validateSpeakerTracks(set, { maxBytes: 100, serializedBytes: 99 }).ok).toBe(true)
    expect(validateSpeakerTracks(set, { maxBytes: 100, serializedBytes: 101 }).ok).toBe(false)
  })
})

// ─────────────────────────────────────────────────────────────────────────
//  The descriptor (the node's json; the boxes live in the R2 artifact)
// ─────────────────────────────────────────────────────────────────────────
const SHA = "a".repeat(64)

describe("describeSpeakerTracks — the descriptor projection", () => {
  it("drops every box, keeps every id, speaker, attribution and span, and counts the boxes", () => {
    for (let seed = 1; seed <= PROPERTY_RUNS; seed++) {
      const set = validSet(rng(seed))
      const d = describeSpeakerTracks(set, { url: "https://media.example/tracks.json", sha256: SHA, bytes: 1234 })
      expect(JSON.stringify(d), `seed ${seed}`).not.toContain('"boxes"')
      expect(d.version).toBe(SPEAKER_TRACKS_VERSION)
      expect(d.sampleFps).toBe(set.sampleFps)
      expect(d.url).toBe("https://media.example/tracks.json")
      expect(d.sources.map((s) => s.sourceId)).toEqual(set.sources.map((s) => s.sourceId))
      set.sources.forEach((s, i) => {
        expect(d.sources[i].sampledSpans).toEqual(s.sampledSpans)
        expect(d.sources[i].frame).toEqual(s.frame)
        expect(d.sources[i].tracks.map((t) => [t.id, t.speaker, t.boxCount])).toEqual(s.tracks.map((t) => [t.id, t.speaker, t.boxes.length]))
      })
      expect(normalizeSpeakerTrackSetDescriptor(d), `seed ${seed}`).toEqual(d)
      expect(validateSpeakerTrackSetDescriptor(d).issues, `seed ${seed}`).toEqual([])
    }
  })

  it("the body a descriptor names is the one whose projection equals it", () => {
    const set = normalizeSpeakerTracks(FIXTURES.cases[0].input)
    const d = describeSpeakerTracks(set, { url: "https://media.example/t.json", sha256: SHA, bytes: 10 })
    expect(describeSpeakerTracks(set, { url: d.url, sha256: d.sha256, bytes: d.bytes })).toEqual(d)
  })
})

describe("validateSpeakerTrackSetDescriptor", () => {
  const base = () => describeSpeakerTracks(normalizeSpeakerTracks(FIXTURES.cases[0].input), { url: "https://media.example/t.json", sha256: SHA, bytes: 4096 })
  const twoHost = normalizeEdl(FIXTURES.edls.twoHost)

  it("accepts a well-formed descriptor against its EDL", () => {
    expect(validateSpeakerTrackSetDescriptor(base(), { edl: twoHost })).toEqual({ ok: true, issues: [], warnings: [] })
  })

  it("refuses an empty url, a malformed hash and a non-positive or over-cap byte count", () => {
    const d = normalizeSpeakerTrackSetDescriptor({ ...base(), url: " ", sha256: "ABC", bytes: 0 })
    expect(validateSpeakerTrackSetDescriptor(d).issues).toEqual([
      "url is empty",
      "sha256 must be 64 lowercase hex characters",
      "bytes must be a positive integer",
    ])
    const over = normalizeSpeakerTrackSetDescriptor({ ...base(), bytes: 5000 })
    expect(validateSpeakerTrackSetDescriptor(over, { maxBytes: 4999 }).issues).toEqual(["the track set is 5000 bytes, over the cap of 4999"])
  })

  it("applies the same structural, EDL and name-space rules as the body", () => {
    const raw = describeSpeakerTracks(normalizeSpeakerTracks(FIXTURES.cases[3].input), { url: "u", sha256: SHA, bytes: 1 })
    const v = validateSpeakerTrackSetDescriptor(raw, { edl: twoHost })
    expect(v.issues).toEqual(validateSpeakerTracks(normalizeSpeakerTracks(FIXTURES.cases[3].input), { edl: twoHost }).issues)
    expect(v.ok).toBe(false)
  })

  it("refuses a box count over the per-source cap", () => {
    const d = base()
    expect(validateSpeakerTrackSetDescriptor(d, { maxBoxesPerSource: 1 }).issues).toEqual(['source "wide": 4 boxes is over the cap of 1'])
  })

  it("normalizes a missing or broken boxCount to 0 and never throws on garbage", () => {
    const d = normalizeSpeakerTrackSetDescriptor({ ...base(), sources: [{ sourceId: "wide", clock: "source", frame: { w: 1, h: 1 }, sampledSpans: [], tracks: [{ id: "t", boxCount: -3.5 }, { id: "u" }] }] })
    expect(d.sources[0].tracks.map((t) => t.boxCount)).toEqual([0, 0])
    for (let seed = 1; seed <= PROPERTY_RUNS; seed++) {
      const g = garbageSet(rng(seed))
      const n = normalizeSpeakerTrackSetDescriptor(g)
      expect(normalizeSpeakerTrackSetDescriptor(n), `seed ${seed}`).toEqual(n)
      expect(() => validateSpeakerTrackSetDescriptor(n), `seed ${seed}`).not.toThrow()
    }
  })
})

describe("edlSpeakerSpace — the speakers an edit uses", () => {
  it("is the sorted union of source speakers, segment speakers and slot speakers, across a clip pack", () => {
    expect(edlSpeakerSpace(normalizeEdl(FIXTURES.edls.twoHost))).toEqual(["Guest", "Host"])
    expect(edlSpeakerSpace(normalizeEdl(FIXTURES.edls.rawLabels))).toEqual(["SPEAKER_00", "SPEAKER_01"])
    expect(edlSpeakerSpace([normalizeEdl(FIXTURES.edls.clipOne), normalizeEdl(FIXTURES.edls.clipTwo)])).toEqual(["Guest", "Host"])
  })

  it("an edit with no speakers has nothing to mismatch: attributed tracks pass", () => {
    const edl = normalizeEdl({ version: 1, clock: "master", sources: [{ id: "wide", url: "u", kind: "video" }], segments: [{ id: "s", inMs: 0, outMs: 1000, video: "wide" }] })
    expect(edlSpeakerSpace(edl)).toEqual([])
    const set = normalizeSpeakerTracks(FIXTURES.cases[3].input)
    expect(validateSpeakerTracks(set, { edl }).ok).toBe(true)
  })
})

describe("public surface", () => {
  it("is exported from the package root", () => {
    expect(shared.normalizeSpeakerTracks).toBe(normalizeSpeakerTracks)
    expect(shared.validateSpeakerTracks).toBe(validateSpeakerTracks)
    expect(shared.describeSpeakerTracks).toBe(describeSpeakerTracks)
    expect(shared.SPEAKER_TRACK_ATTRIBUTION_METHODS).toEqual(["source-map", "region", "mouth-motion", "manual"])
    expect(SPEAKER_TRACK_ATTRIBUTION_METHODS).toBe(shared.SPEAKER_TRACK_ATTRIBUTION_METHODS)
  })
})
