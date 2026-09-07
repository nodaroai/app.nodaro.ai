import type { VoiceType } from "@nodaro/shared"
import { z } from "zod"

import type { VocalGender, Vocals } from "../music-options"
import type { VoiceDeliverySettings } from "../voice-delivery-settings"

import type { AudioLayer, AudioMode } from "./audio"

/**
 * `nodaro-studio-production` v2 — the portable plan format (spec §3).
 *
 * The TYPES are the document as authored; the SCHEMA is deliberately
 * STRUCTURAL: it decides what is a document (a `scenes` array, a shot with
 * prose and a length, a scene that carries at least one stage) and nothing
 * catalog-shaped. Every id, model, cardinality and per-model option is the
 * repair step's (D11 — one lenient importer, one strict published schema), so
 * a file written against a newer `@nodaro/prompts` still opens here, minus
 * what this catalog can't resolve.
 *
 * Unknown keys are STRIPPED (no `.strict()`): §3's forward-compat rule is
 * "drop with a warning", and the warning is raised by the importer's own sweep
 * over the key sets below — the schema itself never rejects for them.
 */

/** The format's identity. A file without it is not ours (rejected before parse). */
export const FORMAT_ID = "nodaro-studio-production"

/** The version studio WRITES. A newer one imports best-effort (D13). */
export const FORMAT_VERSION = 2

/** `pickerKey → id(s)` — the film layer and each scene's look (spec §3). */
export type LookMap = Record<string, string | string[]>

/** The Framing stage's plan: prose + the levers `FrameSettings` records. */
export interface FrameDocument {
  prompt: string
  /**
   * `true` ⇒ `prompt` already has this scene's look clauses folded into its
   * words, so the importer must NOT project `look` over it again (studio gags
   * its Look pickers for that scene's first Generate). Written by studio's
   * exporter when the only prose it had was a pre-2026-08 rendered result;
   * a hand-authored document leaves it out and its `look` projects normally.
   */
  promptBaked?: true
  negativePrompt?: string
  model?: string
  aspectRatio?: string
  resolution?: string
  count?: number
  referenceImageUrls?: string[]
  /**
   * The Structured Subject builder's picks (plan-import-v2 D9) — WHO/WHAT is in
   * the frame, `registry.subject`'s own field vocabulary (D1). LOOK-MAP-SHAPED,
   * not a fixed-shape node (R31a): a dimension field key with one id, or a
   * multi-pick dimension's array, repaired against `registry.subject` exactly
   * as `picks` repairs against a picker (an unknown field/id drops, a value
   * settles onto the dimension's own `multi`/`maxPicks`).
   */
  subject?: Record<string, string | string[]>
}

/** The `/` audio cue's document vocabulary and shape (plan-import-v2 D3) — the
 *  platform's own analyzer modes and layer, widened by studio's `tone` (R68).
 *  Both live in `audio.ts`, next to the ONE mapping that reads them and pinned
 *  there to {@link VoiceDirectionKind} at compile time, so the document's modes
 *  and the editor's chip kinds can never drift apart; re-exported here so the
 *  document's types stay importable from one module. */
export { AUDIO_MODES, type AudioLayer, type AudioMode } from "./audio"

/** The Directing stage's plan. `prompt` is used only by a scene with no `shots`
 *  (a scene with shots writes its motion in them — §3). */
