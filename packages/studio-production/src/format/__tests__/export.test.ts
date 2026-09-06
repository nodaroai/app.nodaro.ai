import { describe, it, expect } from "vitest"
import { z } from "zod"

import type { ConnectedReference } from "@nodaro/shared"

import { videoDurationOptions } from "../../model-menu"
import {
  EMPTY_EXPORT_NOTICE,
  UNEXPORTED_AUDIO_NOTICE,
  exportProduction,
  hasUnexportedAudio,
  productionFileName,
} from "../export"
import { importProduction } from "../import"
import { renderStrictJsonSchema } from "../json-schema"
import { buildFormatRegistry } from "../registry"
import { FORMAT_VERSION } from "../schema"
import type { StageDraft } from "../../composer-draft-types"
import {
  appendHints,
  directionHints,
  directionWireFields,
} from "../../direction"
import { cameraMovementPicker, LOOK_PICKERS } from "../../look-pickers"
import type { ProductionFolder, Shot } from "../../shot"

/**
 * Export is the inverse map, PER FIELD (spec §5/§7): levers from what the scene
 * currently reads as, prose from what you can see. The one rule with teeth is
 * that a take's stored prompt never comes back out — it is already folded.
 */
const noDrafts = { draftFor: () => undefined }
const FOLDERS: ReadonlyArray<ProductionFolder> = [{ id: "f1", name: "Act 1" }]

const rendered: Shot = {
  id: "s1",
  name: "The chase begins",
  folderId: "f1",
  look: { atmosphereId: ["fog"] },
  still: {
    nodeId: "generate-image-1",
    url: "https://r2.example/a.png",
    provider: "gpt-image-2",
    prompt: "@Natalie sprints down the alley",
    results: [
      {
        url: "https://r2.example/a.png",
        prompt: "@Natalie sprints down the alley",
        provider: "gpt-image-2",
        aspectRatio: "16:9",
        resolution: "2K",
        count: 2,
      },
    ],
    activeIndex: 0,
  },
  clip: {
    nodeId: "generate-video-1",
    url: "https://r2.example/a.mp4",
    provider: "seedance-2",
    prompt: "she sprints toward camera, tracking shot, fog",
    results: [
      {
        url: "https://r2.example/a.mp4",
        provider: "seedance-2",
        prompt: "she sprints toward camera, tracking shot, fog",
        duration: 10,
        aspectRatio: "16:9",
        resolution: "1080p",
      },
    ],
    activeIndex: 0,
  },
  plan: { motion: { cameraMotionId: "tracking-shot" } },
}

const planned: Shot = {
  id: "s2",
  plan: {
    frame: { prompt: "an empty piazza", provider: "gpt-image-2", count: 3 },
    motion: { prompt: "the rain starts", provider: "seedance-2", duration: 10 },
  },
}

