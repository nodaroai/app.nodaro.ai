/**
 * The measured walk reads a generation with reference clips up to the length
 * its output follows (`referenceClipOutputSec`, @nodaro/render-rules), so a
 * step after it that measures its clip is never quoted below what its run
 * measures. Held here to the reservation's own hold of that output
 * (`seedance2RefVideoHeldOutputSec`), over every reference-billing model,
 * requested length (Auto included) and clip set — measured and unmeasured:
 * never below it, and equal to it except for a Seedance run at an automatic
 * length that does not declare an edit. Such a run lets the model decide
 * whether a clip is a reference, an edit or an extension, and a reference
 * renders a length the model picks, so the walk reads it at the most it can
 * render (the model's longest clip, or a longer clip), while the hold still
 * counts it as an edit of its longest clip plus a second.
 *
 * Video to Video on a Seedance edit model enters the same lane: an Auto edit
 * of its source clip (`SEEDANCE_VIDEO_EDIT_SHAPE`), declared as the run
 * resolves it. Its planned length is held to the same hold, never below it and
 * never below its source; a clip the edit cannot take goes out undeclared, so
 * at the most the model may render.
 */
import { describe, expect, it } from "vitest"
import { MODEL_CATALOG, VIDEO_DURATION_AUTO } from "@nodaro/shared/model-catalog"
import { billsReferenceVideoSeconds, isSeedanceVideoEditProvider, listedSeedanceTaskType, pricedOutputDurationSec, SEEDANCE_VIDEO_EDIT_SHAPE, SEEDANCE_VIDEO_EDIT_TASK_TYPE } from "@nodaro/shared/models"
import { AUTO_EDIT_MARGIN_SEC, plannedVideoLengthSec, referenceClipOutputSec, referenceClipWorstCaseSec, seedanceTaskTypeAsRun } from "@nodaro/render-rules"
import { refVideoWorstCaseSecFor, SEEDANCE_AUTO_EDIT_HOLD_MARGIN_SEC, seedance2RefVideoHeldOutputSec } from "../seedance2-ref-video-credits.js"

const PROVIDERS = Object.entries(MODEL_CATALOG).filter(([id, m]) => m.kind === "video" && billsReferenceVideoSeconds(id)).map(([id]) => id)
const DURATIONS: ReadonlyArray<number | string | undefined> = [undefined, 4, 5, 8, 10, "12", 15, 30, VIDEO_DURATION_AUTO]
const CLIP_SETS: ReadonlyArray<ReadonlyArray<number | undefined>> = [[3], [4.6], [12], [29.4], [undefined], [6, 9], [9, undefined], [40]]