export interface MotionDocument {
  prompt?: string
  /**
   * The scene's GENERIC PROMPT — what the whole clip is about, standing over
   * every shot in it (`Shot.scenePrompt`).
   *
   * Its OWN key, never {@link prompt}: repair deletes `prompt` the moment the
   * scene has `shots`, and standing over shots is this field's whole job. It
   * lives under `motion` because that is the stage it is rendered by; the scene
   * has no other document seat for directing prose.
   */
  scenePrompt?: string
  negativePrompt?: string
  model?: string
  aspectRatio?: string
  resolution?: string
  duration?: number
  cameraMotionId?: string
  /**
   * Which input drives this scene's motion (plan-import-v2 D3) — one of the
   * platform's four {@link DirectingMode DirectingModes} (`start`,
   * `start-end`, `references`, `text`), a PLAIN STRING ENUM on this
   * fixed-shape node (R31a — not a look-map-shaped one like `frame.subject`;
   * the unknown-key sweep already covers `motion`). Repair gates it against
   * the RESOLVED model's own `inputs` row (`registry.ts`'s `RegistryModel`,
   * D1) — the same model `repairModel` already settled the aspect ratio,
   * resolution and duration levers against, so the option check and the
   * model check can never disagree about which model they mean.
   */
  input?: string
  /**
   * How the scene GOES OUT — the transition its last frames run, so the clip
   * ends ready to meet the next scene's own opening (`Shot.endTransition`).
   *
   * Under `motion` because that is the stage that renders it, and its OWN key
   * rather than a shot's `transition`: a shot's transition is how THAT shot
   * comes IN, and which shot is last changes with every split, merge and
   * reorder. The next scene's shot 1 still carries its own way in — the two are
   * independent renders, not one boundary said twice.
   */
  endTransition?: LeverNode
  referenceImageUrls?: string[]
  referenceVideoUrls?: string[]
  referenceAudioUrls?: string[]
  /** Cues for a scene WITHOUT shots — a scene WITH shots carries them per-shot
   *  instead (D3, D5; repair moves any scene-level cues onto the first one). */
  audio?: AudioLayer[]
}

/** A transition / character-FX node: the catalog pick plus its timing levers. */
export interface LeverNode {
  id: string
  position?: string
  duration?: string
  intensity?: string
}

/** One timed shot of a scene (`ShotBeat` in the store). */
export interface ShotDocument {
  seconds: number
  text: string
  label?: string
  picks?: Record<string, string | string[]>
  transition?: LeverNode
  characterFx?: LeverNode
  /** This shot's own `/` cues (D3, D5) — the neutral `[text]` tokens stay in
   *  `text`; only the semantic list rides its own key. */
  audio?: AudioLayer[]
}

/**
 * This scene's voiceover — the plan a `text-to-speech` run would use
 * (plan-import-v2 D4). `text` (the spoken line) and `casting` (who says it,
 * in prose — not yet bound to `cast`, mirroring a `speech` audio cue's own
 * `speaker`) are what a hand-authored or generated plan carries (skill rule
 * 15); `voiceId`, `voiceType`, `ttsProvider`, `model` and `delivery` are what
 * a STUDIO EXPORT additionally writes (`PlanVoice`'s own fields minus `url` —
 * media never rides this format, D8's rule for every stage), so a
 * studio-to-studio hop restores the exact voice and tuning, not only the line.
 */
export interface VoiceDocument {
  text: string
  casting?: string
  voiceId?: string
  /** {@link VoiceType} (`@nodaro/shared`) — pinned so premade/library/custom
   *  can never drift between the format and the platform's own field. */
  voiceType?: VoiceType
  /** Kept a plain string here (unlike {@link import("../shot").ShotVoice}'s
   *  narrower `TtsProvider`): a newer provider id must still travel through an
   *  imported document — the plan mapping (`import.ts`'s `toPlanVoice`) is
   *  where it narrows. */
  ttsProvider?: string
  model?: string
  /** {@link VoiceDeliverySettings}'s own shape — the bounds and the
   *  prune-to-defaults rule stay in that ONE module (`voice-delivery-settings.ts`). */
  delivery?: VoiceDeliverySettings
}

/**
 * The production's ONE soundtrack — a plan for `text_to_music` (Suno), or the
 * document-shaped half of a rendered one (plan-import-v2 D5). Unlike
 * {@link VoiceDocument}, EVERY field here is one the generator (and a
 * hand-authored plan) may write — the Music catalog's own pickers, not a
 * studio-export-only extension — because `music-options.ts`'s catalogs are
 * text tags folded into the Suno prompt, not platform ids a model call needs
 * verified (skill rule 16). `duration` is the one exception worth naming: it
 * is STORED on {@link import("../shot").ProductionMusic} for display and
 * restore, but `useMusic`'s `generate` never sends it to Suno (there is no
 * length flag on `/v1/suno/generate`) — see the legend's `## Music` section.
 */
