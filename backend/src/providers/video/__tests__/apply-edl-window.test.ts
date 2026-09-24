// A segment must exist on the media it reads. Ingress refuses a segment that
// starts before its source's origin; only the downloaded file can say whether
// one runs PAST the end of the track it reads, so the executor checks that
// after download — per TRACK (the picture source's video track for a video
// render, the sound source's audio track always; a file whose tracks differ in
// length is two lengths, not one) — and FAILS naming the segment, the source
// and the track, never clamps. The failure is a DeterministicJobError: the
// same inputs fail the same way, so the worker fails + refunds now instead of
// re-downloading everything for two more attempts. A track present but
// unmeasurable is skipped and REPORTED, so the caller logs it. Pure rule,
// measured ends injected: no ffprobe here.
import { describe, it, expect } from "vitest"
import type { Edl } from "@nodaro/shared"
import { assertSegmentsWithinSources, SOURCE_END_TOLERANCE_SEC, DECLARED_END_TOLERANCE_SEC } from "../apply-edl.js"
import type { StreamEnds, TrackEnd } from "../ffmpeg-utils.js"
import { isDeterministicJobError } from "../../../lib/deterministic-job-error.js"

const A = { id: "A", url: "https://f.test/a.mp4", kind: "video" as const }
const B = { id: "B", url: "https://f.test/b.mp4", kind: "video" as const }
const MIC = { id: "MIC", url: "https://f.test/mic.m4a", kind: "audio" as const, role: "master-audio" as const }

const edl = (sources: Edl["sources"], segments: Array<Record<string, unknown>>): Edl =>
  ({ version: 1, clock: "master", sources, segments }) as unknown as Edl

const m = (endSec: number): TrackEnd => ({ state: "measured", endSec })
const ABSENT: TrackEnd = { state: "absent" }
const UNMEASURED: TrackEnd = { state: "unmeasured", reason: "stream 0 carries no packet timestamps" }
/** `{ A: 6 }` → both tracks measured 6 s; `{ A: { video: m(6), audio: ABSENT } }` → per track. */
const ends = (o: Record<string, number | Partial<StreamEnds>>): Map<string, StreamEnds> =>
  new Map(Object.entries(o).map(([id, v]) => [id, typeof v === "number"
    ? { video: m(v), audio: m(v) }
    : { video: v.video ?? ABSENT, audio: v.audio ?? ABSENT }]))
const master = (e: Edl) => e.sources.find((s) => s.role === "master-audio")?.id

const thrown = (fn: () => unknown): unknown => {
  try { fn() } catch (err) { return err }
  throw new Error("expected a throw")
}

