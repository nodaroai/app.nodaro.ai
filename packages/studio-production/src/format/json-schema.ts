import { TTS_PROVIDERS } from "@nodaro/shared"
import { z } from "zod"

import { CAMERA_MOVEMENT_KEY } from "../look-pickers"
import { DIRECTING_MODES } from "../model-menu"
import {
  lookPickerKeys,
  shotPickKeys,
  type FormatRegistry,
  type RegistryNode,
  type RegistryOption,
  type RegistryPicker,
  type RegistrySubjectDimension,
} from "./registry"
import {
  AUDIO_MODES,
  FORMAT_ID,
  FORMAT_VERSION,
} from "./schema"
import { VOICE_TYPES } from "../tts-provider"
import { VOICE_DELIVERY_BOUNDS } from "../voice-delivery-settings"

/**
 * The format's TWO JSON Schemas, both pure functions of the registry (§4).
 *
 * STRUCTURAL — what `POST /v1/llm/structured` receives. It carries no CATALOG
 * enums (D6: the 1,137-row legend rides the system prompt once instead) —
 * with THREE exceptions, each a handful of FORMAT- or EDITOR-owned values
 * rather than a catalog: `structuralAudio`'s fixed `AUDIO_MODES` list below,
 * `music`'s `vocals`/`vocalGender` (D5's own small fixed vocabulary,
 * `registry.music.vocals`/`.vocalGenders`, same reasoning as `AUDIO_MODES`),
 * and `motion.input`'s four `DIRECTING_MODES` (D3 — the directing input mode
 * is the editor's own vocabulary, four words, and the generator cannot pick a
 * mode it was never shown). It stays inside
 * the keyword subset `z.fromJSONSchema` converts faithfully. Two traps
 * it must avoid: a keyword the converter THROWS on (`not`, `if/then/else`,
 * `unevaluated*`, `dependent*`, an external `$ref`), and an `anyOf` of bare
 * `required` branches, which converts to something that enforces nothing — so
 * the format's one cross-field rule lives in studio's Zod instead (§8).
 * Hand-built rather than converted from Zod because `z.toJSONSchema` of a
 * record emits `propertyNames`, which is outside that subset.
 *
 * STRICT — the published `schema.json` (§9). Every picker key's ids, every
 * lever id and every model id is an enum, so an external validator catches an
 * invented id before the file reaches studio. It is model-AGNOSTIC on purpose
 * (D11): a resolution valid for one model is valid in the file, and the
 * importer's per-model repair warns about the mismatch. Converted with
 * `z.toJSONSchema`, then the at-least-one rule is injected — `z.toJSONSchema`
 * drops a `.refine` silently, and D11 requires this schema to be exactly as
 * strict as the importer.
 */

/** The keywords the structural document may use — §8's subset, exported so the
 *  guard test and any future route-side check read ONE list. */
export const STRUCTURAL_KEYWORDS: ReadonlySet<string> = new Set([
  "type",
  "properties",
  "required",
  "additionalProperties",
  "items",
  "enum",
  "const",
  "anyOf",
  "minimum",
  "maximum",
  "exclusiveMinimum",
  "minItems",
  "maxItems",
  "minLength",
  "maxLength",
  "multipleOf",
  "description",
])

/** The GENERATOR's budget, used by `renderStructuralJsonSchema` ALONE. These
 *  bound what the model is asked to produce — the reference channels' fan-out,
 *  the prose fields, and the ~20-scene ceiling the skill and the system prompt
 *  also state, because a longer plan overruns `maxTokens` (§8) and a truncated
 *  completion fails `JSON.parse` identically on every retry. They are NOT rules
 *  of the format: §3 sets no limits, the importer enforces none and
 *  `exportProduction` obeys none, so `renderStrictJsonSchema` — the published
 *  contract studio's own export must satisfy — carries none of them. */
