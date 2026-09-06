import { describe, it, expect } from "vitest"

import example from "../fixtures/example.json"
import { buildFormatRegistry } from "../registry"
import { repairDocument } from "../import"
import {
  FORMAT_ID,
  FORMAT_VERSION,
  productionDocumentSchema,
  type ProductionDocument,
  type SceneDocument,
} from "../schema"
import { videoDurationOptions } from "../../model-menu"

/**
 * Repair is CATALOG-AWARE and NEVER REJECTS (spec §6.3): a file written against
 * a newer catalog, or by a model that invented an id, opens with what this
 * studio understands and a warning for the rest.
 *
 * What stays HERE is stage 3's document-wide half — cardinality, timing, the
 * model/option vocabularies and the document-level rules. The two areas with
 * their own repair module have their own sibling suites:
 * `import-repair-sound.test.ts` (voice · music · audio cues) and
 * `import-repair-subject.test.ts` (look layers · subject · the film key), split
 * out in the follow-ups fix wave once this file passed the 800-line cap.
 *
 * Each of the three files carries its OWN copy of the tiny local builders
 * (`doc`/`document`, `REGISTRY`, `durationsFor`) rather than importing them
 * from a sibling: importing a `.test.ts` file would re-run its `describe`/`it`
 * blocks a second time — the same standalone-with-local-fixtures precedent
 * `production-bundle.recipe.test.ts` set. Every `describe` below is a PURE
 * MOVE: not a line of a case changed.
 */

const REGISTRY = buildFormatRegistry()
const durationsFor = (model: string) =>
  videoDurationOptions(model).map((d) => d.value)

const doc = (over: Partial<ProductionDocument> = {}): ProductionDocument => ({
  format: FORMAT_ID,
  version: 1,
  scenes: [{ frame: { prompt: "an alley" } }],
  ...over,
})

// A second, narrower builder for the tests that destructure `{ doc, warnings }`
// off `repairDocument`'s result, which would shadow the `doc(...)` factory
// above if it were reused in the same statement.
const document = (scenes: ReadonlyArray<SceneDocument>): ProductionDocument => ({
  format: FORMAT_ID,
  version: FORMAT_VERSION,
  scenes: [...scenes],
})

describe("repair — cardinality", () => {
  it("keeps the first id when a single-pick key is given an array", () => {
    const out = repairDocument(
      doc({
        scenes: [
          { look: { framingId: ["wide-shot", "close-up"] }, frame: { prompt: "p" } },
        ],
      }),
      REGISTRY,
      durationsFor,
    )
    expect(out.warnings[0].code).toBe("cardinality")
    expect(out.doc.scenes[0].look).toEqual({ framingId: "wide-shot" })
  })

  it("keeps the first id when a PICKS key is given an array", () => {
    const out = repairDocument(
      doc({
        scenes: [
          {
            shots: [
              { seconds: 4, text: "t", picks: { framingId: ["wide-shot", "close-up"] } },
            ],
          },
        ],
      }),
      REGISTRY,
      durationsFor,
    )
    expect(out.warnings[0].code).toBe("cardinality")
    expect(out.doc.scenes[0].shots?.[0].picks).toEqual({ framingId: "wide-shot" })
  })

  it("trims a multi-pick key to its cap", () => {
    const out = repairDocument(
      doc({
        scenes: [
          {
            look: { atmosphereId: ["fog", "light-rain", "clear"] },
            frame: { prompt: "p" },
          },
        ],
      }),
      REGISTRY,
      durationsFor,
    )
    expect(out.warnings[0].code).toBe("cardinality")
    expect(out.doc.scenes[0].look).toEqual({ atmosphereId: ["fog", "light-rain"] })
  })

  it("leaves a legal multi-pick array alone", () => {
    const out = repairDocument(
      doc({
        scenes: [{ look: { atmosphereId: ["fog", "light-rain"] }, frame: { prompt: "p" } }],
      }),
      REGISTRY,
      durationsFor,
    )
    expect(out.warnings).toEqual([])
  })

  it("never mutates the document it was given", () => {
    const input = doc({
      scenes: [{ look: { framingId: ["wide-shot", "close-up"] }, frame: { prompt: "p" } }],
    })
    repairDocument(input, REGISTRY, durationsFor)
    expect(input.scenes[0].look).toEqual({ framingId: ["wide-shot", "close-up"] })
  })
})