describe("export — the framing stage", () => {
  it("takes the levers and prose of the ACTIVE still", () => {
    const doc = exportProduction([rendered], undefined, FOLDERS, "Rain in Rome", noDrafts)
    expect(doc.scenes[0].frame).toEqual({
      prompt: "@Natalie sprints down the alley",
      // The still records no `promptFormat`, so its prose is pre-2026-08 and
      // has the look clauses folded in — stamped, so the importer's plan can
      // gag the pickers instead of folding them a second time (D4).
      promptBaked: true,
      model: "gpt-image-2",
      aspectRatio: "16:9",
      resolution: "2K",
      count: 2,
    })
  })

  it("does NOT stamp a marked result — format 2 prose is raw", () => {
    const marked: Shot = {
      ...rendered,
      still: {
        ...rendered.still!,
        results: [{ ...rendered.still!.results![0], promptFormat: 2 }],
      },
    }
    const doc = exportProduction([marked], undefined, FOLDERS, "T", noDrafts)
    expect(doc.scenes[0].frame?.prompt).toBe("@Natalie sprints down the alley")
    expect("promptBaked" in doc.scenes[0].frame!).toBe(false)
  })

  it("does NOT stamp a draft or a plan — authored prose is raw", () => {
    const doc = exportProduction([planned], undefined, [], "T", noDrafts)
    expect("promptBaked" in doc.scenes[0].frame!).toBe(false)
    const drafted = exportProduction([rendered], undefined, FOLDERS, "T", {
      draftFor: (_id, stage) =>
        stage === "framing"
          ? { text: "a wider alley", negative: "", references: [], extraRefs: [] }
          : undefined,
    })
    expect("promptBaked" in drafted.scenes[0].frame!).toBe(false)
  })

  it("re-exports a plan's own bakedness — the marker cannot be laundered", () => {
    const imported: Shot = {
      id: "s11",
      plan: { frame: { prompt: "an alley, golden hour", promptBaked: true } },
    }
    const doc = exportProduction([imported], undefined, [], "T", noDrafts)
    expect(doc.scenes[0].frame).toEqual({
      prompt: "an alley, golden hour",
      promptBaked: true,
    })
  })

  it("falls back to the plan for a stage that has never rendered", () => {
    const doc = exportProduction([planned], undefined, [], "Untitled", noDrafts)
    expect(doc.scenes[0].frame).toEqual({
      prompt: "an empty piazza",
      model: "gpt-image-2",
      count: 3,
    })
  })

  it("prefers the composer's unsent draft over the plan", () => {
    const draft: StageDraft = {
      text: "an empty piazza at night",
      negative: "",
      references: [],
      extraRefs: [],
    }
    const doc = exportProduction([{ id: "s3", plan: planned.plan }], undefined, [], "T", {
      draftFor: (_id, stage) => (stage === "framing" ? draft : undefined),
    })
    expect(doc.scenes[0].frame?.prompt).toBe("an empty piazza at night")
  })

  it("prefers the plan's prose over what a still recorded", () => {
    // The discriminating case for the ruling below: a scene that has BOTH.
    const doc = exportProduction(
      [
        {
          id: "s10",
          still: {
            nodeId: "generate-image-10",
            url: "https://r2.example/c.png",
            provider: "gpt-image-2",
            prompt: "an empty piazza, golden hour, anamorphic flare",
            results: [
              {
                url: "https://r2.example/c.png",
                prompt: "an empty piazza, golden hour, anamorphic flare",
                provider: "gpt-image-2",
              },
            ],
            activeIndex: 0,
          },
          plan: { frame: { prompt: "an empty piazza" } },
        },
      ],
      undefined,
      [],
      "T",
      noDrafts,
    )
    expect(doc.scenes[0].frame?.prompt).toBe("an empty piazza")
  })

  it("never lets a folded look hint reach prose the plan or draft can supply", () => {
    // The FRAMING half of the fold rule. A LEGACY still (anything generated
    // before the direction channel went server-side) has the catalog clauses
    // baked into its stored prompt, so exporting it beside `look` would fold
    // the same clause twice on the next render. Driven from the fold's OWN
    // output, like the motion case: `directionHints(directionWireFields(…))`
    // is exactly the clause set the server produces, which is what the old
    // client fold baked in.
    const picker = LOOK_PICKERS.find(
      (p) =>
        p.surface !== "video" &&
        p.platformField &&
        p.catalog.some((o) => p.getHint(o.id)),
    )!
    const pickId = picker.catalog.find((o) => picker.getHint(o.id).length > 0)!.id
    const hints = directionHints(
      directionWireFields({ [picker.key]: pickId }, "image"),
      "image",
    )
    expect(hints.length).toBeGreaterThan(0)
    const submitted = appendHints("an empty piazza", hints)
    expect(submitted).toContain(hints[0])
    const still = {
      nodeId: "generate-image-11",
      url: "https://r2.example/d.png",
      provider: "gpt-image-2",
      prompt: submitted,
      results: [
        {
          url: "https://r2.example/d.png",
          prompt: submitted,
          provider: "gpt-image-2",
        },
      ],
      activeIndex: 0,
    }
    const planned = exportProduction(
      [{ id: "s11", look: { [picker.key]: pickId }, still, plan: { frame: { prompt: "an empty piazza" } } }],
      undefined,
      [],
      "T",
      noDrafts,
    )
    expect(planned.scenes[0].frame?.prompt).toBe("an empty piazza")
    expect(planned.scenes[0].frame?.prompt).not.toContain(hints[0])

    // The ACCEPTED asymmetry: with neither a draft nor a plan there is nothing
    // unfolded to export, and folded prose beats no prose. S3 (`promptFormat: 2`
    // raw-prose results) is the full fix (§16); until then this is deliberate.
    const bare = exportProduction(
      [{ id: "s12", look: { [picker.key]: pickId }, still }],
      undefined,
      [],
      "T",
      noDrafts,
    )
    expect(bare.scenes[0].frame?.prompt).toContain(hints[0])
  })

  it("reads a LEGACY collapsed still, whose prompt and model live at still level", () => {
    // `buildStill` drops the results list of a bare lone result, and
    // `stillResults` then yields `[{ url }]` — both would otherwise be lost.
    const doc = exportProduction(
      [
        {
          id: "s13",
          still: {
            nodeId: "generate-image-13",
            url: "https://r2.example/e.png",
            provider: "gpt-image-2",
            prompt: "a shuttered kiosk",
          },
        },
      ],
      undefined,
      [],
      "T",
      noDrafts,
    )
    expect(doc.scenes[0].frame).toEqual({
      prompt: "a shuttered kiosk",
      // A collapsed still is legacy BY DEFINITION — the keep-predicate retains
      // the results list for anything carrying a marker — so this rung is
      // stamped unconditionally.
      promptBaked: true,
      model: "gpt-image-2",
    })
  })

  it("exports the active promptFormat-2 still's subject (D9)", () => {
    const withSubject: Shot = {
      id: "s14",
      still: {
        nodeId: "generate-image-14",
        url: "https://r2.example/f.png",
        provider: "gpt-image-2",
        prompt: "a lone knight",
        results: [
          {
            url: "https://r2.example/f.png",
            prompt: "a lone knight",
            provider: "gpt-image-2",
            promptFormat: 2,
            subject: { hairColor: "auburn" },
          },
        ],
        activeIndex: 0,
      },
    }
    const doc = exportProduction([withSubject], undefined, [], "T", noDrafts)
    expect(doc.scenes[0].frame?.subject).toEqual({ hairColor: "auburn" })
  })

  it("falls back to the plan's subject for a stage that has never rendered (D9)", () => {
    const doc = exportProduction(
      [
        {
          id: "s15",
          plan: { frame: { prompt: "a lone knight", subject: { hairColor: "auburn" } } },
        },
      ],
      undefined,
      [],
      "T",
      noDrafts,
    )
    expect(doc.scenes[0].frame?.subject).toEqual({ hairColor: "auburn" })
  })

  it("the fmt2 result's subject WINS over the plan's, and an empty one falls back (D9)", () => {
    // The two precedence rungs, each with the OTHER side populated so neither
    // passes on an absent field: a rendered fmt2 result that carries a subject
    // beats the plan's, and a fmt2 result that carries NONE falls to the plan.
    const still = (subject?: Record<string, string>) => ({
      nodeId: "generate-image-16",
      url: "https://r2.example/f.png",
      provider: "gpt-image-2",
      prompt: "a lone knight",
      results: [
        {
          url: "https://r2.example/f.png",
          prompt: "a lone knight",
          provider: "gpt-image-2",
          promptFormat: 2 as const,
          ...(subject ? { subject } : {}),
        },
      ],
      activeIndex: 0,
    })
    const planned = { frame: { prompt: "a lone knight", subject: { hairColor: "auburn" } } }

    const wins = exportProduction(
      [{ id: "s16", still: still({ hairColor: "hair-platinum" }), plan: planned }],
      undefined,
      [],
      "T",
      noDrafts,
    )
    expect(wins.scenes[0].frame?.subject).toEqual({ hairColor: "hair-platinum" })

    const falls = exportProduction(
      [{ id: "s17", still: still(), plan: planned }],
      undefined,
      [],
      "T",
      noDrafts,
    )
    expect(falls.scenes[0].frame?.subject).toEqual({ hairColor: "auburn" })
  })

  it("writes the PLATFORM's subject shape — a lone id is a string, on either rung (R35)", () => {
    // A still-authored export used to write `["x"]` where the same selection
    // arriving through the plan wrote `"x"`, so `import(export(p))` differed by
    // shape depending on which rung the subject came from.
    const fromStill = exportProduction(
      [
        {
          id: "s18",
          still: {
            nodeId: "generate-image-18",
            url: "https://r2.example/f.png",
            provider: "gpt-image-2",
            prompt: "a lone knight",
            results: [
              {
                url: "https://r2.example/f.png",
                prompt: "a lone knight",
                provider: "gpt-image-2",
                promptFormat: 2,
                subject: { ethnicity: ["asian-any"], type: "woman" },
              },
            ],
            activeIndex: 0,
          },
        },
      ],
      undefined,
      [],
      "T",
      noDrafts,
    )
    expect(fromStill.scenes[0].frame?.subject).toEqual({
      ethnicity: "asian-any",
      type: "woman",
    })
  })

  it("falls to a RECIPE-only scene's own framing subject, last (R48)", () => {
    // A production imported from a recipe-only bundle has no still and no plan
    // — the recipe is the only rung left that remembers who was in the scene.
    // Below the plan: a recipe is what the scene WAS made from, a plan is what
    // it is meant to be.
    const doc = exportProduction(
      [
        {
          id: "s19",
          recipe: {
            framing: {
              prompt: "a lone knight",
              promptFormat: 2,
              subject: { type: "woman" },
            },
          },
          plan: { frame: { prompt: "a lone knight" } },
        },
      ],
      undefined,
      [],
      "T",
      noDrafts,
    )
    expect(doc.scenes[0].frame?.subject).toEqual({ type: "woman" })

    // …and the PLAN still wins when it has one of its own.
    const planned = exportProduction(
      [
        {
          id: "s20",
          recipe: {
            framing: {
              prompt: "a lone knight",
              promptFormat: 2,
              subject: { type: "woman" },
            },
          },
          plan: { frame: { prompt: "a lone knight", subject: { type: "man" } } },
        },
      ],
      undefined,
      [],
      "T",
      noDrafts,
    )
    expect(planned.scenes[0].frame?.subject).toEqual({ type: "man" })
  })

  it("never carries a legacy still's subject beside its promptBaked prose (D9)", () => {
    // The still's OWN `.subject` (below the result level) is a legacy field the
    // format never reads — only a promptFormat-2 RESULT's subject is trusted.
    const doc = exportProduction([rendered], undefined, FOLDERS, "T", noDrafts)
    expect(doc.scenes[0].frame?.subject).toBeUndefined()
  })
})

