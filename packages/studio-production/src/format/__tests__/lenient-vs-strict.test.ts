import type { ConnectedReference } from "@nodaro/shared"
import { describe, it, expect } from "vitest"
import { z } from "zod"

import { CAMERA_MOVEMENT_KEY } from "../../look-pickers"
import { videoDurationOptions } from "../../model-menu"
import { importProduction } from "../import"
import { renderStrictJsonSchema } from "../json-schema"
import {
  buildFormatRegistry,
  type RegistryNode,
} from "../registry"
import {
  FORMAT_ID,
  FORMAT_VERSION,
  type CastEntry,
  type LookMap,
  type MusicDocument,
  type ProductionDocument,
  type SceneDocument,
  type ShotDocument,
} from "../schema"

/**
 * D11 — the lenient importer and the strict published schema, tied together:
 * every document `schema.json` accepts PARSES and MAPS without rejection. The
 * corpus is registry-generated (every usable picker, every lever row, every
 * model) and deliberately model-agnostic, because the published schema is —
 * so the only warnings allowed are the per-model repairs.
 */
const REGISTRY = buildFormatRegistry()
/** The EMPTY-library baseline: a document valid per `schema.json` must import
 *  with only per-model warnings for a user who owns nothing. */
const options = {
  candidates: [] as ReadonlyArray<{
    id: string
    name: string
    toConnectedReference: () => ConnectedReference
  }>,
  durationsFor: (model: string) => videoDurationOptions(model).map((d) => d.value),
  registry: REGISTRY,
}
/** …and ONE resolvable row, for the one document that names a cast: its entry
 *  must bind cleanly rather than raise `unresolved-cast`. Scoped to that
 *  document, so the other three keep the empty-library baseline. */
const withLibrary = {
  ...options,
  candidates: [
    {
      id: "char-natalie",
      name: "Natalie",
      toConnectedReference: (): ConnectedReference => ({
        id: "char-natalie",
        defaultName: "Natalie",
        source: "wired-character",
        url: "https://r2.example/natalie.png",
      }),
    },
  ],
}
const ALLOWED: ReadonlySet<string> = new Set(["option", "duration", "budget"])
/** The published contract itself, built ONCE — the corpus must be valid HERE for
 *  the property to mean anything: "valid per `schema.json` ⇒ parses and maps" is
 *  vacuous over documents the strict schema would have refused. */
const strict = z.fromJSONSchema(renderStrictJsonSchema(REGISTRY))

const firstId = (key: string): string | undefined =>
  REGISTRY.pickers.find((p) => p.key === key)?.options[0]?.id

const document = (
  scenes: ReadonlyArray<SceneDocument>,
  film?: LookMap,
  cast?: ReadonlyArray<CastEntry>,
  music?: MusicDocument,
  brief?: string,
): ProductionDocument => ({
  format: FORMAT_ID,
  version: FORMAT_VERSION,
  ...(brief ? { brief } : {}),
  ...(film ? { film } : {}),
  ...(cast ? { cast: [...cast] } : {}),
  ...(music ? { music } : {}),
  scenes: [...scenes],
})

/** One scene using EVERY key the fold can resolve — in the look, in the picks,
 *  and (for the film keys) in the film layer. */