const MAX_SCENES = 20
const MAX_SHOTS_PER_SCENE = 30
const MAX_FOLDERS = 20
const MAX_CAST = 40
const MAX_REFERENCE_URLS = 10
const MAX_PROMPT_CHARS = 4000
const MAX_NEGATIVE_CHARS = 2000
const MAX_NAME_CHARS = 120
const MAX_LABEL_CHARS = 60
const MAX_AUDIO_CUES = 8
const MAX_AUDIO_CHARS = 300
const MAX_VOICE_CHARS = 120
/** `scenes[].voice.text` — a spoken line, roomier than a shot's prose (D4). */
const MAX_VOICE_TEXT_CHARS = 2000
/** The root `brief` — the production's own logline (plan-import-v2 D6). The
 *  GENERATOR's budget alone (R45 — fix round 1 corrected an earlier both-schema
 *  cap): the STRUCTURAL schema is what `/v1/llm/structured` is asked to answer
 *  in, so it bounds a model's prose the same way `music.prompt` and
 *  `scenes[].voice.text` do; the STRICT published contract stays unbounded,
 *  same D11 asymmetry (§8's "no size caps here" comment above the strict
 *  renderer) — `exportProduction` writes `storyboard.brief` verbatim, and
 *  nothing in the format (§3) bounds a production's prose length. */
const MAX_BRIEF_CHARS = 2000
/** `music.prompt` — the soundtrack's own description (D5). */
const MAX_MUSIC_PROMPT_CHARS = 1000

/** The longest window any model could hold — the per-model budget is the
 *  importer's clamp, this is only the document's outer bound. */
function secondsCeiling(registry: FormatRegistry): number {
  return Math.max(
    registry.shots.fallbackCapSeconds,
    ...registry.videoModels.map((m) => (m.durations.length > 0 ? Math.max(...m.durations) : 0)),
  )
}

const keyList = (pickers: ReadonlyArray<RegistryPicker>) => pickers.map((p) => p.key).join(", ")

const unique = <T,>(values: ReadonlyArray<T>): T[] => [...new Set(values)]

const ids = (options: ReadonlyArray<RegistryOption>): string[] => options.map((o) => o.id)

// ── structural ───────────────────────────────────────────────────────────────

function structuralLeverNode(description: string): Record<string, unknown> {
  return {
    type: "object",
    description,
    properties: {
      id: { type: "string" },
      position: { type: "string" },
      duration: { type: "string" },
      intensity: { type: "string" },
    },
    required: ["id"],
    additionalProperties: false,
  }
}

