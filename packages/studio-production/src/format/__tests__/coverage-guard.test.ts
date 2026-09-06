import { TTS_PROVIDERS, type VoiceType } from "@nodaro/shared"
import { describe, it, expect } from "vitest"

import type {
  StoryboardSettings,
  StudioSettingsV3,
  StudioShotEntryV2,
} from "../../shot-graph"
import type { ShotBeat, ShotCharacterFx, ShotTransition } from "../../shot"
import type { PlanFrame, PlanMotion, PlanVoice, ScenePlan } from "../../scene-plan"
import type { PlanMusic } from "../../shot"
import type { MusicSelections } from "../../music-options"
import type { RefEntityKind as EntityKind } from "../../ref-source-kind"
import type { ImportSummary } from "../import"
import { REF_SOURCE_KIND } from "../../ref-source-kind"
import {
  renderStrictJsonSchema,
  renderStructuralJsonSchema,
} from "../json-schema"
import { buildFormatRegistry } from "../registry"
import {
  AUDIO_KEYS,
  PRODUCTION_DOCUMENT,
  audioLayer,
  castEntry,
  deliveryDocument,
  frameDocument,
  leverNode,
  motionDocument,
  musicDocument,
  sceneObject,
  shotDocument,
  voiceDocument,
  CAST_KEYS,
  CAST_KINDS,
  CAST_KIND_LIST,
  DELIVERY_KEYS,
  DOCUMENT_KEYS,
  FORMAT_ID,
  FORMAT_VERSION,
  FRAME_KEYS,
  LEVER_KEYS,
  MOTION_KEYS,
  MUSIC_KEYS,
  SCENE_KEYS,
  SHOT_KEYS,
  VOICE_KEYS,
  type AudioLayer,
  type CastEntry,
  type FrameDocument,
  type LeverNode,
  type MotionDocument,
  type MusicDocument,
  type ProductionDocument,
  type SceneDocument,
  type ShotDocument,
  type VoiceDocument,
} from "../schema"
import { VOICE_TYPES } from "../../tts-provider"

/**
 * DERIVATION cannot decide portability — a field added to the persisted state
 * is either in the format or deliberately out of it, and only a person knows
 * which. These fixtures are `Required<…>`, so a new field breaks compilation;
 * the sets below then force the decision (spec §4).
 *
 * Adding a field? Put its key in MAPPED (it travels) or EXCLUDED (with the
 * reason in the comment) — never both, never neither.
 */
const settings: Required<StudioSettingsV3> = {
  version: 3,
  shots: [],
  selectedShotId: "s1",
  shotOrder: [],
  music: { url: "https://r2.example/m.mp3", prompt: "strings" },
  musicPlan: { prompt: "a driving synth pulse" },
  shared: true,
  folders: [],
  storyboard: {},
  cuts: [],
  freecutDraftUrl: "https://r2.example/draft.json",
  trash: [],
  film: {},
  cast: {},
  archived: true,
}
const SETTINGS_MAPPED = [
  "shots",
  "folders",
  "film",
  // A RENDERED soundtrack travels too, as of D5 — MINUS its `url` and
  // `provider` (media stays out, D8's rule for every stage; the url rides the
  // platform's own workflow export). `export.ts`'s `toMusicDocument` reads it
  // (`opts.music`), so it is MAPPED, not excluded — the same fix `voice` got
  // in D4 (see ENTRY_MAPPED below).
  "music",
  // The soundtrack PLAN — prompt + the flattened picker selections. Read on
  // BOTH of `toMusicDocument`'s branches since R44: a rendered track owns the
  // prose, the plan owns the pickers (a `ProductionMusic` has none). Also D5.
  "musicPlan",
  // The story BRIEF travels now too (plan-import-v2 D6) — MINUS every other
  // storyboard field (see STORYBOARD_MAPPED/STORYBOARD_EXCLUDED below).
  // `export.ts`'s `exportProduction` reads it (`opts.storyboard`), so the
  // whole struct is MAPPED, the same "one field turns the struct" fix `voice`
  // and `music` got above.
  "storyboard",
]
const SETTINGS_EXCLUDED = [
  "version", // the index's own shape
  "selectedShotId",
  "shotOrder", // derived on save
  "shared", // not a plan
  // The dashboard's soft-hide flag — a property of THIS account's list, not of
  // the production it hides. Exporting it would hand the recipient a file whose
  // import lands filtered out of their own dashboard (A4).
  "archived",
  "cuts",
  "freecutDraftUrl",
  "trash",
  // The PROJECT CAST REGISTRY (spec 2026-08-31-project-cast-registry) binds
  // role names to ACCOUNT-LOCAL asset ids. The plan format is the
  // account-PORTABLE authoring record — it deliberately carries no ids, and it
  // already has its own `cast` (a list of name + description sketches, see
  // `CastEntry`) as the portable spelling of the same idea. The id-carrying
  // path is the BUNDLE envelope (`WorkflowExport`, C5), not this format.
  "cast",
]