describe("export — the motion stage", () => {
  it("NEVER exports a take's stored prompt", () => {
    const doc = exportProduction([rendered], undefined, FOLDERS, "T", noDrafts)
    expect(doc.scenes[0].motion?.prompt).toBeUndefined()
    expect(JSON.stringify(doc)).not.toContain("tracking shot, fog")
  })

  it("never lets a folded picker fragment reach the exported motion prose", () => {
    // Spec §12 names this as its own case: the rule is about the FOLD's OWN
    // output, not about one fixture string. Take a real camera movement whose
    // compact term is non-empty (the `look-pickers` suite's idiom), fold it the
    // way a LEGACY take was folded (the clause the direction channel now emits
    // server-side, which the old client fold wrote into the prompt), and check
    // the exported prose is the UNFOLDED text — folding it again on the next
    // render is the bug.
    const movement = cameraMovementPicker()
    const motionId = movement.catalog.find((m) => movement.getTerm(m.id).length > 0)!.id
    const fragment = directionHints(
      directionWireFields({ [movement.key]: motionId }, "video"),
      "video",
    )[0]
    const submitted = appendHints("she sprints toward camera", [fragment])
    expect(submitted).toContain(fragment)
    const doc = exportProduction(
      [
        {
          id: "s8",
          clip: {
            nodeId: "generate-video-2",
            url: "https://r2.example/b.mp4",
            provider: "seedance-2",
            prompt: submitted,
            results: [
              {
                url: "https://r2.example/b.mp4",
                provider: "seedance-2",
                prompt: submitted,
              },
            ],
            activeIndex: 0,
          },
          plan: {
            motion: { prompt: "she sprints toward camera", cameraMotionId: motionId },
          },
        },
      ],
      undefined,
      [],
      "T",
      noDrafts,
    )
    expect(doc.scenes[0].motion?.prompt).toBe("she sprints toward camera")
    expect(doc.scenes[0].motion?.prompt).not.toContain(fragment)
    expect(doc.scenes[0].motion?.cameraMotionId).toBe(motionId)
  })

  it("takes the take's levers and the plan's camera movement", () => {
    const doc = exportProduction([rendered], undefined, FOLDERS, "T", noDrafts)
    expect(doc.scenes[0].motion).toEqual({
      model: "seedance-2",
      aspectRatio: "16:9",
      resolution: "1080p",
      duration: 10,
      cameraMotionId: "tracking-shot",
    })
  })

  it("exports the plan's directing input mode — no result records it, so a rendered scene reads it from the plan too (D3)", () => {
    const doc = exportProduction(
      [{ ...rendered, plan: { motion: { cameraMotionId: "tracking-shot", input: "start" } } }],
      undefined,
      FOLDERS,
      "T",
      noDrafts,
    )
    expect(doc.scenes[0].motion?.input).toBe("start")
  })

  it("exports a planned (never-rendered) scene's directing input mode (D3)", () => {
    const doc = exportProduction(
      [{ ...planned, plan: { ...planned.plan, motion: { ...planned.plan!.motion, input: "text" } } }],
      undefined,
      FOLDERS,
      "T",
      noDrafts,
    )
    expect(doc.scenes[0].motion?.input).toBe("text")
  })

  it("never writes a motion prompt beside shots", () => {
    const doc = exportProduction(
      [
        {
          id: "s4",
          beats: [{ id: "b1", seconds: 4, text: "she runs" }],
          plan: { motion: { prompt: "she runs the whole scene" } },
        },
      ],
      undefined,
      [],
      "T",
      noDrafts,
    )
    expect(doc.scenes[0].motion?.prompt).toBeUndefined()
    expect(doc.scenes[0].shots).toHaveLength(1)
  })

  it("gives the scene's generic prompt its OWN key, beside the shots it stands over", () => {
    // `motion.prompt` is the wrong seat twice over: repair DELETES it when the
    // scene has shots, and the scene prompt is exactly the prose that stands
    // over shots. It is read straight off the scene, like `beats`.
    const doc = exportProduction(
      [
        {
          id: "s5b",
          scenePrompt: "  A rain-soaked rooftop chase.  ",
          beats: [{ id: "b1", seconds: 4, text: "she runs" }],
        },
      ],
      undefined,
      [],
      "T",
      noDrafts,
    )
    expect(doc.scenes[0].motion?.scenePrompt).toBe("A rain-soaked rooftop chase.")
    expect(doc.scenes[0].motion?.prompt).toBeUndefined()
    expect(doc.scenes[0].shots).toHaveLength(1)
  })

  it("omits a blank scene prompt, and gives a scene-prompt-only scene its stage", () => {
    const blank = exportProduction(
      [{ id: "s5c", scenePrompt: "   ", plan: { frame: { prompt: "an alley" } } }],
      undefined,
      [],
      "T",
      noDrafts,
    )
    expect(blank.scenes[0].motion).toBeUndefined()
    // A scene whose ONLY decision is its generic prompt still carries a stage,
    // so the document stays valid (§3's at-least-one rule).
    const only = exportProduction(
      [{ id: "s5d", scenePrompt: "A rain-soaked rooftop chase." }],
      undefined,
      [],
      "T",
      noDrafts,
    )
    expect(only.scenes[0].motion).toEqual({
      scenePrompt: "A rain-soaked rooftop chase.",
    })
    expect(only.scenes[0].frame).toBeUndefined()
  })

  it("carries the scene's three reference channels", () => {
    const doc = exportProduction(
      [
        {
          id: "s5",
          directingReferenceUrls: ["https://r2.example/r.png"],
          directingReferenceVideoUrls: ["https://r2.example/r.mp4"],
          directingReferenceAudioUrls: ["https://r2.example/r.mp3"],
          plan: { motion: { prompt: "she runs" } },
        },
      ],
      undefined,
      [],
      "T",
      noDrafts,
    )
    expect(doc.scenes[0].motion).toEqual({
      prompt: "she runs",
      referenceImageUrls: ["https://r2.example/r.png"],
      referenceVideoUrls: ["https://r2.example/r.mp4"],
      referenceAudioUrls: ["https://r2.example/r.mp3"],
    })
  })

  it("exports a shot-less scene's directions from the draft, else the plan", () => {
    const shot: Shot = {
      id: "s5g",
      plan: { motion: { prompt: "she runs", directions: [{ kind: "sfx", text: "wind" }] } },
    }
    const planOnly = exportProduction([shot], undefined, [], "T", noDrafts)
    expect(planOnly.scenes[0].motion?.audio).toEqual([{ mode: "sfx", content: "wind" }])

    // A MIXED rung: the draft's text is empty, so the prose falls back to the
    // plan's (`motionPrompt`'s own rung order) — but the draft's directions
    // are non-empty, so the cues come from the draft. Prose and cues are
    // allowed to come from two different rungs at once; each field decides on
    // its own.
    const draft: StageDraft = {
      text: "",
      negative: "",
      references: [],
      directions: [{ kind: "music", text: "drums" }],
    }
    const withDraft = exportProduction([shot], undefined, [], "T", {
      draftFor: (_id, stage) => (stage === "directing" ? draft : undefined),
    })
    expect(withDraft.scenes[0].motion?.prompt).toBe("she runs")
    expect(withDraft.scenes[0].motion?.audio).toEqual([{ mode: "music", content: "drums" }])
  })

  it("carries no motion audio for a scene with shots — the shots carry their own", () => {
    const doc = exportProduction(
      [
        {
          id: "s5h",
          beats: [{ id: "b1", seconds: 4, text: "she runs" }],
          plan: { motion: { directions: [{ kind: "sfx", text: "wind" }] } },
        },
      ],
      undefined,
      [],
      "T",
      noDrafts,
    )
    expect(doc.scenes[0].motion).toBeUndefined()
  })
})