export interface MusicDocument {
  prompt: string
  duration?: number
  /** {@link Vocals} (`music-options`) — the LENIENT zod shape underneath
   *  parses any string (mirrors {@link VoiceDocument.voiceType}'s own
   *  transform), so a newer studio's value still PARSES; repair is what
   *  narrows it against `registry.music.vocals`. */
  vocals?: Vocals
  /** {@link VocalGender} — same lenient-parse-then-repair-narrows discipline
   *  as {@link vocals}. */
  vocalGender?: VocalGender
  genre?: string
  mood?: string
  instruments?: string[]
  singingStyle?: string
  language?: string
}

/** One scene (`Shot` in the store). */
export interface SceneDocument {
  name?: string
  folder?: string
  look?: LookMap
  frame?: FrameDocument
  motion?: MotionDocument
  shots?: ShotDocument[]
  voice?: VoiceDocument
}

/**
 * The kinds a cast entry can name — the platform's four entity kinds
 * (`EntityKind`), and the ONE list every reader shares: the importer's own
 * gate (`castMatches`), the plan triage's rows, the skill's rule 10, and the
 * `CastEntry["kind"]` union below. Five hand-rolled copies of four strings is
 * how a fifth one silently disagrees; `coverage-guard.test.ts` pins this
 * against the entity layer and the published `schema.json` enum, which keeps
 * its own literal on purpose (a contract derived from this list could never
 * catch it drifting).
 *
 * ORDERED: `render-skill.ts` joins it into the rendered rule, so the sequence
 * is part of the published bytes.
 */
export const CAST_KIND_LIST = ["character", "location", "object", "creature"] as const

/**
 * {@link CAST_KIND_LIST} as the membership test its readers actually make.
 * Four PLAN kinds only, no `image` — unlike `cast.ts`'s private
 * `CAST_PANEL_KINDS`, which SPREADS this list and adds `image` for a cast row
 * bound to a bare image. That direction is deliberate and the only one there
 * is: the plan format knows nothing about `cast.ts`, so a fifth entity kind is
 * added here once and the panel's five follow.
 */
export const CAST_KINDS: ReadonlySet<string> = new Set(CAST_KIND_LIST)

/**
 * What the author proposes the production needs. INFORMATIONAL — the IMPORTER
 * itself creates nothing (D4), and unresolved rows are listed in the preview.
 *
 * The one exception is USER-INITIATED and lives outside the pipeline: "Create
 * them…" in that preview spawns the rows the user picks, from the image the
 * entry carries (D8). Nothing about opening a file creates anything.
 */
export interface CastEntry {
  kind: (typeof CAST_KIND_LIST)[number]
  name: string
  description?: string
  /** The image an unresolved entry can be CREATED from (plan-import-v2 D8) —
   *  a bound reference's own canonical url, so the row offers "create from this
   *  image" rather than name-only. Written by a studio EXPORT, on every bound
   *  cast row whose CANONICAL chip carries an image (a scene's pinned VIEW is a
   *  pose, not the actor, and supplies none); an authored plan leaves it out. */
  imageUrl?: string
}

export interface ProductionDocument {
  format: typeof FORMAT_ID
  version: number
  title?: string
  /** The production's own logline (plan-import-v2 D6) — a root prose field, no
   *  catalog shape, so it needs neither a fixed-shape node nor an entry beyond
   *  {@link DOCUMENT_KEYS}. Lands in `settings.studio.storyboard.brief`
   *  (`useLandProduction`'s `createFrom`); the Describe path falls back to
   *  what the user TYPED when the generated document carries none. */
  brief?: string
  film?: LookMap
  folders?: string[]
  scenes: SceneDocument[]
  cast?: CastEntry[]
  /**
   * The production's one soundtrack (plan-import-v2 D5) — REPAIRED for real
   * (see {@link MusicDocument}, `repairMusic` in `import-repair-sound.ts`).
   * Kept `unknown` here rather than typed as `MusicDocument` (fix round 2,
   * R42): the STRUCTURAL schema is the
   * importer's ONE trust boundary for shape (§6.2, this module's own doc
   * comment) — a slot the schema itself hard-fails on turns one malformed
   * field (`music: null`, a wrong-typed `instruments`, a `{}`) into the WHOLE
   * import failing, which cost every scene in the file for a soundtrack that
   * was always going to degrade to "no soundtrack" anyway. `repairMusic`
   * safe-parses this unknown value itself, one level below the structural
   * schema, and drops the node with one warning on a bad shape — exactly how
   * every other catalog-shaped repair in this format behaves (D11).
   */
  music?: unknown
}