// `StoryboardSettings` is its own struct behind the settings row above — most
// of it is the Storyboard TAB's own scratch (open state, per-shot script
// drafts), never the format's business. `brief` is the one field that IS the
// format's business (plan-import-v2 D6): `export.ts`'s `exportProduction`
// reads `opts.storyboard?.brief`.
const storyboard: Required<StoryboardSettings> = {
  on: true,
  brief: "A rain-soaked chase through Rome.",
  filmLength: 30,
  scripts: {},
  breakdowns: {},
  seconds: {},
}
const STORYBOARD_MAPPED = ["brief"]
const STORYBOARD_EXCLUDED = [
  "on", // the Storyboard tab's own open/closed state
  "filmLength", // the tab's target-length input, not a plan decision
  "scripts", // per-shot generated script drafts — tab scratch
  "breakdowns", // per-shot generated breakdown drafts — tab scratch
  "seconds", // per-shot generated length drafts — tab scratch
]

const entry: Required<StudioShotEntryV2> = {
  id: "s1",
  name: "The chase begins",
  folderId: "f1",
  imageNodeId: "generate-image-1",
  videoNodeId: "generate-video-1",
  stillProvider: "gpt-image-2",
  clipProvider: "seedance-2",
  clipDuration: 10,
  voice: { url: "https://r2.example/v.mp3", text: "hi" },
  startFrameUrl: "https://r2.example/a.png",
  endFrameUrl: "https://r2.example/b.png",
  directingReferenceUrls: [],
  directingReferenceVideoUrls: [],
  directingReferenceAudioUrls: [],
  pendingClips: [],
  beats: [],
  scenePrompt: "A rain-soaked rooftop chase.",
  endTransition: {},
  look: {},
  castLook: {},
  plan: {},
  recipe: {},
}
const ENTRY_MAPPED = [
  "name",
  "folderId",
  "look",
  "beats",
  // The scene's GENERIC PROMPT is authored prose about the whole clip — the
  // most portable thing a scene owns, so it TRAVELS. It rides
  // `motion.scenePrompt` rather than `motion.prompt`: repair DELETES the latter
  // the moment a scene has shots, and standing over the shots is this field's
  // whole job.
  "scenePrompt",
  // How the scene GOES OUT — a catalog pick and three lever ids, no media and
  // no binding: the most portable thing there is, so it TRAVELS, on
  // `motion.endTransition`. Its own key beside `shots[].transition`, never
  // folded into one of them: a shot's transition is how THAT shot comes in, and
  // which shot is last changes with every split, merge and reorder.
  "endTransition",
  "directingReferenceUrls",
  "directingReferenceVideoUrls",
  "directingReferenceAudioUrls",
  "plan",
  // A RENDERED voiceover travels too now (plan-import-v2 D4) — MINUS its
  // result `url` (media stays out, D8's rule for every stage; the url rides
  // the platform's own workflow export). `export.ts`'s `toScene` reads it
  // (`stripUrl`), so it is MAPPED, not excluded.
  "voice",
]
const ENTRY_EXCLUDED = [
  "id", // re-minted (D3)
  "imageNodeId",
  "videoNodeId",
  "stillProvider",
  "clipProvider",
  "clipDuration", // results / denormalised
  "startFrameUrl",
  "endFrameUrl", // result urls
  "pendingClips", // in-flight jobs
  // A BUNDLE artifact (D25), not an authoring record: `recipe` holds the
  // regeneration inputs of a shot a "recipe only" bundle stripped of media, and
  // the store CONSUMES each layer as the real result lands. The plan format's
  // own authoring record is `plan` (mapped above), so exporting `recipe` too
  // would write the same scene twice with different provenance. Follow-up
  // (deliberately out of the merge that made the two features meet): decide
  // whether exporting a production whose scenes are still recipe-only should
  // read `recipe` as a plan fallback.
  "recipe",
  // The scene's CAST LOOK pins (spec 2026-08-31-project-cast-registry, D6f) key
  // off the project cast's ROLE SLUGS, and the cast itself is excluded above —
  // a pin without its registry names a role the format has no way to define. It
  // travels in the BUNDLE envelope alongside the cast, where the two stay
  // meaningful together.
  "castLook",
]