export function renderStructuralJsonSchema(
  registry: FormatRegistry,
): Record<string, unknown> {
  const seconds = secondsCeiling(registry)
  const maxPicks = Math.max(...registry.pickers.map((p) => p.maxPicks))
  const urls = { type: "array", items: { type: "string" }, maxItems: MAX_REFERENCE_URLS }
  // Shared by `shots[].audio` and `motion.audio` — one concurrent sound cue
  // (§3, D3). `AUDIO_MODES` is the format's own fixed vocabulary (schema.ts),
  // not a catalog the registry curates — same reasoning as `FORMAT_ID` above.
  const structuralAudio = {
    type: "array",
    // B19 — the generator reads descriptions: one sentence naming the modes
    // FROM the format's own fixed vocabulary (never a hand-typed list, so a
    // catalog change here can't leave this prose stale). NOT "one per mode"
    // (fix round 1, R70's sibling finding): `maxItems` is `MAX_AUDIO_CUES` (8),
    // not the mode count (5), and two `sfx` chips legally export as two `sfx`
    // cues — the file's "one id per key" idiom elsewhere would make a
    // generator misread that as a cap on repeats.
    description: `Concurrent sound cues; each names one \`mode\` (${AUDIO_MODES.map((m) => `\`${m}\``).join("/")}) — \`speech\` is the line itself, \`tone\` its delivery, the rest a generation-ready description.`,
    maxItems: MAX_AUDIO_CUES,
    items: {
      type: "object",
      properties: {
        mode: { type: "string", enum: [...AUDIO_MODES] },
        content: { type: "string", maxLength: MAX_AUDIO_CHARS },
        voice: { type: "string", maxLength: MAX_VOICE_CHARS },
        speaker: { type: "string", maxLength: MAX_NAME_CHARS },
      },
      required: ["mode", "content"],
      additionalProperties: false,
    },
  }
  return {
    type: "object",
    description:
      "A Nodaro Studio production plan: the film look, its scenes, and each scene's framing, motion and timed shots. Every value is a catalog id, never a label.",
    properties: {
      format: { const: FORMAT_ID },
      // The ONE version this studio writes — `const`, not a 1..N range. The
      // range let the ROUTE hand back `version: 1`, which the STRICT published
      // schema (`z.literal(FORMAT_VERSION)`) then refuses: the two contracts
      // for the same document disagreed. The IMPORTER stays looser on purpose
      // (any int, `newer-version` warning) — that asymmetry is the deliberate
      // one, pinned in json-schema.test.
      version: { const: FORMAT_VERSION },
      title: { type: "string", maxLength: MAX_NAME_CHARS },
      brief: { type: "string", maxLength: MAX_BRIEF_CHARS },
      film: {
        type: "object",
        description: `Film-wide look, one id per key. Keys: ${[...registry.filmKeys].join(", ")}.`,
        additionalProperties: { type: "string" },
      },
      folders: {
        type: "array",
        description: "Folder names in render order; a scene names one in `folder`.",
        items: { type: "string", maxLength: MAX_NAME_CHARS },
        maxItems: MAX_FOLDERS,
      },
      scenes: {
        type: "array",
        minItems: 1,
        maxItems: MAX_SCENES,
        items: {
          type: "object",
          description: "A scene needs at least one of frame, motion, shots or voice.",
          properties: {
            name: { type: "string", maxLength: MAX_NAME_CHARS },
            folder: { type: "string", maxLength: MAX_NAME_CHARS },
            look: {
              type: "object",
              description: `This scene's look, one id per key (an array only for a multi-pick key). Keys: ${keyList(lookPickerKeys(registry))}.`,
              additionalProperties: {
                anyOf: [
                  { type: "string" },
                  { type: "array", items: { type: "string" }, maxItems: maxPicks },
                ],
              },
            },
            frame: {
              type: "object",
              description: "The still this scene is framed from.",
              properties: {
                prompt: { type: "string", maxLength: MAX_PROMPT_CHARS },
                negativePrompt: { type: "string", maxLength: MAX_NEGATIVE_CHARS },
                model: { type: "string", description: "An image model id from the legend." },
                aspectRatio: { type: "string", description: "One the chosen model offers." },
                resolution: { type: "string", description: "One the chosen model offers." },
                count: { type: "integer", minimum: 1, maximum: registry.candidates.max },
                referenceImageUrls: urls,
              },
              required: ["prompt"],
              additionalProperties: false,
            },
            motion: {
              type: "object",
              description:
                "How this scene animates. Omit `prompt` when the scene has `shots` — the shots ARE the directing prose; `scenePrompt` is the one prose field that stands OVER them.",
              properties: {
                prompt: { type: "string", maxLength: MAX_PROMPT_CHARS },
                scenePrompt: {
                  type: "string",
                  maxLength: MAX_PROMPT_CHARS,
                  description:
                    "What the whole clip is about — story, mood, things to avoid. Kept beside `shots`, unlike `prompt`.",
                },
                negativePrompt: { type: "string", maxLength: MAX_NEGATIVE_CHARS },
                model: { type: "string", description: "A video model id from the legend." },
                aspectRatio: { type: "string", description: "One the chosen model offers." },
                resolution: { type: "string", description: "One the chosen model offers." },
                duration: {
                  type: "number",
                  exclusiveMinimum: 0,
                  maximum: seconds,
                  description: "Seconds, from the chosen model's own ladder.",
                },
                input: {
                  type: "string",
                  enum: [...DIRECTING_MODES],
                  description: "Which input drives this scene's motion — a mode the chosen model supports.",
                },
                cameraMotionId: { type: "string" },
                endTransition: structuralLeverNode(
                  "How the scene goes out — its last frames; the next scene's own opening still stands.",
                ),
                referenceImageUrls: urls,
                referenceVideoUrls: urls,
                referenceAudioUrls: urls,
                audio: structuralAudio,
              },
              additionalProperties: false,
            },
            shots: {
              type: "array",
              description:
                "The timed breakdown. The scene's total must fit the motion model's longest clip.",
              maxItems: MAX_SHOTS_PER_SCENE,
              items: {
                type: "object",
                properties: {
                  seconds: {
                    type: "number",
                    exclusiveMinimum: 0,
                    maximum: seconds,
                    multipleOf: registry.shots.step,
                  },
                  text: { type: "string", maxLength: MAX_NEGATIVE_CHARS },
                  label: { type: "string", maxLength: MAX_LABEL_CHARS },
                  picks: {
                    type: "object",
                    description: `This shot's picks, ALWAYS one id per key. Keys: ${keyList(shotPickKeys(registry))}.`,
                    additionalProperties: { type: "string" },
                  },
                  transition: structuralLeverNode("How this shot comes in."),
                  characterFx: structuralLeverNode("A character effect inside this shot."),
                  audio: structuralAudio,
                },
                required: ["seconds", "text"],
                additionalProperties: false,
              },
            },
            // Only `text`/`casting` — the two fields THIS studio's generator
            // may author (skill rule 15). `voiceId`/`voiceType`/`ttsProvider`/
            // `model`/`delivery` are a STUDIO EXPORT's own fields and ride the
            // STRICT schema only (D11's `promptBaked`/`imageUrl` precedent).
            voice: {
              type: "object",
              description:
                "This scene's voiceover. See ## Voice — scenes[].voice in the catalog.",
              properties: {
                text: { type: "string", maxLength: MAX_VOICE_TEXT_CHARS },
                casting: { type: "string", maxLength: MAX_VOICE_CHARS },
              },
              required: ["text"],
              additionalProperties: false,
            },
          },
          additionalProperties: false,
        },
      },
      cast: {
        type: "array",
        description:
          "What the plan expects to exist in the user's library. Informational — nothing is created.",
        maxItems: MAX_CAST,
        items: {
          type: "object",
          properties: {
            kind: { type: "string", enum: ["character", "location", "object", "creature"] },
            name: { type: "string", maxLength: MAX_NAME_CHARS },
            description: { type: "string", maxLength: 500 },
          },
          required: ["kind", "name"],
          additionalProperties: false,
        },
      },
      music: {
        type: "object",
        description:
          "The production's ONE soundtrack. `duration` (seconds) is STORED for display/restore only — it is never sent to the generator. `vocals`/`vocalGender` are the fixed toggle; `genre`/`mood`/`instruments`/`singingStyle`/`language` are catalog ids — read them in the ## Music section below.",
        properties: {
          prompt: { type: "string", maxLength: MAX_MUSIC_PROMPT_CHARS },
          duration: { type: "number", minimum: 1, maximum: registry.music.maxDuration },
          vocals: { type: "string", enum: [...registry.music.vocals] },
          vocalGender: { type: "string", enum: [...registry.music.vocalGenders] },
          genre: { type: "string" },
          mood: { type: "string" },
          instruments: {
            type: "array",
            // Every sibling array carries `maxItems`, and every plain
            // (non-enum) string a `maxLength` — the same pair `folders`
            // uses just above (fix round 2, item 4). The cap is the
            // catalog's own length: a document can never usefully name more
            // distinct instruments than the catalog has, and a doc with
            // `["piano", "piano", …×5000]` would otherwise be unbounded.
            // `repairMusic` dedupes AND caps at this same length, so the
            // published bound and the importer's own behaviour agree.
            items: { type: "string", maxLength: MAX_NAME_CHARS },
            maxItems: registry.music.instruments.length,
          },
          singingStyle: { type: "string" },
          language: { type: "string" },
        },
        required: ["prompt"],
        additionalProperties: false,
      },
    },
    // Stricter than the published contract on ONE field: a draft always names
    // its film, while a hand-authored file may not (`schema.ts` and the strict
    // schema below both keep `title` optional).
    required: ["format", "version", "title", "scenes"],
    additionalProperties: false,
  }
}

