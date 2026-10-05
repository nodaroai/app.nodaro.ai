import { describe, it, expect } from "vitest"
import { normalizeEdl } from "@nodaro/shared"
import { buildEdited } from "../build-edited"
import { cutRange, keptSetOf, MANUAL_REASON } from "../kept-set"
import { canRestore, planIssues, restoreReason, restoreSpan, type ReviewRenderContext } from "../restore"
import { renderIssues } from "./review-fixtures"

const iv = (inMs: number, outMs: number) => ({ inMs, outMs })
const word = (text: string, startMs: number, endMs: number) => ({ text, startMs, endMs })
const VIDEO: ReviewRenderContext = { output: "video", crossfadeMs: 0, sources: [] }
const AUDIO: ReviewRenderContext = { ...VIDEO, output: "audio" }

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

// The smallest late camera: cam-b starts 700 ms into the master clock, and the
// plan dropped the time before its first segment. Restored, that time takes
// cam-b and reads before cam-b starts.
const lateCamera = normalizeEdl({
  version: 1,
  clock: "master",
  sources: [{ id: "cam-b", url: "https://cdn.test/cam-b.mp4", kind: "video", role: "camera", offsetMs: 700 }],
  segments: [{ id: "s0", inMs: 1000, outMs: 3000, video: "cam-b" }],
  dropped: [{ inMs: 0, outMs: 1000, reason: "no-picture" }],
})

describe("restoreSpan", () => {
  it("keeps the span's time again", () => {
    expect(restoreSpan(K0, plan, plan.dropped![0], VIDEO)).toEqual({ kept: [iv(0, 3000), iv(6000, 7000)] })
  })

  it("is idempotent and never mutates K", () => {
    const frozen = JSON.stringify(K0)
    const once = restoreSpan(K0, plan, plan.dropped![1], VIDEO).kept
    expect(restoreSpan(once, plan, plan.dropped![1], VIDEO)).toEqual({ kept: once })
    expect(JSON.stringify(K0)).toBe(frozen)
  })
})

describe("restoreReason", () => {
  it("restores every span of one reason, and a span restored keeps everything inside it", () => {
    // The silence sits inside the tangent: keeping the tangent's time keeps it too.
    expect(restoreReason(K0, plan, "tangent", VIDEO)).toEqual({ kept: [iv(0, 1000), iv(1300, 7000)], locked: [] })
  })

  it("restoring a span nested in another leaves the outer one cut around it", () => {
    expect(restoreReason(K0, plan, "silence", VIDEO).kept).toEqual([iv(0, 1000), iv(1300, 3000), iv(3500, 3800), iv(6000, 7000)])
  })

  it("an unknown reason, or one the plan does not use, changes nothing", () => {
    expect(restoreReason(K0, plan, "breath", VIDEO)).toEqual({ kept: K0, locked: [] })
    expect(restoreReason(K0, plan, "manual", VIDEO)).toEqual({ kept: K0, locked: [] })
  })

  it("is idempotent", () => {
    const once = restoreReason(K0, plan, "filler", VIDEO).kept
    expect(restoreReason(once, plan, "filler", VIDEO).kept).toEqual(once)
  })

  it("restoring manual undoes the reviewer's own cuts, and only those", () => {
    const cut = cutRange(K0, iv(1400, 1600), [word("the", 1400, 1600)])
    expect(cut).not.toEqual(K0)
    expect(restoreReason(cut, plan, "manual", VIDEO).kept).toEqual(K0)
    const both = restoreSpan(cut, plan, plan.dropped![0], VIDEO).kept
    expect(restoreReason(both, plan, "manual", VIDEO).kept).toEqual(restoreSpan(K0, plan, plan.dropped![0], VIDEO).kept)
  })
})