const beat: Required<ShotBeat> = {
  id: "b1",
  seconds: 4,
  label: "Sprint",
  text: "she sprints",
  picks: {},
  references: [],
  transition: {},
  characterFx: {},
  directions: [],
}
const BEAT_MAPPED = [
  "seconds",
  "label",
  "text",
  "picks",
  "transition",
  "characterFx",
  "references", // re-derived from the `@Name` prose
  "directions", // → shots[].audio (B5)
]
const BEAT_EXCLUDED = ["id"]

const planFrame: Required<PlanFrame> = {
  prompt: "an alley",
  promptBaked: true,
  provider: "gpt-image-2",
  aspectRatio: "16:9",
  resolution: "2K",
  count: 2,
  negativePrompt: "",
  references: [],
  referenceImageUrls: [],
  subject: {},
}
const planMotion: Required<PlanMotion> = {
  prompt: "she runs",
  provider: "seedance-2",
  aspectRatio: "16:9",
  resolution: "1080p",
  duration: 10,
  negativePrompt: "",
  references: [],
  cameraMotionId: "tracking-shot",
  input: "start",
  directions: [],
}
const planVoiceDelivery: Required<NonNullable<PlanVoice["delivery"]>> = {
  speed: 1.1,
  stability: 0.6,
  similarityBoost: 0.8,
  style: 0.2,
}
const planVoice: Required<PlanVoice> = {
  text: "Go now",
  casting: "male, urgent",
  voiceId: "rachel-1",
  voiceType: "premade",
  ttsProvider: "elevenlabs-v3",
  model: "eleven_v3",
  delivery: planVoiceDelivery,
}
// Spec §4's other three "every field" rows. The two lever nodes are pinned
// against the DOCUMENT's `LEVER_KEYS`, so a fourth lever added to either store
// type must reach `LeverNode` too; `ScenePlan` is pinned against its stages, so
// a third stage cannot be added without deciding how it travels.
const transition: Required<ShotTransition> = {
  id: "cross-dissolve",
  position: "start",
  duration: "short",
  intensity: "dynamic",
}
const characterFx: Required<ShotCharacterFx> = {
  id: "werewolf",
  position: "start",
  duration: "short",
  intensity: "crazy",
}
const plan: Required<ScenePlan> = { frame: planFrame, motion: planMotion, voice: planVoice }

// `PlanMusic` ↔ the production's soundtrack plan (plan-import-v2 D5). Fix
// round 2, item 6: `toMusicDocument` (export.ts) flattens seven `sel.*`
// fields by hand and `toPlanMusic` (import.ts) unflattens them by hand — a
// field added to `MusicSelections` without touching both would silently
// never travel. Pinned the same way `planVoice` is pinned against
// `VOICE_KEYS` above: `MusicSelections`' own keys equal `MUSIC_KEYS` minus
// the two fields `PlanMusic` carries at its own top level (`prompt`,
// `duration`), and `PlanMusic` itself is `{ prompt, duration?, selections? }`.
const musicSelections: Required<MusicSelections> = {
  vocals: "vocals",
  vocalGender: "female",
  genre: "synthwave",
  mood: "energetic",
  instruments: ["synth"],
  singingStyle: "powerful",
  language: "english",
}
const planMusic: Required<PlanMusic> = {
  prompt: "a driving synth pulse",
  duration: 20,
  selections: musicSelections,
}

/**
 * ImportSummary is the preview's own receipt (spec §6, A5) — every field the
 * pipeline computes about what will land. Every field is already required (no
 * `?`), so `Required<>` here is only this file's own fixture idiom, matching
 * `entry`/`beat`/`settings` above — it is not the mechanism. The mechanism is
 * `tsc --noEmit`: a field added to the interface without a matching entry in
 * this object literal fails to compile, which is what forces the receipt
 * decision the partition below records.
 */