// ── strict ───────────────────────────────────────────────────────────────────

function enumOf(options: ReadonlyArray<RegistryOption>) {
  return z.enum(ids(options))
}

/** A look map as NAMED keys — the strict half of the record above. */
function strictLookObject(
  pickers: ReadonlyArray<RegistryPicker>,
  allowArrays: boolean,
) {
  const shape: Record<string, z.ZodType> = {}
  for (const p of pickers) {
    const one = enumOf(p.options)
    shape[p.key] = (
      allowArrays && p.multi ? z.union([one, z.array(one).max(p.maxPicks)]) : one
    ).optional()
  }
  return z.object(shape)
}

function strictLeverNode(node: RegistryNode) {
  const shape: Record<string, z.ZodType> = { id: enumOf(node.ids) }
  for (const d of node.dimensions) shape[d.field] = enumOf(d.options).optional()
  return z.object(shape)
}

/** `scenes[].voice.delivery` — every lever bounded by {@link VOICE_DELIVERY_BOUNDS}
 *  (D4), the ONE place those numbers live. */
function strictDeliveryObject() {
  const shape: Record<string, z.ZodType> = {}
  for (const [lever, { min, max }] of Object.entries(VOICE_DELIVERY_BOUNDS)) {
    shape[lever] = z.number().min(min).max(max).optional()
  }
  return z.object(shape)
}