/**
 * The keys each FIXED-SHAPE level carries. The importer's unknown-key sweep
 * reads them (§3: "unknown keys are dropped with a warning, at every level"),
 * and the coverage guard pins them against `Required<…>` fixtures of the types
 * above — so a field added to a document type without a sweep entry breaks CI
 * rather than silently warning on every file that uses it.
 *
 * `film` / `look` / `picks` are NOT here: their keys are picker keys, checked
 * against the registry by repair.
 */
export const DOCUMENT_KEYS: ReadonlySet<string> = new Set([
  "format",
  "version",
  "title",
  "brief",
  "film",
  "folders",
  "scenes",
  "cast",
  "music",
])
export const SCENE_KEYS: ReadonlySet<string> = new Set([
  "name",
  "folder",
  "look",
  "frame",
  "motion",
  "shots",
  "voice",
])
export const FRAME_KEYS: ReadonlySet<string> = new Set([
  "prompt",
  "promptBaked",
  "negativePrompt",
  "model",
  "aspectRatio",
  "resolution",
  "count",
  "referenceImageUrls",
  "subject",
])
export const MOTION_KEYS: ReadonlySet<string> = new Set([
  "prompt",
  "scenePrompt",
  "negativePrompt",
  "model",
  "aspectRatio",
  "resolution",
  "duration",
  "cameraMotionId",
  "input",
  "endTransition",
  "referenceImageUrls",
  "referenceVideoUrls",
  "referenceAudioUrls",
  "audio",
])
export const SHOT_KEYS: ReadonlySet<string> = new Set([
  "seconds",
  "text",
  "label",
  "picks",
  "transition",
  "characterFx",
  "audio",
])
export const LEVER_KEYS: ReadonlySet<string> = new Set([
  "id",
  "position",
  "duration",
  "intensity",
])
/** The keys ONE audio cue carries — `shots[n].audio[i]` / `motion.audio[i]`. */
export const AUDIO_KEYS: ReadonlySet<string> = new Set([
  "mode",
  "content",
  "voice",
  "speaker",
])
export const CAST_KEYS: ReadonlySet<string> = new Set([
  "kind",
  "name",
  "description",
  "imageUrl",
])
/** The keys ONE voiceover carries — `scenes[n].voice`. */
export const VOICE_KEYS: ReadonlySet<string> = new Set([
  "text",
  "casting",
  "voiceId",
  "voiceType",
  "ttsProvider",
  "model",
  "delivery",
])
/** The keys the production's ONE soundtrack carries — root `music`. */
export const MUSIC_KEYS: ReadonlySet<string> = new Set([
  "prompt",
  "duration",
  "vocals",
  "vocalGender",
  "genre",
  "mood",
  "instruments",
  "singingStyle",
  "language",
])
/** The keys `scenes[n].voice.delivery` carries — {@link VoiceDeliverySettings}'s
 *  own four fields. */
export const DELIVERY_KEYS: ReadonlySet<string> = new Set([
  "speed",
  "stability",
  "similarityBoost",
  "style",
])

// The lenient nodes below are EXPORTED for one reason: the coverage guard pins
// each one's own keys against the sweep's matching `*_KEYS` set (R50). A field
// added to a document type and its key set but not to the zod object here
// parses away silently — accepted by the sweep, then stripped before any
// reader sees it. Nothing outside the tests imports them.
const lookValue = z.union([z.string(), z.array(z.string())])
const lookMap = z.record(z.string(), lookValue)