const importSummary: Required<ImportSummary> = {
  scenes: 1,
  shots: 2,
  seconds: 10,
  imageModels: ["gpt-image-2"],
  videoModels: ["seedance-2"],
  lookPicks: 6,
  transitions: 2,
  audioCues: 2,
  cast: 1,
  castBound: 1,
  unresolvedCast: [],
  boundCast: [],
  brief: true,
  music: true,
  voices: 1,
  mentions: 2,
}
// The fields `ImportPreview.summaryLine` renders a part for (A5, R60) — see
// `ImportPreview.tsx` for what each part says.
const SUMMARY_RECEIPTED: ReadonlyArray<keyof ImportSummary> = [
  "scenes",
  "shots",
  "seconds",
  "imageModels",
  "videoModels",
  "lookPicks",
  "transitions",
  "audioCues",
  "brief",
  "music",
  "voices",
]
// `cast`/`castBound`/`unresolvedCast`/`boundCast` have their own receipt —
// `castLine`, the "Bound to your library" list and the "Not in your library yet"
// panel — never `summaryLine`'s own parts.
const SUMMARY_NO_RECEIPT: ReadonlyArray<keyof ImportSummary> = [
  "cast",
  "castBound",
  "unresolvedCast",
  "boundCast",
  // `mentions` GATES, it does not report (B12): the dialog holds its CTA until
  // the library settles for any document that names something bindable, and a
  // prose-only plan (`@mentions`, no `cast[]` rows) is exactly that. The user
  // already sees those names in the plan's own prose, so a receipt line
  // counting them would say nothing the preview doesn't.
  "mentions",
]

const keys = (o: object) => new Set(Object.keys(o))
const union = (...groups: ReadonlyArray<ReadonlyArray<string>>) =>
  new Set(groups.flat())
/** MAPPED ∩ EXCLUDED — the header's "never both". The set equality above only
 *  catches "never neither": a key listed TWICE still unions to the same set. */
const both = (a: ReadonlyArray<string>, b: ReadonlyArray<string>) =>
  a.filter((key) => b.includes(key))

describe("coverage guard — every persisted field is mapped or excluded", () => {
  it("settings.studio v3", () => {
    expect(both(SETTINGS_MAPPED, SETTINGS_EXCLUDED)).toEqual([])
    expect(keys(settings)).toEqual(union(SETTINGS_MAPPED, SETTINGS_EXCLUDED))
  })

  it("the storyboard struct — only `brief` travels (D6)", () => {
    expect(both(STORYBOARD_MAPPED, STORYBOARD_EXCLUDED)).toEqual([])
    expect(keys(storyboard)).toEqual(union(STORYBOARD_MAPPED, STORYBOARD_EXCLUDED))
  })

  it("the per-shot entry", () => {
    expect(both(ENTRY_MAPPED, ENTRY_EXCLUDED)).toEqual([])
    expect(keys(entry)).toEqual(union(ENTRY_MAPPED, ENTRY_EXCLUDED))
  })

  it("a shot beat", () => {
    expect(both(BEAT_MAPPED, BEAT_EXCLUDED)).toEqual([])
    expect(keys(beat)).toEqual(union(BEAT_MAPPED, BEAT_EXCLUDED))
  })

  it("the plan — every field travels", () => {
    // The plan types are where a new lever lands FIRST, so they are mapped
    // whole: `PlanFrame` ↔ `frame`, `PlanMotion` ↔ `motion` (minus the three
    // reference channels, omitted by the type itself — `directions` travels,
    // → shots[].audio / motion.audio, B5).
    expect(keys(planFrame)).toEqual(
      new Set([
        "prompt",
        // Travels WITH the prose it classifies: without it an imported legacy
        // prompt is indistinguishable from authored intent and the scene's look
        // folds twice (D4).
        "promptBaked",
        "provider",
        "aspectRatio",
        "resolution",
        "count",
        "negativePrompt",
        "references",
        "referenceImageUrls",
        "subject",
      ]),
    )
    expect(keys(planMotion)).toEqual(
      new Set([
        "prompt",
        "provider",
        "aspectRatio",
        "resolution",
        "duration",
        "negativePrompt",
        "references",
        "cameraMotionId",
        "input",
        "directions",
      ]),
    )
    // `PlanVoice` ↔ `voice` — mapped whole too (plan-import-v2 D4), pinned
    // against the document's own `VOICE_KEYS` / `DELIVERY_KEYS` the same way
    // `LeverNode` is pinned against `LEVER_KEYS` below.
    expect(keys(planVoice)).toEqual(new Set(VOICE_KEYS))
    expect(keys(planVoiceDelivery)).toEqual(new Set(DELIVERY_KEYS))
    expect(keys(plan)).toEqual(new Set(["frame", "motion", "voice"]))
    expect(keys(transition)).toEqual(new Set(LEVER_KEYS))
    expect(keys(characterFx)).toEqual(new Set(LEVER_KEYS))
    // `MusicSelections`' own fields are exactly `MUSIC_KEYS` minus the two
    // `PlanMusic` carries at its own top level (mirrors the `planVoice` /
    // `VOICE_KEYS` pin just above).
    expect(keys(musicSelections)).toEqual(
      new Set([...MUSIC_KEYS].filter((k) => k !== "prompt" && k !== "duration")),
    )
    expect(keys(planMusic)).toEqual(new Set(["prompt", "duration", "selections"]))
  })

  // `ImportSummary` is DERIVED, not persisted — it rides this describe for the
  // partition discipline, not the storage: every field is either receipted or
  // deliberately silent, and a new one must say which.
  it("ImportSummary — the fields summaryLine receipts, and the ones the cast line owns instead (A5)", () => {
    expect(both(SUMMARY_RECEIPTED, SUMMARY_NO_RECEIPT)).toEqual([])
    expect(keys(importSummary)).toEqual(union(SUMMARY_RECEIPTED, SUMMARY_NO_RECEIPT))
  })
})