/** `scenes[].voice` — every field (D11: the published contract is exactly as
 *  strict as the importer, and repair drops nothing the strict schema still
 *  refuses). TWO enums here — `voiceType`'s three {@link VOICE_TYPES} values
 *  and `ttsProvider`'s platform-wide {@link TTS_PROVIDERS} (R38-1) — so an
 *  external validator catches an invented one before the importer's own
 *  repair would have dropped it. The LENIENT `voiceDocument` in `schema.ts`
 *  keeps `ttsProvider` a plain string on purpose (D11): a newer provider id
 *  must still PARSE there, and it is repair's `isTtsProvider` check, not the
 *  structural schema, that drops it. */
function strictVoiceDocument() {
  return z.object({
    // NON-EMPTY (D11 — as strict as the importer): `repairVoice` drops a
    // voiceover whose line is blank or whitespace-only, with its own warning,
    // so a contract that ACCEPTED `""` promised something the importer refuses
    // to land. The STRUCTURAL schema stays looser on purpose — none of its
    // prose fields carry a minimum, and the generator's own empty string is a
    // repair case, not a request the route should reject.
    text: z.string().min(1),
    casting: z.string().optional(),
    voiceId: z.string().optional(),
    voiceType: z.enum(VOICE_TYPES).optional(),
    ttsProvider: z.enum(TTS_PROVIDERS).optional(),
    model: z.string().optional(),
    delivery: strictDeliveryObject().optional(),
  })
}

/**
 * The production's ONE soundtrack, root `music` (plan-import-v2 D5, R31a: a
 * FIXED-SHAPE node like `voice`, so every field enumerates here). `vocals` /
 * `vocalGender` enum against the registry's own small fixed vocabulary
 * (`registry.music.vocals`/`.vocalGenders` — the same reasoning `AUDIO_MODES`
 * gets in the STRUCTURAL schema: a handful of values, not a catalog to keep
 * out of the route's budget); the five catalog fields (`genre`…`language`)
 * enum against their own `registry.music.*` list, same discipline as every
 * other catalog-shaped field in this function. `duration` is bounded
 * `1..registry.music.maxDuration` (D1's hoisted cap) — stored on
 * `ProductionMusic`, never sent to the generator (see the legend).
 */
