import { describe, it, expect } from "vitest"

import { videoDurationOptions } from "../../model-menu"
import { repairDocument } from "../import"
import { buildFormatRegistry } from "../registry"
import {
  FORMAT_ID,
  FORMAT_VERSION,
  type AudioMode,
  type ProductionDocument,
  type SceneDocument,
} from "../schema"
import type { ImportWarning } from "../warnings"
import { voiceDirectionKindsFor } from "../../voice-direction"

/**
 * A7 — CAPABILITY warnings at import. A `/` cue the scene's own video model
 * cannot carry is dropped at generate time by `renderVoiceDirection` (and
 * announced by Studio's toast), which is the worst moment to learn about it:
 * the file landed silently and the user paid for a render to find out.
 *
 * Repair now says it up front, in the same `audio` warning class, at the cue's
 * own path — and KEEPS the cue: the generate-time drop still owns the drop, so
 * re-pointing the scene at a model that CAN carry it is a model change, not a
 * re-import.
 *
 * The predicate is `voiceDirectionKindsFor` — `renderVoiceDirection`'s OWN
 * capability gate, so the receipt can never disagree with the toast. That is
 * why `tone` warns on an ambient model too (`SPEECH_KINDS` is `{speech, tone}`
 * — a tone needs a voice to colour): the item's shorthand said "speech on an
 * ambient model", but the rule this must mirror is broader.
 */
const REGISTRY = buildFormatRegistry()
const durationsFor = (model: string) =>
  videoDurationOptions(model).map((d) => d.value)

/** The three capability tiers, taken from the registry rather than hardcoded —
 *  the SET of models is the catalog's (`VIDEO_MODEL_ALLOWLIST` is derived), so
 *  a test naming ids would rot the first time the catalog moves. */
const AMBIENT = REGISTRY.videoModels.find((m) => m.audio === "ambient")?.id
const SILENT = REGISTRY.videoModels.find((m) => m.audio === "none")?.id
const SPEAKS = REGISTRY.videoModels.find((m) => m.audio === "speech")?.id

const document = (scenes: ReadonlyArray<SceneDocument>): ProductionDocument => ({
  format: FORMAT_ID,
  version: FORMAT_VERSION,
  scenes: [...scenes],
})

/** One scene: a model, and one shot carrying one cue. */
const withShotCue = (model: string | undefined, mode: AudioMode) =>
  document([
    {
      motion: { ...(model ? { model } : {}) },
      shots: [{ seconds: 4, text: "she runs", audio: [{ mode, content: "a cue" }] }],
    },
  ])

const repair = (doc: ProductionDocument) => repairDocument(doc, REGISTRY, durationsFor)

/** Only the capability receipts — the orphan-run scan and the soundtrack
 *  repairs share the `audio` code, so match on the wording that is A7's. */
const capabilityWarnings = (warnings: ReadonlyArray<ImportWarning>) =>
  warnings.filter((w) => w.code === "audio" && w.message.includes("generating will drop it"))