describe("assertSegmentsWithinSources", () => {
  it("passes when every window fits the track it reads", () => {
    const e = edl([A, B], [{ id: "s0", inMs: 0, outMs: 6000, video: "A" }, { id: "s1", inMs: 1000, outMs: 5000, video: "B" }])
    expect(assertSegmentsWithinSources(e, master(e), true, ends({ A: 6, B: 6 }))).toEqual([])
  })

  it("fails naming the segment, the VIDEO source and its video track — as a DeterministicJobError (no retry)", () => {
    const e = edl([A], [{ id: "s0", inMs: 0, outMs: 9000, video: "A" }])
    const err = thrown(() => assertSegmentsWithinSources(e, master(e), true, ends({ A: 6 })))
    expect(String(err)).toMatch(/segment\[0\] "s0" ends at 9\.00s on source "A", but its video track is only 6\.00s long/)
    expect(isDeterministicJobError(err)).toBe(true)
  })

  it("checks the AUDIO source's audio track — the master-audio role, an explicit one, or the picture source by default", () => {
    const viaMaster = edl([A, MIC], [{ id: "s0", inMs: 0, outMs: 9000, video: "A" }])
    expect(() => assertSegmentsWithinSources(viaMaster, master(viaMaster), true, ends({ A: 12, MIC: { audio: m(6) } })))
      .toThrow(/source "MIC", but its audio track is only 6\.00s/)
    const explicit = edl([A, B], [{ id: "s0", inMs: 0, outMs: 9000, video: "A", audio: "B" }])
    expect(() => assertSegmentsWithinSources(explicit, master(explicit), true, ends({ A: 12, B: 6 })))
      .toThrow(/source "B", but its audio track/)
    const byDefault = edl([A], [{ id: "s0", inMs: 0, outMs: 9000, video: "A" }])
    expect(() => assertSegmentsWithinSources(byDefault, undefined, false, ends({ A: 6 })))
      .toThrow(/source "A", but its audio track/) // audio-only output: the picture source still supplies the sound
  })

  // A file is two tracks. The render's `trim` reads the picture track and
  // `atrim` the sound track; each is checked against its own end.
  it("a source whose picture is shorter than its sound: refused for a video render, fine for an audio-only cut", () => {
    const e = edl([A], [{ id: "s0", inMs: 0, outMs: 6000, video: "A" }])
    const shortPicture = ends({ A: { video: m(3), audio: m(6) } })
    expect(() => assertSegmentsWithinSources(e, undefined, true, shortPicture)).toThrow(/its video track is only 3\.00s/)
    expect(assertSegmentsWithinSources(e, undefined, false, shortPicture)).toEqual([])
  })

  it("a source whose sound is shorter than its picture: refused on the audio track — unless the sound comes from elsewhere", () => {
    const own = edl([A], [{ id: "s0", inMs: 0, outMs: 6000, video: "A" }])
    expect(() => assertSegmentsWithinSources(own, undefined, true, ends({ A: { video: m(6), audio: m(3) } })))
      .toThrow(/its audio track is only 3\.00s/)
    const mic = edl([A, MIC], [{ id: "s0", inMs: 0, outMs: 6000, video: "A" }])
    expect(assertSegmentsWithinSources(mic, master(mic), true, ends({ A: { video: m(6), audio: m(3) }, MIC: { audio: m(6) } }))).toEqual([])
  })

  it("an audio-only output does not read the picture source at all", () => {
    const e = edl([A, MIC], [{ id: "s0", inMs: 0, outMs: 9000, video: "A" }])
    // A is far too short for the picture, but audio-only never touches it.
    expect(assertSegmentsWithinSources(e, master(e), false, ends({ A: 1, MIC: { audio: m(12) } }))).toEqual([])
  })

  it("applies the source's offsetMs before comparing (masterMs = sourceMs + offsetMs)", () => {
    const late = { ...A, offsetMs: 5000 } // this camera started 5 s after the master clock
    const e = edl([late], [{ id: "s0", inMs: 5000, outMs: 11000, video: "A" }]) // 0–6 s of the file
    expect(assertSegmentsWithinSources(e, master(e), true, ends({ A: 6 }))).toEqual([])
    const over = edl([late], [{ id: "s0", inMs: 5000, outMs: 13000, video: "A" }]) // 0–8 s of a 6 s file
    expect(() => assertSegmentsWithinSources(over, master(over), true, ends({ A: 6 }))).toThrow(/ends at 8\.00s/)
  })

  it("tolerates a rounding overrun inside SOURCE_END_TOLERANCE_SEC, and refuses beyond it", () => {
    const within = edl([A], [{ id: "s0", inMs: 0, outMs: 6000 + SOURCE_END_TOLERANCE_SEC * 1000, video: "A" }])
    expect(assertSegmentsWithinSources(within, undefined, true, ends({ A: 6 }))).toEqual([])
    const beyond = edl([A], [{ id: "s0", inMs: 0, outMs: 6000 + SOURCE_END_TOLERANCE_SEC * 1000 + 10, video: "A" }])
    expect(() => assertSegmentsWithinSources(beyond, undefined, true, ends({ A: 6 }))).toThrow()
  })

  it("a picture source with NO video track (an audio file, or cover art only) is refused — a DeterministicJobError", () => {
    const e = edl([A], [{ id: "s0", inMs: 0, outMs: 1000, video: "A" }])
    const err = thrown(() => assertSegmentsWithinSources(e, undefined, true, ends({ A: { video: ABSENT, audio: m(30) } })))
    expect(String(err)).toMatch(/segment\[0\] "s0" takes its picture from source "A", but that source has no video track/)
    expect(isDeterministicJobError(err)).toBe(true)
  })

  it("a sound source with NO audio track is not a refusal — the render pads that segment with silence", () => {
    const e = edl([A], [{ id: "s0", inMs: 0, outMs: 6000, video: "A" }])
    expect(assertSegmentsWithinSources(e, undefined, true, ends({ A: { video: m(6), audio: ABSENT } }))).toEqual([])
  })

  it("a present-but-unmeasured track is skipped AND reported, so the caller logs every skipped check", () => {
    const e = edl([A], [{ id: "s0", inMs: 0, outMs: 90_000, video: "A" }])
    expect(assertSegmentsWithinSources(e, undefined, true, ends({ A: { video: UNMEASURED, audio: UNMEASURED } }))).toEqual([
      { segment: "s0", source: "A", track: "video", reason: "stream 0 carries no packet timestamps" },
      { segment: "s0", source: "A", track: "audio", reason: "stream 0 carries no packet timestamps" },
    ])
    // per track, not per file: the measured, short sound track still refuses
    expect(() => assertSegmentsWithinSources(e, undefined, true, ends({ A: { video: UNMEASURED, audio: m(6) } }))).toThrow(/audio track/)
  })

  // An MPEG-TS/PS file's per-track ends are not on the render's clock, but its
  // declared duration spans every stream — an upper bound that can only
  // OVER-state a track's end while its timestamps run forward (the probe
  // attaches it only then). Refusing past it (+ a wider tolerance) never fails
  // a correct edit, and stops an overrun rendering minutes of frozen picture
  // over silence (the source is held past its end).
  it("an MPEG-TS/PS track (unmeasured, with a declared bound) is refused past declared + tolerance, passes inside it", () => {
    const TS: TrackEnd = { state: "unmeasured", reason: "MPEG-TS/PS container re-anchors timestamps; not on the render's clock", declaredEndSec: 60 }
    const at = (outMs: number) => edl([A], [{ id: "s0", inMs: 0, outMs, video: "A" }])
    const tsEnds = ends({ A: { video: TS, audio: TS } })
    expect(assertSegmentsWithinSources(at((60 + DECLARED_END_TOLERANCE_SEC) * 1000 - 1), undefined, true, tsEnds)).toEqual([])
    const err = thrown(() => assertSegmentsWithinSources(at(90_000), undefined, true, tsEnds))
    expect(isDeterministicJobError(err)).toBe(true)
    expect(String(err)).toMatch(/segment\[0\] "s0" ends at 90\.00s on source "A", but that file declares only 60\.00s/)
    expect(DECLARED_END_TOLERANCE_SEC).toBeGreaterThan(SOURCE_END_TOLERANCE_SEC)
  })

  it("an unmeasured track with NO declared bound (a failed scan) is still skipped and reported — never refused on a guess", () => {
    const e = edl([A], [{ id: "s0", inMs: 0, outMs: 90_000, video: "A" }])
    expect(assertSegmentsWithinSources(e, undefined, true, ends({ A: { video: UNMEASURED, audio: ABSENT } }))).toHaveLength(1)
  })

  // Ingress already refuses a read before a source's origin; the executor must
  // too, never clamp it to the source's first frame (A1, found by B1).
  it("a read that starts before its source's origin is refused, naming the segment — never clamped", () => {
    const late = { ...A, offsetMs: 4000 }
    const at = (inMs: number) => edl([late], [{ id: "s0", inMs, outMs: inMs + 2000, video: "A" }])
    const err = thrown(() => assertSegmentsWithinSources(at(3000), undefined, true, ends({ A: { video: m(60), audio: m(60) } })))
    expect(isDeterministicJobError(err)).toBe(true)
    expect(String(err)).toMatch(/segment\[0\] "s0" starts at 3\.000s on the master clock, before source "A" begins \(its offsetMs is 4000\)/)
    expect(assertSegmentsWithinSources(at(4000), undefined, true, ends({ A: { video: m(60), audio: m(60) } }))).toEqual([])
  })

  it("the pre-origin refusal needs no probe data: a source whose probe failed, or whose sound track is absent, is refused too", () => {
    const late = { ...A, offsetMs: 4000 }
    const e = edl([late], [{ id: "s0", inMs: 3000, outMs: 5000, video: "A" }])
    // probe failed outright → no entry at all
    expect(() => assertSegmentsWithinSources(e, undefined, true, new Map())).toThrow(/starts at 3\.000s .* before source "A" begins/)
    // an audio-only cut from a source whose sound track is absent
    expect(() => assertSegmentsWithinSources(e, undefined, false, ends({ A: { video: m(60), audio: ABSENT } }))).toThrow(/before source "A" begins/)
  })

  it("a source with no entry at all (its probe failed outright; the caller already logged it) is skipped", () => {
    const e = edl([A], [{ id: "s0", inMs: 0, outMs: 90_000, video: "A" }])
    expect(assertSegmentsWithinSources(e, master(e), true, new Map())).toEqual([])
  })
})
