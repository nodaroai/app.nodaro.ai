import { describe, it, expect } from "vitest"
import { z } from "zod"

import { EXAMPLE_LIBRARY } from "../fixtures/library"
import example from "../fixtures/example.json"
import { exportProduction } from "../export"
import { importProduction } from "../import"
import { renderStrictJsonSchema } from "../json-schema"
import { buildFormatRegistry } from "../registry"
import { videoDurationOptions } from "../../model-menu"
import type { ProductionFolder, Shot } from "../../shot"

/**
 * `import(export(p))` equals `p` on every MAPPED field, with no warnings —
 * EXCEPT the references, which are re-derived from the prose (spec §7). The ids
 * are re-minted by design (D3), and folders travel as names, so the comparison
 * normalises both.
 *
 * The production's prose names Natalie by her role TOKEN because that is the
 * canonical persisted spelling (C6) and the importer now rewrites a declared
 * cast name to it (D41): a production written `@Natalie` round-trips to
 * `@natalie`, which is pinned where the rule lives
 * (`import-canonical-mentions.test.ts`) rather than by weakening this equality.
 */
const REGISTRY = buildFormatRegistry()
const options = {
  candidates: EXAMPLE_LIBRARY,
  durationsFor: (model: string) => videoDurationOptions(model).map((d) => d.value),
  registry: REGISTRY,
}
const noDrafts = { draftFor: () => undefined }
const natalie = EXAMPLE_LIBRARY[0].toConnectedReference()

const FOLDERS: ReadonlyArray<ProductionFolder> = [{ id: "f1", name: "Act 1" }]
const FILM = { cameraFormatId: "arri-alexa", colorLookId: "teal-orange" }
const PRODUCTION: ReadonlyArray<Shot> = [
  {
    id: "s1",
    name: "The chase begins",
    folderId: "f1",
    look: { "lighting-time-of-day": "golden-hour", atmosphereId: ["fog", "light-rain"] },
    directingReferenceUrls: ["https://r2.example/ref.png"],
    scenePrompt: "A rain-soaked rooftop chase — no dialogue, no cuts to the SUV.",
    beats: [
      {
        id: "b1",
        seconds: 4,
        label: "Sprint",
        text: "@natalie sprints toward camera",
        picks: { framingId: "wide-shot" },
        transition: { id: "cross-dissolve" },
        references: [natalie],
      },
      {
        id: "b2",
        seconds: 6,
        text: "the SUV swerves",
        characterFx: { id: "werewolf", position: "start", intensity: "crazy" },
      },
    ],
    plan: {
      frame: {
        prompt: "@natalie sprints down a narrow Roman alley",
        provider: "gpt-image-2",
        aspectRatio: "16:9",
        resolution: "2K",
        count: 2,
        references: [natalie],
        // A MULTI dimension holding a single pick (`ethnicity`, cap 2) beside a
        // single-pick one (`type`): the canonical PLATFORM shape is a bare
        // string for both (R35), so this pins that the export writes it and
        // repair reads it back unchanged rather than as `["asian-any"]`.
        subject: { ethnicity: "asian-any", type: "woman" },
      },
      motion: {
        provider: "seedance-2",
        aspectRatio: "16:9",
        resolution: "1080p",
        duration: 10,
        cameraMotionId: "tracking-shot",
      },
    },
  },
]

/** The mapped state with the two things that are re-minted by design removed:
 *  ids, and the folder reference (folders travel as NAMES).
 *
 *  `folderId` and `beats` are written on BOTH sides, so the `toStrictEqual`
 *  below still applies its strictness to everything in the `...shot` spread:
 *  the only keys this helper can hide are the three it names. */
const normalize = (
  shots: ReadonlyArray<Shot>,
  folders: ReadonlyArray<ProductionFolder>,
) =>
  shots.map((shot) => ({
    ...shot,
    id: "",
    folderId: shot.folderId
      ? folders.find((f) => f.id === shot.folderId)?.name
      : undefined,
    beats: shot.beats?.map((beat) => ({ ...beat, id: "" })),
  }))

