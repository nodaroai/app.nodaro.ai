import { describe, it, expect } from "vitest"

import { buildFormatRegistry } from "../registry"
import { repairDocument } from "../import"
import {
  FORMAT_ID,
  FORMAT_VERSION,
  type AudioMode,
  type ProductionDocument,
  type SceneDocument,
} from "../schema"
import { videoDurationOptions } from "../../model-menu"

/**
 * Stage 3's AUDIO-CUE repairs (spec §6.3, D3) — a shot's or a shot-less
 * scene's `/` cues, the third area `import-repair-sound.ts` owns. Split out of
 * `import-repair.test.ts` (G2's own R40-style split, taken in the follow-ups
 * fix wave) once that file passed the 800-line house cap, and kept apart from
 * `import-repair-sound.test.ts` (voice · music) so neither lands near the cap
 * the split exists to clear. The CAPABILITY half — a cue the scene's model
 * cannot carry — has its own older sibling, `import-repair-capability.test.ts`.
 *
 * Repair is CATALOG-AWARE and NEVER REJECTS: a file written against a newer
 * catalog, or by a model that invented an id, opens with what this studio
 * understands and a warning for the rest.
 *
 * The local builders (`document`, `REGISTRY`, `durationsFor`) are this file's
 * own copies rather than an import from a sibling: importing a `.test.ts` file
 * would re-run its `describe`/`it` blocks a second time — the same
 * standalone-with-local-fixtures precedent `production-bundle.recipe.test.ts`
 * set. Every `describe` below is a PURE MOVE: not a line of a case changed.
 */

const REGISTRY = buildFormatRegistry()
const durationsFor = (model: string) =>
  videoDurationOptions(model).map((d) => d.value)

const document = (scenes: ReadonlyArray<SceneDocument>): ProductionDocument => ({
  format: FORMAT_ID,
  version: FORMAT_VERSION,
  scenes: [...scenes],
})