describe("export — the document", () => {
  it("writes the shots with their picks, transition and effect", () => {
    const doc = exportProduction(
      [
        {
          id: "s6",
          beats: [
            {
              id: "b1",
              seconds: 4,
              label: "Sprint",
              text: "she sprints",
              picks: { framingId: "wide-shot" },
              transition: { id: "cross-dissolve" },
              characterFx: { id: "werewolf", intensity: "crazy" },
            },
          ],
        },
      ],
      undefined,
      [],
      "T",
      noDrafts,
    )
    expect(doc.scenes[0].shots).toEqual([
      {
        seconds: 4,
        label: "Sprint",
        text: "she sprints",
        picks: { framingId: "wide-shot" },
        transition: { id: "cross-dissolve" },
        characterFx: { id: "werewolf", intensity: "crazy" },
      },
    ])
  })

  it("writes a beat's directions as audio, prose verbatim and speech fields kept", () => {
    const doc = exportProduction(
      [
        {
          id: "s6b",
          beats: [
            {
              id: "b1",
              seconds: 4,
              text: "she runs [wind] [Go!]",
              directions: [
                { kind: "sfx", text: "wind" },
                { kind: "speech", text: "Go!", speaker: "Natalie", voice: "urgent" },
              ],
            },
          ],
        },
      ],
      undefined,
      [],
      "T",
      noDrafts,
    )
    expect(doc.scenes[0].shots).toEqual([
      {
        seconds: 4,
        text: "she runs [wind] [Go!]",
        audio: [
          { mode: "sfx", content: "wind" },
          { mode: "speech", content: "Go!", voice: "urgent", speaker: "Natalie" },
        ],
      },
    ])
  })

  it("writes folders as names and the film look as ids", () => {
    const doc = exportProduction(
      [rendered],
      { cameraFormatId: "arri-alexa" },
      FOLDERS,
      "Rain in Rome",
      noDrafts,
    )
    expect(doc).toMatchObject({
      format: "nodaro-studio-production",
      version: FORMAT_VERSION,
      title: "Rain in Rome",
      film: { cameraFormatId: "arri-alexa" },
      folders: ["Act 1"],
    })
    expect(doc.scenes[0].folder).toBe("Act 1")
    expect(doc.scenes[0].look).toEqual({ atmosphereId: ["fog"] })
  })

  it("writes brief from the storyboard's own brief, trimmed (D6)", () => {
    const doc = exportProduction([rendered], undefined, [], "T", {
      draftFor: () => undefined,
      storyboard: { brief: "  A rain-soaked chase through Rome.  " },
    })
    expect(doc.brief).toBe("A rain-soaked chase through Rome.")
  })

  it("omits brief when the production has no storyboard, or a blank one", () => {
    const noStoryboard = exportProduction([rendered], undefined, [], "T", noDrafts)
    expect("brief" in noStoryboard).toBe(false)
    const blank = exportProduction([rendered], undefined, [], "T", {
      draftFor: () => undefined,
      storyboard: { brief: "   " },
    })
    expect("brief" in blank).toBe(false)
    const noBrief = exportProduction([rendered], undefined, [], "T", {
      draftFor: () => undefined,
      storyboard: { on: true },
    })
    expect("brief" in noBrief).toBe(false)
  })

  it("omits empty values", () => {
    const doc = exportProduction([rendered], undefined, FOLDERS, "T", noDrafts)
    expect("negativePrompt" in (doc.scenes[0].frame ?? {})).toBe(false)
    expect("referenceImageUrls" in (doc.scenes[0].frame ?? {})).toBe(false)
  })

  it("writes the scene's own END transition, straight off the scene", () => {
    // Read like `beats` and `scenePrompt` — off the SHOT, never a plan or a
    // take: it is authoring state the scene itself owns.
    const doc = exportProduction(
      [
        {
          id: "s13b",
          beats: [{ id: "b1", seconds: 4, text: "she sprints" }],
          endTransition: { id: "fade-to-black", position: "end", duration: "short" },
        },
      ],
      undefined,
      [],
      "T",
      noDrafts,
    )
    expect(doc.scenes[0].motion?.endTransition).toEqual({
      id: "fade-to-black",
      position: "end",
      duration: "short",
    })
  })

  it("omits an END transition sitting on the catalog's auto row", () => {
    const doc = exportProduction(
      [{ id: "s13c", endTransition: { id: "auto", duration: "short" } }],
      undefined,
      [],
      "T",
      noDrafts,
    )
    expect("endTransition" in (doc.scenes[0].motion ?? {})).toBe(false)
  })

  it("omits a lever node sitting on the catalog's auto row", () => {
    // `auto` is "the model decides" (`transitionIsSet`) — no decision to carry,
    // and an exported one would inflate the recipient's transition count. The
    // levers go with it: a lever without an effect is nothing.
    const doc = exportProduction(
      [
        {
          id: "s14",
          beats: [
            {
              id: "b1",
              seconds: 4,
              text: "she sprints",
              transition: { id: "auto", duration: "short" },
              characterFx: { id: "auto", intensity: "crazy" },
            },
          ],
        },
      ],
      undefined,
      [],
      "T",
      noDrafts,
    )
    expect(doc.scenes[0].shots).toEqual([{ seconds: 4, text: "she sprints" }])
  })

  it("omits a look whose only pick is an empty list", () => {
    const doc = exportProduction(
      [{ id: "s15", look: { atmosphereId: [] }, plan: { frame: { prompt: "an alley" } } }],
      { colorLookId: [] },
      [],
      "T",
      noDrafts,
    )
    expect("look" in doc.scenes[0]).toBe(false)
    expect("film" in doc).toBe(false)
  })

  it("gives an untouched placeholder scene a stage, so the document stays valid", () => {
    const doc = exportProduction([{ id: "s7", name: "Later" }], undefined, [], "T", noDrafts)
    expect(doc.scenes[0]).toEqual({ name: "Later", frame: { prompt: "" } })
  })
})