function everyPickerDocument(): ProductionDocument {
  const look: LookMap = {}
  for (const picker of REGISTRY.pickers) {
    if (!picker.usableAsPick || picker.key === CAMERA_MOVEMENT_KEY) continue
    const id = picker.options[0]?.id
    if (id) look[picker.key] = id
  }
  const picks: Record<string, string> = {}
  for (const [key, value] of Object.entries(look)) picks[key] = value as string
  const movement = firstId(CAMERA_MOVEMENT_KEY)
  if (movement) picks[CAMERA_MOVEMENT_KEY] = movement
  const film: LookMap = {}
  for (const key of REGISTRY.filmKeys) {
    const id = firstId(key)
    if (id) film[key] = id
  }
  // Every audio mode, once — a `speech` cue also carries `speaker`/`voice`,
  // the two fields no other mode reads (D3).
  const audio = REGISTRY.audio.modes.map((mode) => ({
    mode,
    content: "cue",
    ...(mode === "speech" ? { speaker: "Natalie", voice: "urgent" } : {}),
  }))
  return document(
    [
      {
        look,
        shots: [{ seconds: 4, text: "she runs", picks, audio }],
        // A full voice — every field (D4), so the strict `voice` node is
        // exercised the same way `everyPickerDocument` exercises every other
        // fixed-shape node. In-bounds delivery values, none at the route's
        // default — nothing here should cost a single warning.
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
      // A shots-less scene carries its cues on `motion.audio` directly (D5) —
      // no shot exists for repair to move them onto.
      { motion: { audio } },
    ],
    film,
    // Exercises the strict schema's `imageUrl: z.url()` (R24) — resolvable
    // against `withLibrary`, so it binds without a warning.
    [{ kind: "character", name: "Natalie", imageUrl: "https://r2.example/n.png" }],
    // A full `music` — every field (D5), exercising the strict document the
    // same way the scene above exercises `voice`'s. Every value is one this
    // catalog actually publishes, so nothing here should cost a warning either.
    {
      prompt: "a driving synth pulse",
      duration: REGISTRY.music.maxDuration,
      vocals: REGISTRY.music.vocals[0]!,
      vocalGender: REGISTRY.music.vocalGenders[0]!,
      genre: REGISTRY.music.genres[0]!.id,
      mood: REGISTRY.music.moods[0]!.id,
      instruments: [REGISTRY.music.instruments[0]!.id],
      singingStyle: REGISTRY.music.singingStyles[0]!.id,
      language: REGISTRY.music.languages[0]!.id,
    },
    // Past the STRUCTURAL cap (`MAX_BRIEF_CHARS = 2000`) — legal here on
    // purpose (D6 fix round 1, R45): the published contract bounds nothing
    // `exportProduction` doesn't already bound, and `brief` carries no
    // exporter clamp of its own, so a document like this one must still
    // parse and map cleanly.
    "a".repeat(2001),
  )
}

/** One scene per lever-node id, each with every dimension's first step. */
function leverDocument(
  node: RegistryNode,
  field: "transition" | "characterFx",
): ProductionDocument {
  const levers: Record<string, string> = {}
  for (const dimension of node.dimensions) {
    const id = dimension.options[0]?.id
    if (id) levers[dimension.field] = id
  }
  return document(
    node.ids.map((row) => {
      const lever = { id: row.id, ...levers }
      const shot: ShotDocument =
        field === "transition"
          ? { seconds: 4, text: "t", transition: lever }
          : { seconds: 4, text: "t", characterFx: lever }
      return { shots: [shot] }
    }),
  )
}

/** One scene per model, each paired with the STAGE defaults rather than its own
 *  vocabulary — exactly what a model-agnostic authoring schema permits. */
function modelDocument(): ProductionDocument {
  const aspectRatio = REGISTRY.defaults.aspectRatio
  const resolution = REGISTRY.defaults.resolution
  const duration = REGISTRY.videoModels[0]?.durations[0] ?? 4
  return document([
    ...REGISTRY.imageModels.map((m) => ({
      frame: { prompt: "an alley", model: m.id, aspectRatio, resolution, count: 1 },
    })),
    ...REGISTRY.videoModels.map((m) => ({
      motion: { model: m.id, aspectRatio, resolution, duration },
      shots: [{ seconds: 6, text: "she runs" }],
    })),
  ])
}

const CORPUS: ReadonlyArray<{
  name: string
  doc: ProductionDocument
  options: typeof options
}> = [
  { name: "every usable picker", doc: everyPickerDocument(), options: withLibrary },
  {
    name: "every transition",
    doc: leverDocument(REGISTRY.transition, "transition"),
    options,
  },
  {
    name: "every character FX",
    doc: leverDocument(REGISTRY.characterFx, "characterFx"),
    options,
  },
  { name: "every model", doc: modelDocument(), options },
]

describe("valid per the published schema ⇒ parses and maps", () => {
  for (const { name, doc, options: docOptions } of CORPUS) {
    it(`${name}: no rejection, and only per-model warnings`, () => {
      // The domain of the property: this document is one `schema.json` accepts.
      const checked = strict.safeParse(doc)
      expect(checked.success, JSON.stringify(checked.error?.issues)).toBe(true)
      const out = importProduction(doc, docOptions)
      expect(out.ok).toBe(true)
      if (!out.ok) return
      expect(out.warnings.filter((w) => !ALLOWED.has(w.code))).toEqual([])
      expect(out.shots).toHaveLength(doc.scenes.length)
    })
  }

  it("the picker corpus needs no repair at all", () => {
    // "No warnings at all" leans on `DEFAULT_VIDEO_PROVIDER` being SPEECH-capable:
    // the corpus names no model, so A7's capability check runs against that
    // default, and a curated default that stopped speaking would warn on every
    // speech cue here. `import-repair-capability.test.ts` guards that premise
    // explicitly; this line says the corpus depends on it.
    const out = importProduction(everyPickerDocument(), withLibrary)
    expect(out.ok && out.warnings).toEqual([])
  })
})