describe("repair — timing", () => {
  it("snaps a shot length onto the tenths grid", () => {
    const out = repairDocument(
      doc({ scenes: [{ shots: [{ seconds: 4.03, text: "t" }] }] }),
      REGISTRY,
      durationsFor,
    )
    expect(out.warnings[0].code).toBe("seconds")
    expect(out.doc.scenes[0].shots?.[0].seconds).toBe(4)
  })

  it("drops a shot with no length — never the document", () => {
    const out = repairDocument(
      doc({
        scenes: [{ shots: [{ seconds: 0, text: "nothing" }, { seconds: 4, text: "t" }] }],
      }),
      REGISTRY,
      durationsFor,
    )
    expect(out.warnings[0].code).toBe("shot-dropped")
    expect(out.doc.scenes[0].shots).toHaveLength(1)
  })

  it("clamps a scene over its model's budget", () => {
    const out = repairDocument(
      doc({
        scenes: [
          {
            motion: { model: "seedance-2" },
            shots: [
              { seconds: 10, text: "a" },
              { seconds: 12, text: "b" },
            ],
          },
        ],
      }),
      REGISTRY,
      durationsFor,
    )
    expect(out.warnings.map((w) => w.code)).toEqual(["budget"])
    expect(
      out.doc.scenes[0].shots?.reduce((s, x) => s + x.seconds, 0),
    ).toBe(15)
  })

  it("uses the stage default's budget when the scene names no model", () => {
    const out = repairDocument(
      doc({
        scenes: [
          { shots: Array.from({ length: 4 }, () => ({ seconds: 10, text: "a" })) },
        ],
      }),
      REGISTRY,
      durationsFor,
    )
    expect(out.warnings[0].code).toBe("budget")
    expect(out.warnings[0].message).toContain(REGISTRY.defaults.videoModel)
  })

  it("snaps a clip duration onto the model's ladder", () => {
    const out = repairDocument(
      doc({ scenes: [{ motion: { model: "seedance-2", duration: 12.5 } }] }),
      REGISTRY,
      durationsFor,
    )
    expect(out.warnings[0].code).toBe("duration")
    expect(out.doc.scenes[0].motion?.duration).toBe(12)
  })

  it("drops a duration on a model with no clip-length lever", () => {
    const out = repairDocument(
      doc({ scenes: [{ motion: { model: "seedance-2", duration: 10 } }] }),
      REGISTRY,
      () => [],
    )
    expect(out.warnings[0].code).toBe("duration")
    expect(out.doc.scenes[0].motion?.duration).toBeUndefined()
  })
})