describe("export — the voice stage (D4)", () => {
  it("exports the plan's voice for a scene that has not rendered one", () => {
    const doc = exportProduction(
      [
        {
          id: "s16",
          plan: {
            frame: { prompt: "an alley" },
            voice: { text: "Go now", casting: "male, urgent", voiceId: "rachel-1" },
          },
        },
      ],
      undefined,
      [],
      "T",
      noDrafts,
    )
    expect(doc.scenes[0].voice).toEqual({
      text: "Go now",
      casting: "male, urgent",
      voiceId: "rachel-1",
    })
  })

  it("prefers a RENDERED voiceover over the plan, strips its result url, and keeps the plan's casting note (R38-4)", () => {
    const doc = exportProduction(
      [
        {
          id: "s17",
          // `ShotVoice` never carries `casting` (it's a PlanVoice-only field) —
          // the plan is the only place it can have come from, and it must
          // survive even though a real voiceover has since rendered: a
          // recipient re-importing into a library that lacks `rachel-1` still
          // needs to know who was cast.
          plan: {
            frame: { prompt: "an alley" },
            voice: { text: "Old plan line", casting: "male, urgent" },
          },
          voice: {
            url: "https://r2.example/v.mp3",
            text: "Go now",
            voiceId: "rachel-1",
            voiceType: "premade",
            ttsProvider: "elevenlabs-v3",
            model: "eleven_v3",
            delivery: { speed: 1.1, stability: 0.6 },
          },
        },
      ],
      undefined,
      [],
      "T",
      noDrafts,
    )
    expect(doc.scenes[0].voice).toEqual({
      text: "Go now",
      casting: "male, urgent",
      voiceId: "rachel-1",
      voiceType: "premade",
      ttsProvider: "elevenlabs-v3",
      model: "eleven_v3",
      delivery: { speed: 1.1, stability: 0.6 },
    })
    expect("url" in (doc.scenes[0].voice ?? {})).toBe(false)
  })

  it("carries no casting on a rendered voiceover when the plan has none", () => {
    const doc = exportProduction(
      [
        {
          id: "s17b",
          plan: { frame: { prompt: "an alley" } },
          voice: { url: "https://r2.example/v.mp3", text: "Go now" },
        },
      ],
      undefined,
      [],
      "T",
      noDrafts,
    )
    expect("casting" in (doc.scenes[0].voice ?? {})).toBe(false)
  })

  it("omits voice entirely when the scene has neither a plan nor a rendered one", () => {
    const doc = exportProduction(
      [{ id: "s18", plan: { frame: { prompt: "an alley" } } }],
      undefined,
      [],
      "T",
      noDrafts,
    )
    expect("voice" in doc.scenes[0]).toBe(false)
  })
})