function strictMusicDocument(registry: FormatRegistry) {
  return z.object({
    // NON-EMPTY, for the reason `strictVoiceDocument`'s `text` is: `repairMusic`
    // drops a soundtrack with no description, with its own `audio` warning.
    prompt: z.string().min(1),
    duration: z.number().min(1).max(registry.music.maxDuration).optional(),
    vocals: z.enum(registry.music.vocals).optional(),
    vocalGender: z.enum(registry.music.vocalGenders).optional(),
    genre: enumOf(registry.music.genres).optional(),
    mood: enumOf(registry.music.moods).optional(),
    instruments: z.array(enumOf(registry.music.instruments)).optional(),
    singingStyle: enumOf(registry.music.singingStyles).optional(),
    language: enumOf(registry.music.languages).optional(),
  })
}

/** A subject map as NAMED fields — {@link strictLookObject}'s twin, reading
 *  `registry.subject` (whose rows key by `field`, not `key`) for `frame.subject`. */
function strictSubjectObject(dimensions: ReadonlyArray<RegistrySubjectDimension>) {
  const shape: Record<string, z.ZodType> = {}
  for (const d of dimensions) {
    const one = enumOf(d.options)
    shape[d.field] = (d.multi ? z.union([one, z.array(one).max(d.maxPicks)]) : one).optional()
  }
  return z.object(shape)
}