describe("coverage guard — the unknown-key sweep knows every document field", () => {
  const music: Required<MusicDocument> = {
    prompt: "strings",
    duration: 20,
    vocals: "vocals",
    vocalGender: "female",
    genre: "synthwave",
    mood: "energetic",
    instruments: ["synth"],
    singingStyle: "powerful",
    language: "english",
  }
  const document: Required<ProductionDocument> = {
    format: FORMAT_ID,
    version: FORMAT_VERSION,
    title: "T",
    brief: "A rain-soaked chase through Rome.",
    film: {},
    folders: [],
    scenes: [],
    cast: [],
    music,
  }
  const scene: Required<SceneDocument> = {
    name: "S",
    folder: "Act 1",
    look: {},
    frame: { prompt: "p" },
    motion: {},
    shots: [],
    voice: { text: "Go now" },
  }
  const frame: Required<FrameDocument> = {
    prompt: "p",
    promptBaked: true,
    negativePrompt: "",
    model: "gpt-image-2",
    aspectRatio: "16:9",
    resolution: "2K",
    count: 1,
    referenceImageUrls: [],
    subject: {},
  }
  const motion: Required<MotionDocument> = {
    prompt: "p",
    negativePrompt: "",
    model: "seedance-2",
    aspectRatio: "16:9",
    resolution: "1080p",
    duration: 10,
    scenePrompt: "A rain-soaked rooftop chase.",
    endTransition: { id: "cross-dissolve" },
    cameraMotionId: "tracking-shot",
    input: "start",
    referenceImageUrls: [],
    referenceVideoUrls: [],
    referenceAudioUrls: [],
    audio: [],
  }
  const shot: Required<ShotDocument> = {
    seconds: 4,
    text: "t",
    label: "L",
    picks: {},
    transition: { id: "cross-dissolve" },
    characterFx: { id: "werewolf" },
    audio: [],
  }
  const lever: Required<LeverNode> = {
    id: "cross-dissolve",
    position: "start",
    duration: "short",
    intensity: "dynamic",
  }
  const cast: Required<CastEntry> = {
    kind: "character",
    name: "Natalie",
    description: "late 20s",
    imageUrl: "https://r2.example/n.png",
  }
  const audio: Required<AudioLayer> = {
    mode: "speech",
    content: "Go!",
    voice: "urgent",
    speaker: "Natalie",
  }
  const delivery: Required<NonNullable<VoiceDocument["delivery"]>> = {
    speed: 1.1,
    stability: 0.6,
    similarityBoost: 0.8,
    style: 0.2,
  }
  const voice: Required<VoiceDocument> = {
    text: "Go now",
    casting: "male, urgent",
    voiceId: "rachel-1",
    voiceType: "premade",
    ttsProvider: "elevenlabs-v3",
    model: "eleven_v3",
    delivery,
  }

  it("sweeps exactly the keys the document types declare", () => {
    expect(keys(document)).toEqual(new Set(DOCUMENT_KEYS))
    expect(keys(scene)).toEqual(new Set(SCENE_KEYS))
    expect(keys(frame)).toEqual(new Set(FRAME_KEYS))
    expect(keys(motion)).toEqual(new Set(MOTION_KEYS))
    expect(keys(shot)).toEqual(new Set(SHOT_KEYS))
    expect(keys(lever)).toEqual(new Set(LEVER_KEYS))
    expect(keys(cast)).toEqual(new Set(CAST_KEYS))
    expect(keys(audio)).toEqual(new Set(AUDIO_KEYS))
    expect(keys(voice)).toEqual(new Set(VOICE_KEYS))
    expect(keys(delivery)).toEqual(new Set(DELIVERY_KEYS))
    expect(keys(music)).toEqual(new Set(MUSIC_KEYS))
  })
})