describe("repair — models and their option vocabularies", () => {
  it("falls to the stage default for a model that is not on the menu", () => {
    const out = repairDocument(
      doc({ scenes: [{ frame: { prompt: "p", model: "dall-e-2" } }] }),
      REGISTRY,
      durationsFor,
    )
    expect(out.warnings[0].code).toBe("model")
    expect(out.doc.scenes[0].frame?.model).toBe(REGISTRY.defaults.imageModel)
  })

  it("falls to the stage default for an aspect ratio the model has no row for", () => {
    const out = repairDocument(
      doc({
        scenes: [{ frame: { prompt: "p", model: "gpt-image-2", aspectRatio: "21:9" } }],
      }),
      REGISTRY,
      durationsFor,
    )
    expect(out.warnings[0].code).toBe("option")
    expect(out.doc.scenes[0].frame?.aspectRatio).toBe(REGISTRY.defaults.aspectRatio)
  })

  it("drops a video resolution the model does not offer — Auto is its default", () => {
    const out = repairDocument(
      doc({ scenes: [{ motion: { model: "seedance-2", resolution: "8K" } }] }),
      REGISTRY,
      durationsFor,
    )
    expect(out.warnings[0].code).toBe("option")
    expect(out.doc.scenes[0].motion?.resolution).toBeUndefined()
  })

  it("drops an image resolution when the stage default is not offered either", () => {
    // flux-2's tiers are megapixels, not `2K` (spec D15) — the default cannot
    // rescue a value the model has no row for.
    const mpModel = REGISTRY.imageModels.find(
      (m) =>
        m.resolutions.length > 0 &&
        !m.resolutions.includes(REGISTRY.defaults.resolution),
    )
    expect(mpModel).toBeDefined()
    const out = repairDocument(
      doc({
        scenes: [
          { frame: { prompt: "p", model: mpModel!.id, resolution: "2K" } },
        ],
      }),
      REGISTRY,
      durationsFor,
    )
    expect(out.warnings[0].code).toBe("option")
    expect(out.doc.scenes[0].frame?.resolution).toBeUndefined()
  })

  it("clamps the candidate count", () => {
    const out = repairDocument(
      doc({ scenes: [{ frame: { prompt: "p", count: 40 } }] }),
      REGISTRY,
      durationsFor,
    )
    expect(out.warnings[0].code).toBe("count")
    expect(out.doc.scenes[0].frame?.count).toBe(REGISTRY.candidates.max)
  })

  it("drops a camera movement the catalog does not carry", () => {
    const out = repairDocument(
      doc({ scenes: [{ motion: { cameraMotionId: "moonwalk" } }] }),
      REGISTRY,
      durationsFor,
    )
    expect(out.warnings[0].code).toBe("unknown-id")
    expect(out.doc.scenes[0].motion?.cameraMotionId).toBeUndefined()
  })

  it("drops motion.input when the resolved model's own inputs row lacks it (D3)", () => {
    // happyhorse is text-only (no "start" in its `inputs` row) — the SAME model
    // check `repairModel` already resolved for the aspect/resolution/duration
    // levers above, so the option check and the model check can never disagree.
    const out = repairDocument(
      document([{ motion: { model: "happyhorse", input: "start" } }]),
      REGISTRY,
      durationsFor,
    )
    expect(out.doc.scenes[0].motion?.input).toBeUndefined()
    expect(out.warnings.map((w) => w.code)).toEqual(["option"])
  })

  it("keeps motion.input when the resolved model's own inputs row carries it (D3)", () => {
    // No `model` authored ⇒ resolves to the video default, which carries every
    // mode — the same "absent falls to the default" rule `repairModel` gives
    // every other Directing lever.
    const out = repairDocument(
      document([{ motion: { input: "references" } }]),
      REGISTRY,
      durationsFor,
    )
    expect(out.doc.scenes[0].motion?.input).toBe("references")
    expect(out.warnings).toEqual([])
  })

  it("drops an unknown transition but keeps the shot", () => {
    const out = repairDocument(
      doc({
        scenes: [
          { shots: [{ seconds: 4, text: "t", transition: { id: "star-wipe-9000" } }] },
        ],
      }),
      REGISTRY,
      durationsFor,
    )
    expect(out.warnings[0].code).toBe("unknown-id")
    expect(out.doc.scenes[0].shots?.[0].transition).toBeUndefined()
    expect(out.doc.scenes[0].shots).toHaveLength(1)
  })

  it("drops an unknown lever step but keeps the transition", () => {
    const out = repairDocument(
      doc({
        scenes: [
          {
            shots: [
              {
                seconds: 4,
                text: "t",
                transition: { id: "cross-dissolve", duration: "0.4s" },
              },
            ],
          },
        ],
      }),
      REGISTRY,
      durationsFor,
    )
    expect(out.warnings[0].code).toBe("unknown-id")
    expect(out.doc.scenes[0].shots?.[0].transition).toEqual({ id: "cross-dissolve" })
  })

  it("repairs the scene's END transition exactly like a shot's", () => {
    // One node, two seats — so one repair, against the same catalog: an unknown
    // pick drops the node, an unknown lever step drops only the step.
    const out = repairDocument(
      doc({
        scenes: [
          {
            motion: {
              prompt: "she runs",
              endTransition: { id: "cross-dissolve", position: "end", duration: "0.4s" },
            },
          },
          { motion: { prompt: "she stops", endTransition: { id: "star-wipe-9000" } } },
        ],
      }),
      REGISTRY,
      durationsFor,
    )
    expect(out.doc.scenes[0].motion?.endTransition).toEqual({
      id: "cross-dissolve",
      position: "end",
    })
    expect(out.doc.scenes[1].motion?.endTransition).toBeUndefined()
    expect(out.warnings.map((w) => w.code)).toEqual(["unknown-id", "unknown-id"])
  })
})