describe("the restore lock: a restore that adds a problem the plan did not already have is locked (decided 2026-10-05)", () => {
  it("restoring time before a late camera's first segment is locked: it would read before the camera starts", () => {
    expect(renderIssues(lateCamera)).toEqual([])
    // What the restore would build, and why the rule refuses it.
    expect(renderIssues(buildEdited(lateCamera, [iv(0, 3000)]))).toEqual([
      'segment[0] "s0@0": starts at 0ms on the master clock but source "cam-b" begins at 700ms (offsetMs) — the segment would read before the source starts',
    ])

    const verdict = canRestore(lateCamera, keptSetOf(lateCamera), lateCamera.dropped![0], VIDEO)
    expect(verdict).toMatchObject({ ok: false, reason: "reads-before-source" })

    const span = restoreSpan(keptSetOf(lateCamera), lateCamera, lateCamera.dropped![0], VIDEO)
    expect(span.kept).toEqual(keptSetOf(lateCamera))
    expect(span.lock?.reason).toBe("reads-before-source")

    const reason = restoreReason(keptSetOf(lateCamera), lateCamera, "no-picture", VIDEO)
    expect(reason.kept).toEqual(keptSetOf(lateCamera))
    expect(reason.locked).toEqual([{ span: iv(0, 1000), reason: "reads-before-source", issues: span.lock!.issues }])
    expect(renderIssues(buildEdited(lateCamera, reason.kept))).toEqual([])
  })

  it("the lock judges the render the review is for: an audio cut never reads the camera", () => {
    const withMic = normalizeEdl({
      ...lateCamera,
      sources: [...lateCamera.sources, { id: "mic", url: "https://cdn.test/mic.wav", kind: "audio", role: "master-audio" }],
    })
    expect(canRestore(withMic, keptSetOf(withMic), withMic.dropped![0], VIDEO)).toMatchObject({ ok: false, reason: "reads-before-source" })
    expect(canRestore(withMic, keptSetOf(withMic), withMic.dropped![0], AUDIO)).toEqual({ ok: true })
    expect(restoreReason(keptSetOf(withMic), withMic, "no-picture", AUDIO)).toEqual({ kept: [iv(0, 3000)], locked: [] })
  })

  it("a reason restores the spans that pass the lock and lists the others, in time order", () => {
    const twoSpans = normalizeEdl({
      ...lateCamera,
      segments: [...lateCamera.segments, { id: "s1", inMs: 4000, outMs: 5000, video: "cam-b" }],
      dropped: [...lateCamera.dropped!, { inMs: 3000, outMs: 4000, reason: "no-picture" }],
    })
    const { kept, locked } = restoreReason(keptSetOf(twoSpans), twoSpans, "no-picture", VIDEO)
    expect(kept).toEqual([iv(1000, 5000)])
    expect(locked.map((l) => [l.span, l.reason])).toEqual([[iv(0, 1000), "reads-before-source"]])
    expect(restoreReason(kept, twoSpans, "no-picture", VIDEO)).toEqual({ kept, locked })
  })

  it("a restore that takes the edit past the 180-minute cap is locked", () => {
    const min = 60_000
    const long = normalizeEdl({
      version: 1,
      clock: "master",
      sources: [{ id: "cam-a", url: "https://cdn.test/a.mp4", kind: "video" }],
      segments: [
        { id: "s0", inMs: 0, outMs: 90 * min, video: "cam-a" },
        { id: "s1", inMs: 93 * min, outMs: 182 * min, video: "cam-a" },
      ],
      dropped: [{ inMs: 90 * min, outMs: 93 * min, reason: "tangent" }],
    })
    expect(renderIssues(long)).toEqual([])
    const { kept, lock } = restoreSpan(keptSetOf(long), long, long.dropped![0], VIDEO)
    expect(kept).toEqual(keptSetOf(long))
    expect(lock?.reason).toBe("output-cap")
  })

  it("restoring time K already keeps changes nothing and is never locked", () => {
    expect(canRestore(lateCamera, keptSetOf(lateCamera), iv(1500, 2500), VIDEO)).toEqual({ ok: true })
    expect(restoreSpan(keptSetOf(lateCamera), lateCamera, iv(1500, 2500), VIDEO)).toEqual({ kept: keptSetOf(lateCamera) })
  })

  it("names the issue the restore brings, not one the edit already had", () => {
    // cam-a's region crop is refused before any restore; the restore adds a read before cam-b starts.
    const refused = normalizeEdl({
      ...lateCamera,
      sources: [{ id: "cam-a", url: "https://cdn.test/a.mp4", kind: "video", region: { x: 0, y: 0, w: 0.5, h: 0.5 } }, ...lateCamera.sources],
    })
    expect(renderIssues(refused)).toHaveLength(1)
    expect(canRestore(refused, keptSetOf(refused), refused.dropped![0], VIDEO)).toMatchObject({ ok: false, reason: "reads-before-source" })
  })

  it("names the issue the restore brings when the segment it extends already had one, renamed by the restore", () => {
    // s0's region crop is refused before any restore. Restoring the time before
    // s0 renames it ("s0" becomes "s0@0"), so the old issue comes back under new
    // text; what the restore adds is the read before cam-b starts.
    const refused = normalizeEdl({
      ...lateCamera,
      segments: [{ ...lateCamera.segments[0], region: { x: 0, y: 0, w: 0.5, h: 0.5 } }],
    })
    expect(renderIssues(refused).map((m) => m.includes("region"))).toEqual([true])
    const verdict = canRestore(refused, keptSetOf(refused), refused.dropped![0], VIDEO)
    expect(verdict).toMatchObject({ ok: false, reason: "reads-before-source" })
  })

  it("on a plan the rule already refuses, a restore that adds no problem the plan lacks is allowed (decided 2026-10-05)", () => {
    const refused = normalizeEdl({
      version: 1,
      clock: "master",
      sources: [{ id: "cam-a", url: "https://cdn.test/a.mp4", kind: "video", region: { x: 0, y: 0, w: 0.5, h: 0.5 } }],
      segments: [
        { id: "s0", inMs: 0, outMs: 1000, video: "cam-a" },
        { id: "s1", inMs: 2000, outMs: 3000, video: "cam-a" },
      ],
      dropped: [{ inMs: 1000, outMs: 2000, reason: "filler" }],
    })
    // The plan's own refusal is review state of its own, not a lock.
    expect(planIssues(refused, VIDEO).map((issue) => issue.code)).toEqual(["region"])
    expect(planIssues(lateCamera, VIDEO)).toEqual([])
    expect(canRestore(refused, keptSetOf(refused), refused.dropped![0], VIDEO)).toEqual({ ok: true })
    expect(restoreSpan(keptSetOf(refused), refused, refused.dropped![0], VIDEO)).toEqual({ kept: [iv(0, 3000)] })
    expect(restoreReason(keptSetOf(refused), refused, "filler", VIDEO)).toEqual({ kept: [iv(0, 3000)], locked: [] })
    // A cut is never locked.
    expect(cutRange(keptSetOf(refused), iv(0, 500), [word("So", 0, 500)])).toEqual([iv(500, 1000), iv(2000, 3000)])
  })

  it("on a plan the rule refuses, the reviewer can undo a cut that had made the edit renderable", () => {
    // s0 starts at 500 ms, before cam-b does (700 ms): the plan reads before its source.
    const early = normalizeEdl({
      version: 1,
      clock: "master",
      sources: [{ id: "cam-b", url: "https://cdn.test/cam-b.mp4", kind: "video", role: "camera", offsetMs: 700 }],
      segments: [{ id: "s0", inMs: 500, outMs: 3000, video: "cam-b" }],
      dropped: [{ inMs: 0, outMs: 500, reason: "no-picture" }],
    })
    expect(planIssues(early, VIDEO).map((issue) => issue.code)).toEqual(["reads-before-source"])
    const cut = cutRange(keptSetOf(early), iv(500, 700), [word("um", 500, 700)])
    expect(cut).toEqual([iv(700, 3000)])
    expect(renderIssues(buildEdited(early, cut))).toEqual([])
    expect(restoreSpan(cut, early, iv(500, 700), VIDEO)).toEqual({ kept: keptSetOf(early) })
    expect(restoreReason(cut, early, MANUAL_REASON, VIDEO)).toEqual({ kept: keptSetOf(early), locked: [] })
  })

  it("on a plan the rule refuses, undoing one of the reviewer's cuts is allowed however many pieces the cuts left", () => {
    // Both segments are cropped: the plan fails "region" once per segment. The
    // reviewer cut all of s0 and the middle of s1, which leaves two cropped
    // pieces. Restoring s0 brings a third cropped segment: more of a problem the
    // plan already has, not a new one.
    const cropped = { x: 0, y: 0, w: 0.5, h: 0.5 }
    const twoCropped = normalizeEdl({
      version: 1,
      clock: "master",
      sources: [{ id: "cam-a", url: "https://cdn.test/a.mp4", kind: "video" }],
      segments: [
        { id: "s0", inMs: 0, outMs: 1000, video: "cam-a", region: cropped },
        { id: "s1", inMs: 2000, outMs: 3000, video: "cam-a", region: cropped },
      ],
      dropped: [{ inMs: 1000, outMs: 2000, reason: "filler" }],
    })
    expect(planIssues(twoCropped, VIDEO).map((issue) => issue.code)).toEqual(["region", "region"])
    const noS0 = cutRange(keptSetOf(twoCropped), iv(0, 1000), [word("all", 0, 1000)])
    const cut = cutRange(noS0, iv(2400, 2600), [word("the", 2400, 2600)])
    expect(cut).toEqual([iv(2000, 2400), iv(2600, 3000)])
    expect(restoreSpan(cut, twoCropped, iv(0, 1000), VIDEO)).toEqual({ kept: [iv(0, 1000), iv(2000, 2400), iv(2600, 3000)] })
    expect(restoreReason(cut, twoCropped, MANUAL_REASON, VIDEO)).toEqual({ kept: keptSetOf(twoCropped), locked: [] })
  })

  it("on a plan where one camera reads too early, a restore that makes a second camera read too early is locked (per source, decided 2026-10-05)", () => {
    // cam-x (700 ms) leads and starts after its offset; the plan dropped the
    // time before it. cam-y (2500 ms) already reads too early in the plan: s1
    // starts at 2000 ms. Restoring the time before s0 gives it cam-x's look, a
    // read of cam-x before it starts: the same check the plan fails, on another
    // source, so a new problem.
    const twoCameras = normalizeEdl({
      version: 1,
      clock: "master",
      sources: [
        { id: "cam-x", url: "https://cdn.test/x.mp4", kind: "video", role: "camera", offsetMs: 700 },
        { id: "cam-y", url: "https://cdn.test/y.mp4", kind: "video", role: "camera", offsetMs: 2500 },
      ],
      segments: [
        { id: "s0", inMs: 1000, outMs: 2000, video: "cam-x" },
        { id: "s1", inMs: 2000, outMs: 3000, video: "cam-y" },
      ],
      dropped: [{ inMs: 0, outMs: 1000, reason: "no-picture" }],
    })
    expect(planIssues(twoCameras, VIDEO)).toEqual([expect.objectContaining({ code: "reads-before-source", sourceId: "cam-y" })])
    expect(renderIssues(buildEdited(twoCameras, [iv(0, 3000)]))).toEqual([
      'segment[0] "s0@0": starts at 0ms on the master clock but source "cam-x" begins at 700ms (offsetMs) — the segment would read before the source starts',
      'segment[1] "s1": starts at 2000ms on the master clock but source "cam-y" begins at 2500ms (offsetMs) — the segment would read before the source starts',
    ])

    expect(canRestore(twoCameras, keptSetOf(twoCameras), twoCameras.dropped![0], VIDEO)).toMatchObject({ ok: false, reason: "reads-before-source" })
    expect(restoreSpan(keptSetOf(twoCameras), twoCameras, twoCameras.dropped![0], VIDEO).kept).toEqual(keptSetOf(twoCameras))
    const reason = restoreReason(keptSetOf(twoCameras), twoCameras, "no-picture", VIDEO)
    expect(reason.kept).toEqual(keptSetOf(twoCameras))
    expect(reason.locked.map((l) => [l.span, l.reason])).toEqual([[iv(0, 1000), "reads-before-source"]])

    // The reviewer's own cut is still undone: cutting s1's first 500 ms makes
    // cam-y read on time, and restoring it brings back only cam-y's early read,
    // which the plan already had.
    const cut = cutRange(keptSetOf(twoCameras), iv(2000, 2500), [word("um", 2000, 2500)])
    expect(cut).toEqual([iv(1000, 2000), iv(2500, 3000)])
    expect(renderIssues(buildEdited(twoCameras, cut))).toEqual([])
    expect(restoreSpan(cut, twoCameras, iv(2000, 2500), VIDEO)).toEqual({ kept: keptSetOf(twoCameras) })
    expect(restoreReason(cut, twoCameras, MANUAL_REASON, VIDEO)).toEqual({ kept: keptSetOf(twoCameras), locked: [] })
  })

  it("a locked span lists only the time K does not keep yet", () => {
    // [800, 1000) joins s0 and reads cam-b from 800 ms, after it starts at 700 ms.
    const part = restoreSpan(keptSetOf(lateCamera), lateCamera, iv(800, 1000), VIDEO)
    expect(part).toEqual({ kept: [iv(800, 3000)] })
    const { kept, locked } = restoreReason(part.kept, lateCamera, "no-picture", VIDEO)
    expect(kept).toEqual(part.kept)
    expect(locked.map((l) => [l.span, l.reason])).toEqual([[iv(0, 800), "reads-before-source"]])
  })

  it("restoring into an empty edit is judged like any other", () => {
    const empty = cutRange(keptSetOf(lateCamera), iv(1000, 3000), [word("all", 1000, 3000)])
    expect(empty).toEqual([])
    expect(restoreSpan(empty, lateCamera, lateCamera.dropped![0], VIDEO).lock?.reason).toBe("reads-before-source")
    expect(restoreReason(empty, lateCamera, "manual", VIDEO)).toEqual({ kept: keptSetOf(lateCamera), locked: [] })
  })
})