export const leverNode = z.object({
  id: z.string(),
  position: z.string().optional(),
  duration: z.string().optional(),
  intensity: z.string().optional(),
})

// Lenient like `castEntry`: an unknown mode costs the cue at repair (D3), not
// the whole file.
export const audioLayer = z.object({
  mode: z.string().transform((mode) => mode as AudioMode),
  content: z.string(),
  voice: z.string().optional(),
  speaker: z.string().optional(),
})

export const frameDocument = z.object({
  prompt: z.string(),
  // Only the literal `true` is kept, and anything else becomes ABSENT rather
  // than a rejection: the flag's whole meaning is "absent = raw", so a
  // hand-authored `false` must land on the safe answer, not fail the import.
  // (The published STRICT schema keeps the bare literal — it is the contract,
  // and being narrower than the importer is the allowed direction, D11.)
  promptBaked: z.literal(true).optional().catch(undefined),
  negativePrompt: z.string().optional(),
  model: z.string().optional(),
  aspectRatio: z.string().optional(),
  resolution: z.string().optional(),
  count: z.number().optional(),
  referenceImageUrls: z.array(z.string()).optional(),
  // Same lenient shape as `look` / `picks` — repair gates it against
  // `registry.subject`, not the structural type here (D11).
  subject: lookMap.optional(),
})

export const motionDocument = z.object({
  prompt: z.string().optional(),
  scenePrompt: z.string().optional(),
  negativePrompt: z.string().optional(),
  model: z.string().optional(),
  aspectRatio: z.string().optional(),
  resolution: z.string().optional(),
  duration: z.number().optional(),
  cameraMotionId: z.string().optional(),
  // A plain string, not an enum — repair gates the value against the
  // RESOLVED model's own `inputs` row (D11: the structural type here decides
  // what a document IS, never what a catalog offers).
  input: z.string().optional(),
  endTransition: leverNode.optional(),
  referenceImageUrls: z.array(z.string()).optional(),
  referenceVideoUrls: z.array(z.string()).optional(),
  referenceAudioUrls: z.array(z.string()).optional(),
  audio: z.array(audioLayer).optional(),
})

// Numbers only, unconstrained (D11 — the STRICT published schema carries the
// {@link VOICE_DELIVERY_BOUNDS} min/max; this lenient one leaves an
// out-of-range value for repair to clamp, never a rejection).
export const deliveryDocument = z.object({
  speed: z.number().optional(),
  stability: z.number().optional(),
  similarityBoost: z.number().optional(),
  style: z.number().optional(),
})

// NOT z.enum on `vocals` / `vocalGender`, same reasoning as `voiceType` below —
// a newer studio's value must still PARSE; repair narrows both against
// `registry.music.vocals` / `.vocalGenders`. The five catalog fields
// (`genre`…`language`) stay plain strings for the same D11 reason `input` does
// above: what this catalog OFFERS is repair's business, not the document's.
//
// `prompt` is OPTIONAL here (fix round 2, R42) — unlike {@link MusicDocument}'s
// own TS shape, where it stays required for the STRICT schema and every
// downstream reader of a REPAIRED node. The root `music` slot itself parses as
// `z.unknown()` (see `PRODUCTION_DOCUMENT` below): this object exists ONLY for
// `repairMusic` (`import-repair-sound.ts`) to `.safeParse` that unknown value
// against, one level below the trust boundary. A missing/blank `prompt` is
// repair's business — it drops the node exactly like a whitespace-only one —
// not grounds to fail the WHOLE import the way D5 briefly made it (an
// unrelated field's wrong shape, or `music` being `null`/a string/`{}`, took
// down every scene with it).
export const musicDocument = z.object({
  prompt: z.string().optional(),
  duration: z.number().optional(),
  vocals: z
    .string()
    .optional()
    .transform((v) => v as MusicDocument["vocals"]),
  vocalGender: z
    .string()
    .optional()
    .transform((v) => v as MusicDocument["vocalGender"]),
  genre: z.string().optional(),
  mood: z.string().optional(),
  instruments: z.array(z.string()).optional(),
  singingStyle: z.string().optional(),
  language: z.string().optional(),
})