/**
 * ONE CAST-KIND VOCABULARY. The four kinds are named by the document type, by
 * the importer's own gate, by the plan triage, by the skill's rule 10 and by
 * the published `schema.json` — five readers of one list, which is exactly how
 * a fifth hand-rolled copy drifts. {@link CAST_KIND_LIST} is the source; this
 * pins it against the two vocabularies it must equal and cannot import from:
 * the ENTITY layer's `EntityKind` (a type, so the runtime side is read off
 * `REF_SOURCE_KIND`, the one runtime table keyed by it) and the PUBLISHED
 * contract's own enum, which stays a literal on purpose — a contract that
 * derived itself from this list could never disagree with it, and disagreeing
 * is the whole job of a guard.
 */
// The document's kinds ARE entity kinds, and every entity kind is one — the
// house compile-time pin (`audio.ts`'s `_modesAreKinds`), in both directions.
const _kindsAreEntityKinds: ReadonlyArray<EntityKind> = CAST_KIND_LIST
void _kindsAreEntityKinds
const _entityKindIsACastKind: CastEntry["kind"] = "character" as EntityKind
void _entityKindIsACastKind

describe("coverage guard — one cast-kind vocabulary", () => {
  const sorted = (kinds: Iterable<string>) => [...kinds].sort()

  it("the set, the list and the entity layer name the same four kinds", () => {
    expect(sorted(CAST_KINDS)).toEqual(sorted(CAST_KIND_LIST))
    // `REF_SOURCE_KIND` maps every chip source onto an `EntityKind` (or the
    // cast-less `image`) — the runtime list `EntityKind` itself doesn't have.
    const entityKinds = new Set(
      Object.values(REF_SOURCE_KIND).filter((kind) => kind !== "image"),
    )
    expect(sorted(CAST_KINDS)).toEqual(sorted(entityKinds))
  })

  /** The `cast[].kind` enum a rendered schema publishes. BOTH renderers keep
   *  their own literal — the STRICT one is the published contract, the
   *  STRUCTURAL one is what the generator is forced to answer in — so both are
   *  read here, through one accessor. */
  const castKindEnum = (schema: Record<string, unknown>): string[] =>
    (
      schema as unknown as {
        properties: { cast: { items: { properties: { kind: { enum: string[] } } } } }
      }
    ).properties.cast.items.properties.kind.enum

  it("and BOTH published schemas enum exactly those four", () => {
    const registry = buildFormatRegistry()
    expect(sorted(CAST_KINDS)).toEqual(
      sorted(castKindEnum(renderStrictJsonSchema(registry))),
    )
    expect(sorted(CAST_KINDS)).toEqual(
      sorted(castKindEnum(renderStructuralJsonSchema(registry))),
    )
  })
})

/**
 * ONE VOICE-TYPE VOCABULARY (plan-import-v2 D4; relocated to `tts-provider.ts`
 * fix round 1, R38-2 — the voice DOMAIN's own home, not the import/export
 * layer's `production-format/schema.ts`). `@nodaro/shared` exports only the
 * TYPE `VoiceType`; {@link VOICE_TYPES} is the one runtime spelling of it,
 * read by repair's `voiceType` check, `scene-plan.ts`'s `readVoice` and the
 * strict schema's enum. Pinned both directions, the same
 * `_kindsAreEntityKinds` / `_entityKindIsACastKind` discipline above.
 */
const _voiceTypesAreVoiceType: ReadonlyArray<VoiceType> = VOICE_TYPES
void _voiceTypesAreVoiceType
const _voiceTypeIsListed: (typeof VOICE_TYPES)[number] = "premade" as VoiceType
void _voiceTypeIsListed