describe("export — the soundtrack (D5)", () => {
  const oneScene = [{ id: "s1", plan: { frame: { prompt: "an alley" } } }]

  it("exports the RENDERED soundtrack's prompt and duration, no url or provider", () => {
    const doc = exportProduction(oneScene, undefined, [], "T", {
      draftFor: () => undefined,
      music: {
        url: "https://r2.example/m.mp3",
        prompt: "ambient pads",
        duration: 20,
        provider: "suno",
      },
    })
    expect(doc.music).toEqual({ prompt: "ambient pads", duration: 20 })
  })

  it("exports the PLAN's prompt, duration and flattened selections when there is no rendered track", () => {
    const doc = exportProduction(oneScene, undefined, [], "T", {
      draftFor: () => undefined,
      musicPlan: {
        prompt: "a driving synth pulse",
        duration: 20,
        selections: {
          vocals: "vocals",
          vocalGender: "female",
          instruments: ["synth", "drums"],
          genre: "synthwave",
          mood: "energetic",
          singingStyle: "powerful",
          language: "english",
        },
      },
    })
    expect(doc.music).toEqual({
      prompt: "a driving synth pulse",
      duration: 20,
      vocals: "vocals",
      vocalGender: "female",
      instruments: ["synth", "drums"],
      genre: "synthwave",
      mood: "energetic",
      singingStyle: "powerful",
      language: "english",
    })
  })

  it("prefers the RENDERED track's PROSE over the plan's, same as voice", () => {
    const doc = exportProduction(oneScene, undefined, [], "T", {
      draftFor: () => undefined,
      music: { url: "https://r2.example/m.mp3", prompt: "the rendered one" },
      musicPlan: { prompt: "the plan, ignored here" },
    })
    expect(doc.music).toEqual({ prompt: "the rendered one" })
  })

  it("MERGES the plan's pickers with a rendered track's prompt and duration (R44)", () => {
    // A rendered `ProductionMusic` has no `selections` field at all, so the
    // pickers survive a render only if they come from the plan beside it.
    // Discarding them meant pressing Generate silently cost the exported file
    // the genre, mood and instruments the author had chosen.
    const doc = exportProduction(oneScene, undefined, [], "T", {
      draftFor: () => undefined,
      music: {
        url: "https://r2.example/m.mp3",
        prompt: "the rendered one",
        duration: 25,
        provider: "suno",
      },
      musicPlan: {
        prompt: "the plan's own prose, not exported",
        duration: 20,
        selections: {
          vocals: "vocals",
          vocalGender: "female",
          instruments: ["synth"],
          genre: "synthwave",
          mood: "energetic",
          singingStyle: "powerful",
          language: "english",
        },
      },
    })
    expect(doc.music).toEqual({
      // PROSE from the render…
      prompt: "the rendered one",
      duration: 25,
      // …PICKERS from the plan.
      vocals: "vocals",
      vocalGender: "female",
      instruments: ["synth"],
      genre: "synthwave",
      mood: "energetic",
      singingStyle: "powerful",
      language: "english",
    })
    // The result-only fields never travel (D8).
    expect("url" in (doc.music ?? {})).toBe(false)
    expect("provider" in (doc.music ?? {})).toBe(false)
  })

  it("exports the plan's prompt alone when it carries no selections", () => {
    const doc = exportProduction(oneScene, undefined, [], "T", {
      draftFor: () => undefined,
      musicPlan: { prompt: "strings" },
    })
    expect(doc.music).toEqual({ prompt: "strings" })
  })

  it("omits music entirely when the production carries neither a track nor a plan", () => {
    const doc = exportProduction(oneScene, undefined, [], "T", noDrafts)
    expect("music" in doc).toBe(false)
  })

  // Fix round 2, item 3: `toPlanMusic` (import.ts) fills `vocals:
  // "instrumental"` / `vocalGender: "any"` when the document omits them —
  // lossless, since re-importing without them fills the SAME defaults. So
  // exporting them back out when the author never picked them invents a
  // decision, the same class of bug `AUTO_ID` (TRANSITION_AUTO_ID) exists to
  // avoid for transitions. A prompt-only plan must export prompt-only.
  it("omits vocals/vocalGender when the plan's selections never named them (no invented decision)", () => {
    const doc = exportProduction(oneScene, undefined, [], "T", {
      draftFor: () => undefined,
      musicPlan: {
        prompt: "ambient pads",
        selections: { vocals: "instrumental", vocalGender: "any", instruments: [] },
      },
    })
    expect(doc.music).toEqual({ prompt: "ambient pads" })
  })

  it("keeps vocals/vocalGender when the author actually picked with-vocals + a gender", () => {
    const doc = exportProduction(oneScene, undefined, [], "T", {
      draftFor: () => undefined,
      musicPlan: {
        prompt: "a duet",
        selections: {
          vocals: "vocals",
          vocalGender: "female",
          instruments: [],
        },
      },
    })
    expect(doc.music).toEqual({ prompt: "a duet", vocals: "vocals", vocalGender: "female" })
  })

  it("keeps vocals:\"vocals\" but omits vocalGender when the author left the gender at Any", () => {
    const doc = exportProduction(oneScene, undefined, [], "T", {
      draftFor: () => undefined,
      musicPlan: {
        prompt: "a duet",
        selections: { vocals: "vocals", vocalGender: "any", instruments: [] },
      },
    })
    expect(doc.music).toEqual({ prompt: "a duet", vocals: "vocals" })
  })

  it("a prompt-only document round-trips byte-equal through export → import → export", () => {
    const importOptions = {
      candidates: [],
      durationsFor: (model: string) => videoDurationOptions(model).map((d) => d.value),
    }
    const doc = exportProduction(oneScene, undefined, [], "T", {
      draftFor: () => undefined,
      musicPlan: {
        prompt: "ambient pads",
        selections: { vocals: "instrumental", vocalGender: "any", instruments: [] },
      },
    })
    expect(doc.music).toEqual({ prompt: "ambient pads" })
    const reimported = importProduction(doc, importOptions)
    expect(reimported.ok && reimported.music).toEqual({
      prompt: "ambient pads",
      selections: { vocals: "instrumental", vocalGender: "any", instruments: [] },
    })
    const reexported = exportProduction(oneScene, undefined, [], "T", {
      draftFor: () => undefined,
      musicPlan: reimported.ok ? reimported.music : undefined,
    })
    expect(reexported.music).toEqual(doc.music)
  })
})