describe("round trip", () => {
  it("import(export(p)) is p on every mapped field, with no warnings", () => {
    const doc = exportProduction(PRODUCTION, FILM, FOLDERS, "Rain in Rome", noDrafts)
    const out = importProduction(doc, options)
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.warnings).toEqual([])
    expect(out.title).toBe("Rain in Rome")
    expect(out.film).toStrictEqual(FILM)
    expect(normalize(out.shots, out.folders)).toStrictEqual(normalize(PRODUCTION, FOLDERS))
    // Named on its own: the scene's generic prompt is the one mapped field that
    // travels in a stage it does not belong to (`motion.scenePrompt`, because
    // the scene has no other document seat), so a set-equality that happened to
    // pass on an absent field on BOTH sides would say nothing.
    expect(out.shots[0].scenePrompt).toBe(PRODUCTION[0].scenePrompt)
  })

  it("is idempotent for the §3 example: import → export → import lands the same state", () => {
    const first = importProduction(example, options)
    expect(first.ok).toBe(true)
    if (!first.ok) return
    const again = importProduction(
      exportProduction(
        first.shots,
        first.film,
        first.folders,
        first.title ?? "Untitled",
        {
          ...noDrafts,
          storyboard: first.brief ? { brief: first.brief } : undefined,
          musicPlan: first.music,
        },
      ),
      options,
    )
    expect(again.ok).toBe(true)
    if (!again.ok) return
    expect(again.warnings).toEqual([])
    expect(normalize(again.shots, again.folders)).toStrictEqual(
      normalize(first.shots, first.folders),
    )
    // The example fixture carries a `brief` (D6) — round-tripping it exercises
    // the same idempotence the rest of this test already pins for every other
    // mapped field.
    expect(again.brief).toBe(first.brief)
    // D7's worked example carries a `music` too (D5) — same idempotence,
    // threaded through `musicPlan` the way `brief` threads through `storyboard`.
    expect(again.music).toStrictEqual(first.music)
  })

  it("keeps a shot's directions and their already-placed tokens byte-identical", () => {
    // D6 — the importer only APPENDS a missing token; a beat whose prose
    // already carries every token must come back unchanged, not doubled — and
    // a `speech` cue's `speaker` / `voice` (the two fields most likely to be
    // dropped in a rename) must survive the whole round trip too.
    const shots: ReadonlyArray<Shot> = [
      {
        id: "s2",
        beats: [
          {
            id: "b1",
            seconds: 4,
            text: "wind gusts through the alley [wind]",
            directions: [{ kind: "sfx", text: "wind" }],
          },
          {
            id: "b2",
            seconds: 4,
            text: "Natalie shouts [Go!]",
            directions: [
              { kind: "speech", text: "Go!", speaker: "Natalie", voice: "urgent" },
            ],
          },
        ],
      },
    ]
    const doc = exportProduction(shots, undefined, [], "T", noDrafts)
    const out = importProduction(doc, options)
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.warnings).toEqual([])
    expect(normalize(out.shots, out.folders)).toStrictEqual(normalize(shots, []))
  })

  it("keeps a SHOT-LESS scene's plan cues and their tokens byte-identical", () => {
    // The scene half of D5: a scene with no shots carries its cues on the
    // plan's motion, and its prompt carries their tokens — the same placement
    // rule a beat's prose gets, so the same round trip has to hold.
    const shots: ReadonlyArray<Shot> = [
      {
        id: "s3",
        plan: {
          motion: {
            prompt: "slow push [drums] over the rooftops [heavy rain]",
            directions: [
              { kind: "music", text: "drums" },
              { kind: "ambience", text: "heavy rain" },
            ],
          },
        },
      },
    ]
    const doc = exportProduction(shots, undefined, [], "T", noDrafts)
    const out = importProduction(doc, options)
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.warnings).toEqual([])
    expect(normalize(out.shots, out.folders)).toStrictEqual(normalize(shots, []))
  })

  it("round-trips a beat whose cues are listed in the OTHER order from the prose", () => {
    // The placement rule is POSITIONAL: each cue takes its own token wherever
    // it sits. Matched by a cursor instead, `[wind]` (listed first, written
    // second) would consume the tail and `[drums]` would be appended a second
    // time — the prose would grow a duplicate token on every round trip.
    const shots: ReadonlyArray<Shot> = [
      {
        id: "s4",
        beats: [
          {
            id: "b1",
            seconds: 4,
            text: "she runs [drums] and stops [wind]",
            directions: [
              { kind: "sfx", text: "wind" },
              { kind: "music", text: "drums" },
            ],
          },
        ],
      },
    ]
    const doc = exportProduction(shots, undefined, [], "T", noDrafts)
    const out = importProduction(doc, options)
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.warnings).toEqual([])
    expect(normalize(out.shots, out.folders)).toStrictEqual(normalize(shots, []))
  })

  it("round-trips a scene's voiceover PLAN, byte-identical (D4)", () => {
    // Non-default delivery values — a lever sitting at its default is pruned,
    // so a fixture using defaults would silently pass even if pruning broke.
    const shots: ReadonlyArray<Shot> = [
      {
        id: "s5",
        plan: {
          frame: { prompt: "an alley" },
          voice: {
            text: "Go now",
            casting: "male, urgent",
            voiceId: "rachel-1",
            voiceType: "premade",
            ttsProvider: "elevenlabs-v3",
            model: "eleven_v3",
            delivery: { speed: 1.1, stability: 0.6, similarityBoost: 0.8, style: 0.2 },
          },
        },
      },
    ]
    const doc = exportProduction(shots, undefined, [], "T", noDrafts)
    const out = importProduction(doc, options)
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.warnings).toEqual([])
    expect(normalize(out.shots, out.folders)).toStrictEqual(normalize(shots, []))
  })

  it("a RENDERED voiceover exports its plan-shaped half (url stripped) — it never round-trips as shot.voice itself", () => {
    // `export.ts`'s `toScene` reads `shot.voice` (a rendered result, WITH a
    // url) when present, but the format carries no media (D8) — so what comes
    // back through `importProduction` is a PLAN, not a re-hydrated `ShotVoice`.
    // `normalize()` cannot be used here: the two sides are different shapes.
    const shots: ReadonlyArray<Shot> = [
      {
        id: "s6",
        plan: { frame: { prompt: "an alley" } },
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
    ]
    const doc = exportProduction(shots, undefined, [], "T", noDrafts)
    const out = importProduction(doc, options)
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.warnings).toEqual([])
    expect(out.shots[0].voice).toBeUndefined()
    expect(out.shots[0].plan?.voice).toStrictEqual({
      text: "Go now",
      voiceId: "rachel-1",
      voiceType: "premade",
      ttsProvider: "elevenlabs-v3",
      model: "eleven_v3",
      delivery: { speed: 1.1, stability: 0.6 },
    })
  })

  it("round-trips the production's soundtrack PLAN, prompt/duration/selections intact (D5)", () => {
    const shots: ReadonlyArray<Shot> = [{ id: "s7", plan: { frame: { prompt: "an alley" } } }]
    const doc = exportProduction(shots, undefined, [], "T", {
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
    const out = importProduction(doc, options)
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.warnings).toEqual([])
    expect(out.music).toStrictEqual({
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
    })
  })

  it("a RENDERED soundtrack exports its plan-shaped half — no url round-trips (D5)", () => {
    const shots: ReadonlyArray<Shot> = [{ id: "s8", plan: { frame: { prompt: "an alley" } } }]
    const doc = exportProduction(shots, undefined, [], "T", {
      draftFor: () => undefined,
      music: {
        url: "https://r2.example/m.mp3",
        prompt: "ambient pads",
        duration: 15,
        provider: "suno",
      },
      // The PLAN beside the render (R44): the rendered track owns the prose,
      // the plan owns the pickers — and BOTH halves come back on import, which
      // is what makes the round trip lossless once a track exists.
      musicPlan: {
        prompt: "ambient pads",
        selections: {
          vocals: "instrumental",
          vocalGender: "any",
          instruments: ["synth"],
          genre: "ambient",
        },
      },
    })
    // No cast: `exportProduction` returns its own narrowed document type, so
    // the root `music` slot reads as the `MusicDocument` the exporter writes
    // (the `unknown` slot is the IMPORT boundary's, R42).
    const musicDoc = doc.music ?? {}
    expect("url" in musicDoc).toBe(false)
    expect("provider" in musicDoc).toBe(false)
    const out = importProduction(doc, options)
    expect(out.ok).toBe(true)
    if (!out.ok) return
    expect(out.warnings).toEqual([])
    expect(out.music).toStrictEqual({
      prompt: "ambient pads",
      duration: 15,
      selections: {
        vocals: "instrumental",
        vocalGender: "any",
        instruments: ["synth"],
        genre: "ambient",
      },
    })
  })

  it("does not export a chip the prose no longer names", () => {
    // The documented exception: references are re-derived by NAME, so a chip
    // whose `@Name` was edited out is not exported and not in `cast`.
    const doc = exportProduction(
      [{ id: "s1", plan: { frame: { prompt: "an empty alley", references: [natalie] } } }],
      undefined,
      [],
      "T",
      noDrafts,
    )
    const out = importProduction(doc, options)
    expect(out.ok && out.shots[0].plan?.frame?.references).toBeUndefined()
    expect(doc.cast).toBeUndefined()
  })

  it("exports a production LARGER than the generator's budget and it still validates against the published schema", () => {
    // The ~20-scene ceiling is an instruction to the model (§8's `maxTokens`),
    // not a rule of the format — so studio's own export must never emit a file
    // that `/skills/studio-production/schema.json` refuses. One format, one
    // definition.
    const long: ReadonlyArray<Shot> = Array.from({ length: 25 }, (_, i) => ({
      id: `s${i}`,
      name: `Scene ${i + 1}`,
      // ONE scene binds an actor, so the export derives a `cast` row WITH an
      // `imageUrl` (D8) — the strict schema's `z.url()` is on that field, and a
      // production with no chips would validate without ever reaching it.
      plan:
        i === 0
          ? { frame: { prompt: "@Natalie in a narrow Roman alley", references: [natalie] } }
          : { frame: { prompt: "a narrow Roman alley" } },
    }))
    // A brief past the STRUCTURAL cap (D6, `MAX_BRIEF_CHARS = 2000`) is legal
    // input too (R45) — that cap is the GENERATOR's budget alone, and the
    // published contract must not refuse a longer one `exportProduction`
    // itself can write (`storyboard.brief` travels verbatim, unclamped).
    const longBrief = "a".repeat(2500)
    const doc = exportProduction(long, undefined, [], "The long one", {
      ...noDrafts,
      storyboard: { brief: longBrief },
    })
    expect(doc.scenes).toHaveLength(25)
    expect(doc.cast?.[0]?.imageUrl).toBe("https://r2.example/natalie.png")
    expect(doc.brief).toHaveLength(2500)
    const published = z.fromJSONSchema(renderStrictJsonSchema(REGISTRY))
    const checked = published.safeParse(doc)
    expect(checked.success, JSON.stringify(checked.error?.issues)).toBe(true)
  })
})