describe("repair — audio cues (D3)", () => {
  it("drops an unknown mode and an empty cue, keeps the rest verbatim", () => {
    const { doc, warnings } = repairDocument(
      document([
        {
          shots: [
            {
              seconds: 4,
              text: "x",
              audio: [
                { mode: "sfx", content: " wind " },
                // A mode outside the format's vocabulary — same "the file may
                // lie" premise as an unknown transition id; the cast mirrors
                // the schema's own lenient `mode: z.string().transform(…)`.
                { mode: "growl" as AudioMode, content: "y" },
                { mode: "music", content: "  " },
                { mode: "sfx", content: "z", speaker: "no" },
              ],
            },
          ],
        },
      ]),
      REGISTRY,
      durationsFor,
    )
    expect(doc.scenes[0].shots![0].audio).toEqual([
      { mode: "sfx", content: "wind" },
      { mode: "sfx", content: "z" },
    ])
    expect(warnings.map((w) => w.code)).toEqual(["unknown-id", "audio"])
  })

  it("moves scene-level cues into the first shot when the scene has shots", () => {
    const { doc, warnings } = repairDocument(
      document([
        {
          motion: { audio: [{ mode: "music", content: "drums" }] },
          shots: [{ seconds: 4, text: "x", audio: [{ mode: "sfx", content: "wind" }] }],
        },
      ]),
      REGISTRY,
      durationsFor,
    )
    expect(doc.scenes[0].motion?.audio).toBeUndefined()
    expect(doc.scenes[0].shots![0].audio).toEqual([
      { mode: "music", content: "drums" },
      { mode: "sfx", content: "wind" },
    ])
    expect(warnings).toContainEqual(
      expect.objectContaining({ code: "audio", path: "scenes[0].motion.audio" }),
    )
  })

  it("the orphan scan sees the cue that is about to move in — no false 'unclaimed' warning", () => {
    // Shot 1's prose carries `[wind]` with no cue of its OWN, but the scene's
    // `motion.audio` cue is about to move onto it (the rule above). The scan
    // must see that incoming cue, or it wrongly tells the author to delete a
    // token the import is about to claim.
    const { doc, warnings } = repairDocument(
      document([
        {
          motion: { audio: [{ mode: "sfx", content: "wind" }] },
          shots: [{ seconds: 4, text: "she runs [wind]" }],
        },
      ]),
      REGISTRY,
      durationsFor,
    )
    const audioWarnings = warnings.filter((w) => w.code === "audio")
    expect(audioWarnings).toHaveLength(1)
    expect(audioWarnings[0].path).toBe("scenes[0].motion.audio")
    // The emptied `motion` node is dropped, not left as `{}`.
    expect(doc.scenes[0].motion).toBeUndefined()
  })

  it("keeps a motion-level cue on a scene with no shots", () => {
    const { doc, warnings } = repairDocument(
      document([{ motion: { audio: [{ mode: "music", content: "drums" }] } }]),
      REGISTRY,
      durationsFor,
    )
    expect(warnings).toEqual([])
    expect(doc.scenes[0].motion?.audio).toEqual([{ mode: "music", content: "drums" }])
  })

  it("names a bracketed run in the prose that no cue claims (rule 12's receipt)", () => {
    const { warnings } = repairDocument(
      document([
        {
          shots: [
            {
              seconds: 4,
              text: "she flinches [door slams]",
              audio: [{ mode: "sfx", content: "door slam" }],
            },
          ],
        },
      ]),
      REGISTRY,
      durationsFor,
    )
    // ONE warning, naming the run: the cue's own token is `[door slam]`, so
    // the importer appends that and the author's `[door slams]` stays in the
    // prose as literal brackets the model will read out.
    const orphans = warnings.filter((w) => w.path === "scenes[0].shots[0].text")
    expect(orphans).toHaveLength(1)
    expect(orphans[0]).toMatchObject({ code: "audio" })
    expect(orphans[0].message).toContain("[door slams]")
  })

  it("says nothing when every bracketed run is a cue's own token", () => {
    const { warnings } = repairDocument(
      document([
        {
          shots: [
            {
              seconds: 4,
              text: "she flinches [door slam] and [wind] rises",
              audio: [
                { mode: "sfx", content: "door slam" },
                { mode: "ambience", content: "wind" },
              ],
            },
            // No cues and no brackets — the ordinary shot, silent as ever.
            { seconds: 4, text: "she runs" },
          ],
        },
      ]),
      REGISTRY,
      durationsFor,
    )
    expect(warnings).toEqual([])
  })

  it("agrees with neutralDirectionText's grammar (B2 — one bracket source)", () => {
    // `warnOrphanRuns` scans against `voice-direction.ts`'s own
    // `DIRECTION_BRACKET_RUN` rather than a re-typed copy — pinned here by
    // going through the real consumer: a claimed token warns nothing, the
    // SAME token unclaimed warns exactly once, naming it. If the two grammars
    // ever disagreed (a token `neutralDirectionText` writes that this scan
    // doesn't recognise as a run, or vice versa), one side of this would flip.
    // The invariant is kind-INDEPENDENT — neither `neutralDirectionText`'s
    // `[${text}]` token nor `DIRECTION_BRACKET_RUN`'s bracket shape reads
    // `kind` at all — so one representative kind (`sfx`) covers it; looping
    // over every `VoiceDirectionKind` here would just re-assert the same fact
    // four more times, never a kind-specific one.
    const claimed = repairDocument(
      document([
        {
          shots: [
            {
              seconds: 4,
              text: "she moves [sample]",
              audio: [{ mode: "sfx", content: "sample" }],
            },
          ],
        },
      ]),
      REGISTRY,
      durationsFor,
    )
    expect(claimed.warnings.filter((w) => w.code === "audio")).toEqual([])

    const unclaimed = repairDocument(
      document([{ shots: [{ seconds: 4, text: "she moves [sample]" }] }]),
      REGISTRY,
      durationsFor,
    )
    const orphans = unclaimed.warnings.filter((w) => w.path === "scenes[0].shots[0].text")
    expect(orphans).toHaveLength(1)
    expect(orphans[0].message).toContain("[sample]")
  })

  it("names an orphan bracket in a SHOT-LESS scene's motion.prompt too (B3 — the prose IS the plan)", () => {
    const { warnings } = repairDocument(
      document([
        {
          motion: {
            prompt: "slow push [drums] over the rooftops [rain]",
            audio: [{ mode: "music", content: "drums" }],
          },
        },
      ]),
      REGISTRY,
      durationsFor,
    )
    const orphans = warnings.filter((w) => w.path === "scenes[0].motion.prompt")
    expect(orphans).toHaveLength(1)
    expect(orphans[0]).toMatchObject({ code: "audio" })
    expect(orphans[0].message).toContain("[rain]")
  })

  it("says nothing about a shot-less scene's prompt when every run is a cue's own token", () => {
    const { warnings } = repairDocument(
      document([
        {
          motion: {
            prompt: "slow push [drums] over the rooftops",
            audio: [{ mode: "music", content: "drums" }],
          },
        },
      ]),
      REGISTRY,
      durationsFor,
    )
    expect(warnings).toEqual([])
  })

  it("also scans a shot-less scene's motion.scenePrompt — it folds ahead of prompt into what the model reads", () => {
    const { warnings } = repairDocument(
      document([
        {
          motion: {
            prompt: "she runs",
            scenePrompt: "A rain-soaked rooftop chase [wind]",
          },
        },
      ]),
      REGISTRY,
      durationsFor,
    )
    const orphans = warnings.filter((w) => w.path === "scenes[0].motion.scenePrompt")
    expect(orphans).toHaveLength(1)
    expect(orphans[0].message).toContain("[wind]")
  })

  it("also scans scenePrompt on a scene WITH shots (R70, fix round 1) — it folds ahead of the beats too", () => {
    // `scenePrompt` survives repair beside shots (it "stands OVER them") and
    // `foldScenePrompt` folds it ahead of the directing body UNCONDITIONALLY
    // — whether that body is a shot-less scene's prose or the beats a scene
    // WITH shots carries — so an orphan run in it reaches the model exactly
    // the same either way. The original B3 landing wrongly gated this scan on
    // `!hasShots`; R70 corrects it.
    const { warnings } = repairDocument(
      document([
        {
          motion: { scenePrompt: "A chase [wind]" },
          shots: [{ seconds: 4, text: "she runs" }],
        },
      ]),
      REGISTRY,
      durationsFor,
    )
    const orphans = warnings.filter((w) => w.path === "scenes[0].motion.scenePrompt")
    expect(orphans).toHaveLength(1)
    expect(orphans[0]).toMatchObject({ code: "audio" })
    expect(orphans[0].message).toContain("[wind]")
  })

  it("an empty audio array leaves no key, no warning, and never triggers the scene-level move", () => {
    const { doc, warnings } = repairDocument(
      document([
        {
          motion: { audio: [] },
          shots: [{ seconds: 4, text: "x", audio: [] }],
        },
      ]),
      REGISTRY,
      durationsFor,
    )
    expect(warnings).toEqual([])
    expect(doc.scenes[0].motion?.audio).toBeUndefined()
    expect(doc.scenes[0].shots![0].audio).toBeUndefined()
  })
})