/**
 * The T17 review carry, pinned deliberately: export writes what the PRODUCTION
 * holds, not what the published contract can name. A scene whose active still
 * was made on a since-retired model exports that id verbatim — the alternative
 * (dropping it) would silently rewrite the plan on its way out. The asymmetry
 * that follows is the format's design (D11 — one lenient importer, one strict
 * published schema): the STRICT schema's catalog enums refuse the file, and the
 * lenient importer still takes it, repairing the id away with a warning.
 */
const retiredStill = (provider: string): Shot => ({
  id: "s9",
  still: {
    nodeId: "generate-image-9",
    url: "https://r2.example/r.png",
    provider,
    prompt: "a shuttered kiosk",
    results: [
      { url: "https://r2.example/r.png", prompt: "a shuttered kiosk", provider },
    ],
    activeIndex: 0,
  },
})

describe("export — a model the strict schema no longer names", () => {
  it("exports it anyway; strict refuses the file, the lenient importer takes it", () => {
    const doc = exportProduction([retiredStill("retired-model-x")], undefined, [], "T", noDrafts)
    expect(doc.scenes[0].frame?.model).toBe("retired-model-x")
    const strict = z.fromJSONSchema(renderStrictJsonSchema(buildFormatRegistry()))
    // The CONTROL leg: the identical production on a live catalog id passes,
    // and the failing case's issue names `model` — so this can never rot into
    // asserting some unrelated strict rejection.
    const live = exportProduction(
      [{ ...retiredStill("gpt-image-2") }],
      undefined,
      [],
      "T",
      noDrafts,
    )
    const parsedLive = strict.safeParse(live)
    expect(parsedLive.success, JSON.stringify(parsedLive.error?.issues)).toBe(true)
    const parsed = strict.safeParse(doc)
    expect(parsed.success).toBe(false)
    expect(JSON.stringify(parsed.error?.issues)).toContain("model")
    const back = importProduction(doc, {
      candidates: [],
      durationsFor: (model) => videoDurationOptions(model).map((d) => d.value),
    })
    expect(back.ok).toBe(true)
  })
})

const natalie: ConnectedReference = {
  id: "char-natalie",
  defaultName: "Natalie",
  source: "wired-character",
  url: "https://r2.example/natalie.png",
}
const alley: ConnectedReference = {
  id: "loc-alley",
  defaultName: "Alley",
  source: "wired-location",
  url: "https://r2.example/alley.png",
}
const manualImage: ConnectedReference = {
  id: "img-1",
  defaultName: "Image 1",
  source: "wired-image",
  url: "https://r2.example/1.png",
}