describe("coverage guard — one voice-type vocabulary", () => {
  const sorted = (values: Iterable<string>) => [...values].sort()

  /** `scenes[].voice.voiceType` enum the STRICT schema publishes (D11 — the
   *  structural one carries no `voiceType` at all, R31c/skill rule 15). */
  const voiceTypeEnum = (schema: Record<string, unknown>): string[] =>
    (
      schema as unknown as {
        properties: {
          scenes: { items: { properties: { voice: { properties: { voiceType: { enum: string[] } } } } } }
        }
      }
    ).properties.scenes.items.properties.voice.properties.voiceType.enum

  it("the strict schema enums exactly VOICE_TYPES", () => {
    const registry = buildFormatRegistry()
    expect(sorted(VOICE_TYPES)).toEqual(sorted(voiceTypeEnum(renderStrictJsonSchema(registry))))
  })
})

/**
 * ONE TTS-PROVIDER VOCABULARY (fix round 1, R38-1). `isTtsProvider`
 * (`tts-provider.ts`) is the ONE guard every reader of an untrusted
 * `ttsProvider` field uses — repair's `repairVoice`, `scene-plan.ts`'s
 * `readVoice` — reading the platform's own `TTS_PROVIDERS`, never a
 * hand-typed copy. This pins the strict schema's `ttsProvider` enum against
 * that same list.
 */
describe("coverage guard — one tts-provider vocabulary", () => {
  const sorted = (values: Iterable<string>) => [...values].sort()

  const ttsProviderEnum = (schema: Record<string, unknown>): string[] =>
    (
      schema as unknown as {
        properties: {
          scenes: { items: { properties: { voice: { properties: { ttsProvider: { enum: string[] } } } } } }
        }
      }
    ).properties.scenes.items.properties.voice.properties.ttsProvider.enum

  it("the strict schema enums exactly TTS_PROVIDERS", () => {
    const registry = buildFormatRegistry()
    expect(sorted(TTS_PROVIDERS)).toEqual(
      sorted(ttsProviderEnum(renderStrictJsonSchema(registry))),
    )
  })
})

/**
 * R50 — EVERY LENIENT ZOD NODE, against the sweep's own key set.
 *
 * The guards above pin the document TYPES against `*_KEYS`. The half that was
 * missing is ZOD ↔ KEYS: a field added to a document type and to its key set
 * but not to the zod object here is accepted by the unknown-key sweep and then
 * STRIPPED by `safeParse` before any reader sees it — no warning, no receipt,
 * the field simply never arrives. R42 made that concrete for `music` (its trust
 * boundary moved inside repair); the same hazard is at every other node.
 */
describe("coverage guard — every lenient zod node carries its own key set", () => {
  const nodes: ReadonlyArray<
    readonly [string, { readonly shape: Record<string, unknown> }, ReadonlySet<string>]
  > = [
    // The two levels leg D actually ADDED fields to, and the two the first
    // pass skipped: the ROOT document (`brief` in D6, `music` in D5) and the
    // SCENE (`voice` in D4). `sceneObject` is the un-refined half of
    // `sceneDocument` — a `.refine` wraps the object in a `ZodEffects` with no
    // `shape` of its own, so the object is named in schema.ts rather than
    // reached through a private `._def`.
    ["PRODUCTION_DOCUMENT", PRODUCTION_DOCUMENT, DOCUMENT_KEYS],
    ["sceneObject", sceneObject, SCENE_KEYS],
    ["frameDocument", frameDocument, FRAME_KEYS],
    ["motionDocument", motionDocument, MOTION_KEYS],
    ["shotDocument", shotDocument, SHOT_KEYS],
    ["voiceDocument", voiceDocument, VOICE_KEYS],
    ["deliveryDocument", deliveryDocument, DELIVERY_KEYS],
    ["musicDocument", musicDocument, MUSIC_KEYS],
    ["castEntry", castEntry, CAST_KEYS],
    ["audioLayer", audioLayer, AUDIO_KEYS],
    ["leverNode", leverNode, LEVER_KEYS],
  ]

  for (const [name, node, keys] of nodes) {
    it(`${name} parses exactly the keys the sweep knows`, () => {
      expect(Object.keys(node.shape).sort()).toEqual([...keys].sort())
    })
  }
})