export function renderStrictJsonSchema(
  registry: FormatRegistry,
): Record<string, unknown> {
  // No size caps here, deliberately: this is the contract studio's own export
  // must satisfy, and neither the format (§3) nor `exportProduction` bounds a
  // production's scenes, folders, cast, references or prose length. The caps
  // above are the generator's budget and stay in the structural schema.
  const urls = z.array(z.string()).optional()
  // Shared by `shots[].audio` and `motion.audio` — same shape as the lenient
  // `audioLayer` in schema.ts, enumed strictly here (D11).
  const audio = z
    .array(
      z.object({
        mode: z.enum(AUDIO_MODES),
        content: z.string(),
        voice: z.string().optional(),
        speaker: z.string().optional(),
      }),
    )
    .optional()
  const filmPickers = lookPickerKeys(registry).filter((p) => registry.filmKeys.has(p.key))
  const imageAspects = unique(registry.imageModels.flatMap((m) => m.aspectRatios))
  const imageResolutions = unique(registry.imageModels.flatMap((m) => m.resolutions))
  const videoAspects = unique(registry.videoModels.flatMap((m) => m.aspectRatios))
  const videoResolutions = unique(registry.videoModels.flatMap((m) => m.resolutions))
  const videoDurations = unique(registry.videoModels.flatMap((m) => m.durations)).sort(
    (a, b) => a - b,
  )
  // The union of every video model's own INPUT modes — derived exactly like the
  // aspect/resolution/duration unions above rather than imported from the
  // editor module (`DIRECTING_MODES`). The registry is this schema's only
  // vocabulary source (§4); a model whose modes the catalog changes must move
  // the published contract with no edit here.
  const videoInputs = unique(registry.videoModels.flatMap((m) => m.inputs ?? []))
  const document = z.object({
    format: z.literal(FORMAT_ID),
    version: z.literal(FORMAT_VERSION),
    title: z.string().optional(),
    brief: z.string().optional(),
    film: strictLookObject(filmPickers, false).optional(),
    folders: z.array(z.string()).optional(),
    scenes: z
      .array(
        z.object({
          name: z.string().optional(),
          folder: z.string().optional(),
          look: strictLookObject(lookPickerKeys(registry), true).optional(),
          frame: z
            .object({
              prompt: z.string(),
              // STRICT only, deliberately absent from the STRUCTURAL schema: a
              // studio export of a legacy scene carries it and must validate
              // (D11 — this schema is exactly as strict as the importer), while
              // the generator is never asked to author a provenance flag.
              promptBaked: z.literal(true).optional(),
              negativePrompt: z.string().optional(),
              model: z.enum(registry.imageModels.map((m) => m.id)).optional(),
              aspectRatio: z.enum(imageAspects).optional(),
              resolution: z.enum(imageResolutions).optional(),
              count: z.number().int().min(1).max(registry.candidates.max).optional(),
              referenceImageUrls: urls,
              subject: strictSubjectObject(registry.subject).optional(),
            })
            .optional(),
          motion: z
            .object({
              prompt: z.string().optional(),
              scenePrompt: z.string().optional(),
              negativePrompt: z.string().optional(),
              model: z.enum(registry.videoModels.map((m) => m.id)).optional(),
              aspectRatio: z.enum(videoAspects).optional(),
              resolution: z.enum(videoResolutions).optional(),
              duration: z.literal(videoDurations).optional(),
              input: z.enum(videoInputs).optional(),
              cameraMotionId: z
                .enum(
                  ids(
                    shotPickKeys(registry).find((p) => p.key === CAMERA_MOVEMENT_KEY)!.options,
                  ),
                )
                .optional(),
              endTransition: strictLeverNode(registry.transition).optional(),
              referenceImageUrls: urls,
              referenceVideoUrls: urls,
              referenceAudioUrls: urls,
              audio,
            })
            .optional(),
          shots: z
            .array(
              z.object({
                // NO `multipleOf` here, deliberately. A standard JSON Schema
                // validator does the check in binary floating point — ajv reads
                // 0.3 / 0.1 as 2.9999999999999996 — so the grid would reject
                // tenths studio's own export writes (0.3, 6.1) and break D11's
                // "valid there ⇒ parses here" in the wrong direction. The grid
                // rides the description, and the importer snaps. The STRUCTURAL
                // schema keeps its `multipleOf`: that lane is read back by zod,
                // whose remainder is float-safe.
                seconds: z
                  .number()
                  .positive()
                  .max(secondsCeiling(registry))
                  .describe(
                    "Seconds, authored in tenths (0.1 steps); the importer snaps an off-grid value.",
                  ),
                text: z.string(),
                label: z.string().optional(),
                picks: strictLookObject(shotPickKeys(registry), false).optional(),
                transition: strictLeverNode(registry.transition).optional(),
                characterFx: strictLeverNode(registry.characterFx).optional(),
                audio,
              }),
            )
            .optional(),
          voice: strictVoiceDocument().optional(),
        }),
      )
      .min(1),
    cast: z
      .array(
        z.object({
          kind: z.enum(["character", "location", "object", "creature"]),
          name: z.string(),
          description: z.string().optional(),
          // STRICT only, deliberately absent from the STRUCTURAL schema (the
          // `promptBaked` precedent above): the generator is never asked to
          // author an image url, but a STUDIO EXPORT writes one on every bound
          // cast row whose CANONICAL chip carries an image (`export.ts`'s
          // `toCast` — a scene's pinned VIEW is a pose, not the actor, and
          // supplies none) — it is what makes the recipient's own
          // create-from-image possible (plan-import-v2 D8), not a mark of a row
          // that came from one.
          imageUrl: z.url().optional(),
        }),
      )
      .optional(),
    // A root `voice` is no longer a document field as of D7 — voice lives at
    // `scenes[].voice` (D4). `additionalProperties: false` below refuses one
    // the same way it refuses any other unknown key.
    // The production's ONE soundtrack, enumerated for real as of D5 — see
    // `strictMusicDocument`.
    music: strictMusicDocument(registry).optional(),
  })
  const rendered = z.toJSONSchema(document) as Record<string, unknown>
  // The one rule `z.toJSONSchema` cannot carry: it drops a `.refine` silently,
  // and D11 requires a document valid HERE to parse in studio. REBUILT rather
  // than written in place — `rendered` is this function's own fresh object, but
  // copy-on-write is the house rule and a reader of the diff cannot see that.
  const properties = rendered.properties as Record<string, Record<string, unknown>>
  const scenes = properties.scenes
  return {
    ...rendered,
    properties: {
      ...properties,
      scenes: {
        ...scenes,
        items: {
          ...(scenes.items as Record<string, unknown>),
          anyOf: [
            { required: ["frame"] },
            { required: ["motion"] },
            { required: ["shots"] },
            // The FOURTH stage (D4) — a narration-only scene is a scene.
            { required: ["voice"] },
          ],
        },
      },
    },
  }
}