describe("export — the derived cast", () => {
  it("names the entities the exported prose actually mentions", () => {
    const doc = exportProduction(
      [
        {
          id: "s1",
          plan: {
            frame: { prompt: "@Natalie in the @Alley", references: [natalie, alley] },
          },
        },
      ],
      undefined,
      [],
      "T",
      noDrafts,
    )
    expect(doc.cast).toEqual([
      { kind: "character", name: "Natalie", imageUrl: "https://r2.example/natalie.png" },
      { kind: "location", name: "Alley", imageUrl: "https://r2.example/alley.png" },
    ])
  })

  it("drops a chip whose @Name was edited out of the prose", () => {
    const doc = exportProduction(
      [{ id: "s2", plan: { frame: { prompt: "an empty alley", references: [natalie] } } }],
      undefined,
      [],
      "T",
      noDrafts,
    )
    expect(doc.cast).toBeUndefined()
  })

  it("reads the scene's generic prompt — a name may be said only there", () => {
    const doc = exportProduction(
      [
        {
          id: "s2b",
          scenePrompt: "The whole clip follows @Natalie.",
          plan: { frame: { prompt: "an empty alley", references: [natalie] } },
        },
      ],
      undefined,
      [],
      "T",
      noDrafts,
    )
    expect(doc.cast).toEqual([
      { kind: "character", name: "Natalie", imageUrl: "https://r2.example/natalie.png" },
    ])
  })

  it("does not advertise a manual image chip as cast", () => {
    const doc = exportProduction(
      [
        {
          id: "s3",
          plan: { frame: { prompt: "@Image 1 as the backdrop", references: [manualImage] } },
        },
      ],
      undefined,
      [],
      "T",
      noDrafts,
    )
    expect(doc.cast).toBeUndefined()
  })

  it("does not count a chip whose name only PREFIXES a longer word", () => {
    // `recoverTypedMentions`' boundary rule, mirrored: "@Alleyway" is not the
    // chip called "Alley" — advertising it would ask the recipient to create an
    // entity the prose never mentions.
    const doc = exportProduction(
      [
        {
          id: "s16",
          plan: { frame: { prompt: "down the @Alleyway", references: [alley] } },
        },
      ],
      undefined,
      [],
      "T",
      noDrafts,
    )
    expect(doc.cast).toBeUndefined()
    // The same chip, correctly terminated, still counts.
    const named = exportProduction(
      [{ id: "s17", plan: { frame: { prompt: "down the @Alley, fast", references: [alley] } } }],
      undefined,
      [],
      "T",
      noDrafts,
    )
    expect(named.cast).toEqual([
      { kind: "location", name: "Alley", imageUrl: "https://r2.example/alley.png" },
    ])
  })

  it("dedupes a cast member named in many scenes and shots", () => {
    const doc = exportProduction(
      [
        { id: "s4", plan: { frame: { prompt: "@Natalie waits", references: [natalie] } } },
        {
          id: "s5",
          beats: [
            { id: "b1", seconds: 4, text: "@Natalie runs", references: [natalie] },
          ],
        },
      ],
      undefined,
      [],
      "T",
      noDrafts,
    )
    expect(doc.cast).toEqual([
      { kind: "character", name: "Natalie", imageUrl: "https://r2.example/natalie.png" },
    ])
  })

  it("reads a bound reference's url as the cast entry's imageUrl", () => {
    const doc = exportProduction(
      [
        {
          id: "s18",
          still: {
            nodeId: "generate-image-18",
            url: "https://r2.example/s18.png",
            provider: "gpt-image-2",
            prompt: "@Natalie waits",
            results: [
              {
                url: "https://r2.example/s18.png",
                prompt: "@Natalie waits",
                references: [natalie],
              },
            ],
            activeIndex: 0,
          },
        },
      ],
      undefined,
      [],
      "T",
      noDrafts,
    )
    expect(doc.cast).toEqual([
      { kind: "character", name: "Natalie", imageUrl: "https://r2.example/natalie.png" },
    ])
  })

  it("never takes the actor's image from a cast-look VIEW chip", () => {
    // A view chip is a POSE — one specific angle pinned for this scene (D6f),
    // which `applyCastLook` marks `isExtraRef` and (for a character) gives a
    // `variantSlug`. The enroller skips them for the same reason, and a
    // recipient told to create the actor FROM one would get a library row whose
    // canonical image is a back-of-the-head shot. The row still ships — the
    // recipient is told who is missing, just not from what.
    const back: ConnectedReference = {
      ...natalie,
      url: "https://r2.example/natalie-back.png",
      variantSlug: "angles:back",
      variantDisplayName: "back",
      isExtraRef: true,
    }
    const doc = exportProduction(
      [{ id: "s20", plan: { frame: { prompt: "@Natalie waits", references: [back] } } }],
      undefined,
      [],
      "T",
      noDrafts,
    )
    expect(doc.cast).toEqual([{ kind: "character", name: "Natalie" }])
  })

  it("prefers the CANONICAL chip's image when both spellings are in the slice", () => {
    // Scene order can put the pinned view first; the actor's own image is the
    // one the cast row wants, wherever it turns up.
    const back: ConnectedReference = {
      ...natalie,
      url: "https://r2.example/natalie-back.png",
      variantSlug: "angles:back",
      isExtraRef: true,
    }
    const doc = exportProduction(
      [
        { id: "s21", plan: { frame: { prompt: "@Natalie waits", references: [back] } } },
        { id: "s22", plan: { frame: { prompt: "@Natalie runs", references: [natalie] } } },
      ],
      undefined,
      [],
      "T",
      noDrafts,
    )
    expect(doc.cast).toEqual([
      { kind: "character", name: "Natalie", imageUrl: "https://r2.example/natalie.png" },
    ])
  })

  it("omits imageUrl for a bound reference with no url", () => {
    const noImage: ConnectedReference = { ...natalie, url: "" }
    const doc = exportProduction(
      [{ id: "s19", plan: { frame: { prompt: "@Natalie waits", references: [noImage] } } }],
      undefined,
      [],
      "T",
      noDrafts,
    )
    expect(doc.cast).toEqual([{ kind: "character", name: "Natalie" }])
  })
})

describe("export — the download", () => {
  it("names the file after the production", () => {
    expect(productionFileName("Rain in Rome")).toBe("Rain in Rome.studio.json")
  })

  it("strips path-hostile characters and falls back when nothing survives", () => {
    expect(productionFileName("A/B: the sequel")).toBe("A-B- the sequel.studio.json")
    expect(productionFileName("///")).toBe("production.studio.json")
  })

  it("strips edge dots, which hide a file or run into the extension", () => {
    expect(productionFileName(".hidden")).toBe("hidden.studio.json")
    expect(productionFileName("Rain in Rome.")).toBe("Rain in Rome.studio.json")
    expect(productionFileName("...")).toBe("production.studio.json")
  })

  it("caps the stem, and never cuts it onto a trailing dash", () => {
    expect(productionFileName("x".repeat(400))).toBe(`${"x".repeat(120)}.studio.json`)
    // The cut lands exactly on the dash — the edge-strip runs after it.
    expect(productionFileName(`${"a".repeat(119)}-b`)).toBe(`${"a".repeat(119)}.studio.json`)
  })

  it("flags a production carrying audio the plan format does not take", () => {
    expect(hasUnexportedAudio([{ id: "s1" }], undefined)).toBe(false)
    expect(
      hasUnexportedAudio(
        [{ id: "s1", voice: { url: "https://r2.example/v.mp3", text: "hi" } }],
        undefined,
      ),
    ).toBe(true)
    expect(
      hasUnexportedAudio([{ id: "s1" }], {
        url: "https://r2.example/m.mp3",
        prompt: "strings",
      }),
    ).toBe(true)
  })

  it("carries ONE notice sentence for both download paths", () => {
    expect(UNEXPORTED_AUDIO_NOTICE).toMatch(/voiceover/i)
    expect(UNEXPORTED_AUDIO_NOTICE).toMatch(/soundtrack/i)
  })

  it("carries ONE refusal sentence for a production with no scenes", () => {
    // The editor's Export JSON and the dashboard card's download both refuse an
    // empty production with THIS sentence (`scenes` is `.min(1)` below), so the
    // wording is pinned here rather than in either call site.
    expect(EMPTY_EXPORT_NOTICE).toBe("Nothing to export yet — add a scene first.")
    expect(EMPTY_EXPORT_NOTICE).toMatch(/add a scene/i)
    expect(EMPTY_EXPORT_NOTICE.endsWith(".")).toBe(true)
  })
})
