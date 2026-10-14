// @vitest-environment node
/**
 * INVARIANT: as a SOURCE, `video-audit` is indistinguishable from
 * `video-analysis`.
 *
 * The audit re-emits the CORRECTED analysis — same canonical payload, same
 * field (`generatedJson`), same `json` + `text` handle pair. So every set that
 * decides "may this source feed that input?" must classify the two identically,
 * or a downstream node can tell an audited analysis from a raw one: the canvas
 * validator rejects an edge the orchestrator would happily route, or a typed
 * pip's popover lists zero candidates ("cannot connect the outputs" bug class).
 *
 * Written as a PARITY sweep rather than a hand-listed set of memberships (the
 * voice-changer-pro twin test in packages/shared/src/__tests__/producer-types.
 * test.ts is the precedent): every exported producer/source Set in these
 * modules is discovered at runtime, so a set added LATER is covered without
 * anyone remembering this file. A deliberate asymmetry has to be argued for
 * here — it can't be introduced silently.
 */
import { describe, it, expect } from "vitest"
import * as sharedProducers from "@nodaro/shared"
import * as dataHandles from "../data-handles"
import * as imageHandles from "../generate-image-handles"
import * as videoHandles from "../generate-video-handles"
import * as ffmpegHandles from "../ffmpeg-handles"
import { HANDLE_OUTPUT_TYPES } from "../handle-output-types"

/** Every exported Set in a module, keyed by export name. */
function exportedSets(mod: Record<string, unknown>, modName: string): Array<[string, ReadonlySet<string>]> {
  return Object.entries(mod)
    .filter((entry): entry is [string, Set<string>] => entry[1] instanceof Set)
    .map(([name, set]) => [`${modName}.${name}`, set] as [string, ReadonlySet<string>])
}

// The shared module re-exports a lot; restrict it to the producer-type sets
// (the only Sets there that gate connections) by name to keep the failure
// message readable.
const SETS: Array<[string, ReadonlySet<string>]> = [
  ["shared.VIDEO_PRODUCER_TYPES", sharedProducers.VIDEO_PRODUCER_TYPES],
  ["shared.AUDIO_PRODUCER_TYPES", sharedProducers.AUDIO_PRODUCER_TYPES],
  ["shared.DYNAMIC_PRODUCER_TYPES", sharedProducers.DYNAMIC_PRODUCER_TYPES],
  ["shared.FAN_OUT_EACH_TYPES", sharedProducers.FAN_OUT_EACH_TYPES],
  ...exportedSets(dataHandles as unknown as Record<string, unknown>, "data-handles"),
  ...exportedSets(imageHandles as unknown as Record<string, unknown>, "generate-image-handles"),
  ...exportedSets(videoHandles as unknown as Record<string, unknown>, "generate-video-handles"),
  ...exportedSets(ffmpegHandles as unknown as Record<string, unknown>, "ffmpeg-handles"),
]

describe("video-audit source parity with video-analysis", () => {
  it("discovered a non-trivial number of producer/source sets", () => {
    expect(SETS.length).toBeGreaterThanOrEqual(8)
  })

  it.each(SETS)("%s classifies video-audit exactly like video-analysis", (name, set) => {
    expect(
      set.has("video-audit"),
      `${name}: video-audit must match video-analysis (an audited analysis IS an analysis). ` +
        `video-analysis=${set.has("video-analysis")}, video-audit=${set.has("video-audit")}`,
    ).toBe(set.has("video-analysis"))
  })

  it("is a real assertion — video-analysis IS a member of at least one swept set", () => {
    expect(SETS.some(([, set]) => set.has("video-analysis"))).toBe(true)
  })

  it("emits the same typed outputs on the same handles", () => {
    expect(HANDLE_OUTPUT_TYPES["video-audit"]).toEqual(HANDLE_OUTPUT_TYPES["video-analysis"])
  })
})