describe("repair — audio cues the scene's model cannot carry (A7)", () => {
  it("the catalog still publishes a model in each audio tier", () => {
    expect(AMBIENT).toBeDefined()
    expect(SILENT).toBeDefined()
    expect(SPEAKS).toBeDefined()
  })

  it("warns on a SPEECH cue against an ambient-only model, and keeps the cue", () => {
    const { doc, warnings } = repair(withShotCue(AMBIENT, "speech"))
    const capability = capabilityWarnings(warnings)
    expect(capability).toHaveLength(1)
    expect(capability[0].path).toBe("scenes[0].shots[0].audio[0]")
    expect(capability[0].message).toContain(AMBIENT)
    expect(capability[0].message).toContain("speech direction")
    // KEPT — the generate-time toast still owns the drop.
    expect(doc.scenes[0].shots![0].audio).toEqual([{ mode: "speech", content: "a cue" }])
  })

  it("warns on a TONE cue against an ambient-only model — a tone needs a voice too", () => {
    const capability = capabilityWarnings(repair(withShotCue(AMBIENT, "tone")).warnings)
    expect(capability).toHaveLength(1)
    expect(capability[0].path).toBe("scenes[0].shots[0].audio[0]")
  })

  it("says nothing about the sound layers an ambient model DOES carry", () => {
    for (const mode of ["sfx", "ambience", "music"] as const) {
      expect(capabilityWarnings(repair(withShotCue(AMBIENT, mode)).warnings), mode).toEqual([])
    }
  })

  it("says nothing at all against a model that speaks", () => {
    for (const mode of REGISTRY.audio.modes) {
      expect(capabilityWarnings(repair(withShotCue(SPEAKS, mode)).warnings), mode).toEqual([])
    }
  })

  it("warns on EVERY cue against a silent model, in its own sentence", () => {
    for (const mode of REGISTRY.audio.modes) {
      const capability = capabilityWarnings(repair(withShotCue(SILENT, mode)).warnings)
      expect(capability, mode).toHaveLength(1)
      expect(capability[0].message).toContain("silent video")
    }
  })

  it("warns per cue, at each cue's own index", () => {
    const { warnings } = repair(
      document([
        {
          motion: { model: AMBIENT },
          shots: [
            {
              seconds: 4,
              text: "she runs",
              audio: [
                { mode: "sfx", content: "rain" },
                { mode: "speech", content: "Go!" },
                { mode: "tone", content: "urgent" },
              ],
            },
          ],
        },
      ]),
    )
    expect(capabilityWarnings(warnings).map((w) => w.path)).toEqual([
      "scenes[0].shots[0].audio[1]",
      "scenes[0].shots[0].audio[2]",
    ])
  })

  it("warns at the SCENE's own path for a shot-less scene's cue", () => {
    const { doc, warnings } = repair(
      document([
        {
          motion: {
            model: SILENT,
            prompt: "a slow push in",
            audio: [{ mode: "sfx", content: "rain" }],
          },
        },
      ]),
    )
    const capability = capabilityWarnings(warnings)
    expect(capability).toHaveLength(1)
    expect(capability[0].path).toBe("scenes[0].motion.audio[0]")
    expect(doc.scenes[0].motion?.audio).toEqual([{ mode: "sfx", content: "rain" }])
  })

  it("a MOVED scene cue keeps both receipts, at their own paths", () => {
    // A scene WITH shots that also carries scene-level cues gets two `audio`
    // warnings for one cue, and they answer different questions: the capability
    // receipt (indexed, at the cue) and the move receipt (unindexed, at the
    // list). Pinned before the preview groups warnings by code, so a grouping
    // that folded them into one would have to decide which sentence to lose —
    // and the answer is neither.
    const { doc, warnings } = repair(
      document([
        {
          motion: {
            model: SILENT,
            prompt: "a push in",
            audio: [{ mode: "sfx", content: "rain" }],
          },
          shots: [{ seconds: 4, text: "she runs" }],
        },
      ]),
    )
    const audio = warnings.filter((w) => w.code === "audio")
    expect(audio.map((w) => w.path)).toEqual([
      "scenes[0].motion.audio[0]",
      "scenes[0].motion.audio",
    ])
    expect(audio[0].message).toContain("generating will drop it")
    expect(audio[1].message).toContain("moved into the first shot")
    // The cue really did move, and the capability receipt is NOT re-issued for
    // it at its new home — the move runs after `repairShots`.
    expect(doc.scenes[0].shots![0].audio).toEqual([{ mode: "sfx", content: "rain" }])
    expect(capabilityWarnings(warnings)).toHaveLength(1)
  })

  it("checks a scene with NO model against the format's own default", () => {
    // The default resolves the same way every other repair resolves it —
    // `repairModel` hands back the fallback's row for an absent id, and
    // `repairScene` reads `copy.motion?.model ?? registry.defaults.videoModel`
    // for the shots. That is the FORMAT's default, and it is the honest thing
    // for a receipt about a document to check; the editor may open the scene on
    // the user's own sticky last-used provider instead, which is why the
    // warning speaks about the file rather than promising what will render.
    // Today's default speaks, so nothing warns; the guard below is what fails
    // loudly if the curated default ever stops speaking, rather than this test
    // quietly asserting nothing.
    expect(voiceDirectionKindsFor(REGISTRY.defaults.videoModel)).toContain("speech")
    expect(capabilityWarnings(repair(withShotCue(undefined, "speech")).warnings)).toEqual([])
    expect(capabilityWarnings(repair(document([
      { shots: [{ seconds: 4, text: "she runs", audio: [{ mode: "speech", content: "Go!" }] }] },
    ])).warnings)).toEqual([])
  })

  it("checks a RETIRED model against the fallback it was repaired to, not the id in the file", () => {
    const { warnings } = repair(withShotCue("model-that-retired", "speech"))
    expect(warnings.some((w) => w.code === "model")).toBe(true)
    // The fallback speaks, so the cue is carried — the check reads the model
    // the scene will actually render on.
    expect(capabilityWarnings(warnings)).toEqual([])
  })
})