describe("the measured walk's reference-clip bound is the reservation's hold", () => {
  it("covers the reference-billing models (Seedance, Kling 4.0, Gemini Omni)", () => {
    expect(PROVIDERS.length).toBeGreaterThanOrEqual(4)
  })

  it("shares the hold's per-clip worst case and Auto-edit margin", () => {
    for (const p of PROVIDERS) expect(referenceClipWorstCaseSec(p), p).toBe(refVideoWorstCaseSecFor(p))
    expect(AUTO_EDIT_MARGIN_SEC).toBe(SEEDANCE_AUTO_EDIT_HOLD_MARGIN_SEC)
  })

  let undeclaredAuto = 0
  it.each(PROVIDERS)("%s", (provider) => {
    for (const duration of DURATIONS) {
      const rendered = pricedOutputDurationSec(provider, duration)
      for (const clips of CLIP_SETS) {
        // Every declaration the run can resolve to: none, a reference (no edit at an automatic length), an edit, an extend.
        for (const referenceTaskType of [undefined, "reference", "edit", "extend"]) {
          const at = `${provider} @ ${String(duration)} (${String(referenceTaskType)}) with ${JSON.stringify(clips)}`
          const held = seedance2RefVideoHeldOutputSec({ provider, outputDurationSec: rendered, requestedDuration: duration, referenceTaskType, durationsSec: clips.map((c) => c ?? Number.NaN) })
          const quoted = referenceClipOutputSec(provider, rendered, duration, clips, referenceTaskType)
          expect(quoted, at).toBeGreaterThanOrEqual(held)
          if (quoted === held) continue
          // Only an automatic length that declares no edit: the most the model may render, the longest of its own clip and every clip.
          undeclaredAuto += 1
          expect(duration, at).toBe(VIDEO_DURATION_AUTO)
          expect(listedSeedanceTaskType(provider, referenceTaskType), at).not.toBe(SEEDANCE_VIDEO_EDIT_TASK_TYPE)
          expect(quoted, at).toBe(Math.max(rendered, ...clips.map((c) => c ?? referenceClipWorstCaseSec(provider))))
        }
      }
    }
  })

  it("an automatic length with a known clip: an undeclared run at the model's longest clip, a declared edit at the clip rounded up plus a second", () => {
    expect(undeclaredAuto).toBeGreaterThan(0)
    const longest = pricedOutputDurationSec("seedance-2-5", VIDEO_DURATION_AUTO)
    expect(referenceClipOutputSec("seedance-2-5", longest, VIDEO_DURATION_AUTO, [3])).toBe(longest)
    expect(referenceClipOutputSec("seedance-2-5", longest, VIDEO_DURATION_AUTO, [3], "reference")).toBe(longest)
    expect(referenceClipOutputSec("seedance-2-5", longest, VIDEO_DURATION_AUTO, [3], "edit")).toBe(3 + AUTO_EDIT_MARGIN_SEC)
    expect(referenceClipOutputSec("seedance-2-5", longest, VIDEO_DURATION_AUTO, [3.2], "edit")).toBe(4 + AUTO_EDIT_MARGIN_SEC)
    // A model that lists no task types cannot declare one: every run there is the model's choice.
    const longest2 = pricedOutputDurationSec("seedance-2", VIDEO_DURATION_AUTO)
    expect(referenceClipOutputSec("seedance-2", longest2, VIDEO_DURATION_AUTO, [3], "edit")).toBe(longest2)
    expect(referenceClipOutputSec("seedance-2", longest2, VIDEO_DURATION_AUTO, [3], "extend")).toBe(longest2)
  })
})

describe("Video to Video's Seedance edit shares the bound", () => {
  const EDIT_PROVIDERS = Object.keys(MODEL_CATALOG).filter((id) => isSeedanceVideoEditProvider(id))
  const auto = SEEDANCE_VIDEO_EDIT_SHAPE.duration

  it("covers the Seedance edit models", () => {
    expect(EDIT_PROVIDERS.length).toBeGreaterThanOrEqual(1)
  })

  it.each(EDIT_PROVIDERS)("%s: its source, or the hold of an Auto edit of it when longer; a clip the edit cannot take, the most the model may render", (provider) => {
    const node = { id: "v", type: "video-to-video", data: { provider } }
    const edges = [{ source: "u", target: "v", targetHandle: "video" }]
    const longest = pricedOutputDurationSec(provider, auto)
    let undeclared = 0
    for (const clip of [undefined, 2.4, 4.6, 9.2, 14.5, 29.4, 40]) {
      // The lane declares the edit it runs, as the run resolves it.
      const run = seedanceTaskTypeAsRun({ provider, duration: auto, data: { referenceTaskType: SEEDANCE_VIDEO_EDIT_TASK_TYPE }, referenceVideoSec: [clip] })
      const held = seedance2RefVideoHeldOutputSec({ provider, outputDurationSec: pricedOutputDurationSec(provider, run.duration), requestedDuration: run.duration, referenceTaskType: run.taskType, durationsSec: [clip ?? Number.NaN] })
      const planned = plannedVideoLengthSec(node, () => clip, [node, { id: "u", type: "upload-video" }], edges)
      const atLeast = clip === undefined ? held : Math.max(clip, held)
      if (run.taskType === SEEDANCE_VIDEO_EDIT_TASK_TYPE) expect(planned, `${provider} with ${String(clip)}`).toBe(atLeast)
      else {
        undeclared += 1
        expect(planned, `${provider} with ${String(clip)}, undeclared`).toBe(Math.max(atLeast, longest))
      }
    }
    // The 2.4 s clip is shorter than an edit takes.
    expect(undeclared).toBeGreaterThan(0)
  })
})