describe("repair — document-level rules", () => {
  it("drops a motion prompt written beside shots", () => {
    const out = repairDocument(
      doc({
        scenes: [
          { motion: { prompt: "she runs" }, shots: [{ seconds: 4, text: "t" }] },
        ],
      }),
      REGISTRY,
      durationsFor,
    )
    expect(out.warnings[0].code).toBe("motion-prompt")
    expect(out.doc.scenes[0].motion?.prompt).toBeUndefined()
  })

  it("KEEPS the scene's generic prompt beside shots — only `prompt` is the shots' job", () => {
    // The two prose fields sit in one object and mean opposite things: the
    // shots replace `motion.prompt`, and `motion.scenePrompt` is exactly the
    // description that stands OVER them. A repair that swept the object would
    // silently delete the paragraph the author wrote first.
    const out = repairDocument(
      doc({
        scenes: [
          {
            motion: { prompt: "she runs", scenePrompt: "A rain-soaked rooftop chase." },
            shots: [{ seconds: 4, text: "t" }],
          },
        ],
      }),
      REGISTRY,
      durationsFor,
    )
    expect(out.warnings.map((w) => w.code)).toEqual(["motion-prompt"])
    expect(out.doc.scenes[0].motion?.prompt).toBeUndefined()
    expect(out.doc.scenes[0].motion?.scenePrompt).toBe("A rain-soaked rooftop chase.")
  })

  it("keeps a motion prompt on a scene with no shots", () => {
    const out = repairDocument(
      doc({ scenes: [{ motion: { prompt: "she runs" } }] }),
      REGISTRY,
      durationsFor,
    )
    expect(out.warnings).toEqual([])
    expect(out.doc.scenes[0].motion?.prompt).toBe("she runs")
  })

  it("never sees a root voice key — the schema already stripped it (D7: voice lives at scenes[].voice, not the reserved root slot)", () => {
    // Before D7 `repairDocument` dropped a root `voice` itself (a `reserved`
    // warning); the slot is GONE now, so the schema's own strip (D11: unknown
    // keys are never passed the trust boundary) is what removes it — by the
    // time a document reaches `repairDocument`, there is nothing left to drop.
    const raw: Record<string, unknown> = { ...doc(), voice: { lines: [] } }
    const parsed = productionDocumentSchema().parse(raw)
    expect("voice" in parsed).toBe(false)
    const out = repairDocument(parsed, REGISTRY, durationsFor)
    expect(out.warnings).toEqual([])
  })

  it("imports a newer version best-effort, with a banner warning", () => {
    const out = repairDocument(doc({ version: FORMAT_VERSION + 1 }), REGISTRY, durationsFor)
    expect(out.warnings[0].code).toBe("newer-version")
    expect(out.doc.scenes).toHaveLength(1)
  })

  it("imports a v1 file with no newer-version banner (D7: FORMAT_VERSION 2 still opens a v1 document silently)", () => {
    const out = repairDocument(doc({ version: 1 }), REGISTRY, durationsFor)
    expect(out.warnings).toEqual([])
  })

  it("passes a reference URL through untouched — import never fetches or checks one", () => {
    // Spec §11: reference urls are the user's own CDN links, or public media the
    // platform rehosts at generate time — so the schema types them
    // `z.array(z.string())` (never `z.url()`) and repair has no opinion about
    // their shape. GREEN from the start: nothing is implemented for this case,
    // it guards against a future tightening of either stage.
    const parsed = productionDocumentSchema().parse({
      format: FORMAT_ID,
      version: 1,
      scenes: [
        {
          frame: {
            prompt: "p",
            referenceImageUrls: ["not-a-url", "https://r2.example/a.png"],
          },
          motion: { referenceVideoUrls: ["ftp://host/clip.mov"] },
        },
      ],
    })
    const out = repairDocument(parsed, REGISTRY, durationsFor)
    expect(out.warnings).toEqual([])
    expect(out.doc.scenes[0].frame?.referenceImageUrls).toEqual([
      "not-a-url",
      "https://r2.example/a.png",
    ])
    expect(out.doc.scenes[0].motion?.referenceVideoUrls).toEqual([
      "ftp://host/clip.mov",
    ])
  })

  it("repairs the §3 example without a single warning", () => {
    const parsed = productionDocumentSchema().parse(example)
    expect(repairDocument(parsed, REGISTRY, durationsFor).warnings).toEqual([])
  })
})