// NOT z.enum: a voiceType from a newer studio must not reject the whole
// document (D13 — the `castEntry.kind` precedent below); repair drops one this
// studio doesn't know.
export const voiceDocument = z.object({
  text: z.string(),
  casting: z.string().optional(),
  voiceId: z.string().optional(),
  voiceType: z
    .string()
    .optional()
    .transform((v) => v as VoiceDocument["voiceType"]),
  ttsProvider: z.string().optional(),
  model: z.string().optional(),
  delivery: deliveryDocument.optional(),
})

// A length off the tenths grid, or at zero, is REPAIRED (snapped, or the shot
// dropped with a warning) — never a rejection, so the number is unconstrained.
export const shotDocument = z.object({
  seconds: z.number(),
  text: z.string(),
  label: z.string().optional(),
  picks: z.record(z.string(), lookValue).optional(),
  transition: leverNode.optional(),
  characterFx: leverNode.optional(),
  audio: z.array(audioLayer).optional(),
})

// The one CROSS-FIELD rule the format has, and the reason the route-side schema
// is weaker than this one (§8): an `anyOf` of bare `required` branches converts
// to something that enforces nothing, so studio enforces at-least-one itself.
//
// FOUR stages, not three: `voice` was added in D4 and the refine never learned
// it, so a NARRATION-ONLY scene (a line, no framing and no shots) hard-rejected
// the WHOLE file. It lands as a plan-only shot carrying `plan.voice` — exactly
// what the exporter's own "a plan-only scene falls to `shot.plan?.voice`" rung
// already expects to read back. An EMPTY scene still rejects.
// The OBJECT is named separately from the refined node so the coverage guard
// can read its `shape` like every other lenient node's (R50): `.refine` wraps
// it in a `ZodEffects`, which has no `shape` of its own, and reaching through
// `._def` would pin a private zod field instead of the schema. Exported for
// the coverage guard's zod-shape pins only (B16) — `repairDocument` and every
// other reader import `sceneDocument`, below.
export const sceneObject = z.object({
  name: z.string().optional(),
  folder: z.string().optional(),
  look: lookMap.optional(),
  frame: frameDocument.optional(),
  motion: motionDocument.optional(),
  shots: z.array(shotDocument).optional(),
  voice: voiceDocument.optional(),
})

const sceneDocument = sceneObject.refine(
  (s) => !!s.frame || !!s.motion || !!s.shots || !!s.voice,
  { message: "a scene needs at least one of frame, motion, shots or voice" },
)

// NOT `z.enum`: a kind from a newer studio must never reject the whole document
// (D13 — the STRICT published schema keeps the four-value enum). Typed as the
// union so `CastEntry` is unchanged; resolve is where an entry this studio
// can't place is dropped, with a warning naming the kind.
export const castEntry = z.object({
  kind: z.string().transform((kind) => kind as CastEntry["kind"]),
  name: z.string(),
  description: z.string().optional(),
  imageUrl: z.string().optional(),
})

// SCREAMING_CASE, unlike its siblings above: exported for the coverage
// guard's zod-shape pins only (B16) — `productionDocumentSchema()`, below, is
// every other reader's entry point.
export const PRODUCTION_DOCUMENT = z.object({
  format: z.literal(FORMAT_ID),
  // Never `z.literal(FORMAT_VERSION)`: a file from a newer studio imports
  // best-effort with a banner rather than being refused (D13).
  version: z.number().int(),
  title: z.string().optional(),
  brief: z.string().optional(),
  film: lookMap.optional(),
  folders: z.array(z.string()).optional(),
  scenes: z.array(sceneDocument).min(1),
  cast: z.array(castEntry).optional(),
  // Unknown at THIS boundary (fix round 2, R42) — see `ProductionDocument.music`'s
  // own doc comment. `repairMusic` parses it against the exported `musicDocument`
  // shape one level below.
  music: z.unknown().optional(),
})

/** The structural schema — the importer's `validate` stage (§6.2). */
export function productionDocumentSchema(): z.ZodType<ProductionDocument> {
  return PRODUCTION_DOCUMENT
}
