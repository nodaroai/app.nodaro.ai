import type { PickerDimension } from "@nodaro/prompts"
import { getVideoAudioCapability, type VideoAudioMode } from "@nodaro/shared"

import { BEATS_AUTHOR_CAP_SECONDS, BEAT_MIN_SECONDS, BEAT_SECONDS_STEP } from "../beats"
import { MAX_CANDIDATES } from "../candidates"
import { characterFxDimensions } from "../character-fx"
import { FILM_LOOK_KEYS } from "../look-layers"
import {
  CAMERA_MOVEMENT_KEY,
  CHARACTER_FX_KEY,
  LOOK_PICKERS,
  cameraMovementPicker,
  characterFxPicker,
  type LookPickerConfig,
} from "../look-pickers"
import {
  DEFAULT_FRAMING_ASPECT,
  DEFAULT_FRAMING_PROVIDER,
  DEFAULT_FRAMING_RESOLUTION,
  DEFAULT_VIDEO_PROVIDER,
  imageModelOptions,
  supportedDirectingModes,
  videoModelOptions,
  type DirectingMode,
  type ModelMenuOption,
} from "../model-menu"
import {
  MUSIC_GENRES,
  MUSIC_INSTRUMENTS,
  MUSIC_LANGUAGES,
  MUSIC_MAX_DURATION_SECONDS,
  MUSIC_MOODS,
  MUSIC_SINGING_STYLES,
  MUSIC_VOCALS,
  MUSIC_VOCAL_GENDERS,
  type MusicOption,
  type VocalGender,
  type Vocals,
} from "../music-options"
import { AUDIO_MODES, type AudioMode } from "./schema"
import { ANIMAL_PICKER, PROP_PICKERS, SUBJECT_MULTIDIM, type PropPicker } from "../subject-pickers"
import { TRANSITION_DIMENSION, transitionDimensions } from "../transition"

/**
 * THE REGISTRY VIEW — one read-only projection of everything that already
 * drives the editor, and the ONLY input the format's five artifacts take.
 *
 * The point is derivation, not discipline (spec §4): a picker added to
 * `LOOK_PICKERS`, a lever row added to a catalog dimension, a model added to an
 * allowlist or a new duration on a model appears in the validator, the
 * published schema, the skill and the LLM legend with zero code here. Nothing
 * is re-declared — every field below names where it is read from.
 *
 * BROWSER-FREE BY CONTRACT. `scripts/gen-production-skill.ts` runs this closure
 * under plain node, and the drift test executes it in CI, so a `import.meta.env`
 * or React import creeping into any module reached from here fails the build
 * rather than the release. That is why `MAX_CANDIDATES` lives in
 * `lib/candidates` and `FILM_LOOK_KEYS` in `lib/look-layers` — their previous
 * homes pull React and the Nodaro client respectively.
 */

/** One selectable row — the id the format speaks, the label a human reads, and
 *  the short professional TERM the model reads (the picker's own `getTerm`). */
export interface RegistryOption {
  readonly id: string
  readonly label: string
  readonly term: string
}

/** One WHO/WHAT sub-dimension the Structured Subject builder writes —
 *  `frame.subject`'s own vocabulary (D1). A multi-dim row (Person's Hair
 *  Color, Styling's Jewelry) and a single-pick prop (Held Prop, Animal) both
 *  flow through this shape; `section` is the builder's own UI grouping
 *  ("Person · Hair", "Styling · Wardrobe", "Props"), never re-labelled here. */
export interface RegistrySubjectDimension {
  readonly field: string
  readonly label: string
  readonly section: string
  readonly multi: boolean
  /** 1 for a single-pick dimension, the picker's own cap for a multi one. */
  readonly maxPicks: number
  readonly options: ReadonlyArray<RegistryOption>
}

/** The Soundtrack picker's option lists — `music-options`'s own catalogs,
 *  read verbatim (D5 gives them a strict shape; D1 only publishes the
 *  vocabulary). `vocals` / `vocalGenders` are pinned against that module's own
 *  {@link Vocals} / {@link VocalGender} types rather than hand-typed twice. */
export interface RegistryMusic {
  readonly genres: ReadonlyArray<RegistryOption>
  readonly moods: ReadonlyArray<RegistryOption>
  readonly instruments: ReadonlyArray<RegistryOption>
  readonly singingStyles: ReadonlyArray<RegistryOption>
  readonly languages: ReadonlyArray<RegistryOption>
  readonly vocals: ReadonlyArray<Vocals>
  readonly vocalGenders: ReadonlyArray<VocalGender>
  readonly maxDuration: number
}

/** One cinematic dimension. `usableAsPick` is the ROLE the renderers branch on:
 *  true for `LOOK_PICKERS` + Camera Movement (the keys a shot's `picks` can
 *  name, exactly what the fold's `beatContent` resolves), false for Character
 *  FX, whose rows feed the `characterFx.id` vocabulary instead. */
export interface RegistryPicker {
  readonly key: string
  readonly label: string
  readonly surface: string
  readonly multi: boolean
  /** 1 for a single-pick dimension, the catalog's cap for a multi-pick one. */
  readonly maxPicks: number
  readonly usableAsPick: boolean
  readonly options: ReadonlyArray<RegistryOption>
}

/** One timing scale of a lever node, as the catalog publishes it. */
export interface RegistryDimension {
  readonly field: "position" | "duration" | "intensity"
  readonly label: string
  readonly options: ReadonlyArray<RegistryOption>
}

/** A lever NODE — the effect's own ids plus its timing scales. */
export interface RegistryNode {
  readonly ids: ReadonlyArray<RegistryOption>
  readonly dimensions: ReadonlyArray<RegistryDimension>
}

/** One model row of the curated menu, with the option vocabulary IT declares —
 *  verbatim (`2K` on gpt-image-2, `2 MP` on flux-2, `1080p` on seedance-2;
 *  studio never normalises them, D15). A video model's largest duration is its
 *  scene shots budget (`beatsCapSeconds`). */
export interface RegistryModel {
  readonly id: string
  readonly label: string
  readonly aspectRatios: ReadonlyArray<string>
  readonly resolutions: ReadonlyArray<string>
  readonly durations: ReadonlyArray<number>
  /** Video models: what audio cue the model can carry (`getVideoAudioCapability`,
   *  §3's `AUDIO_MODES` collapsed to what a MODEL, not a cue, can honor).
   *  Absent on an image model — a still carries no audio channel at all. */
  readonly audio?: "none" | "ambient" | "speech"
  /** Video models: the directing modes THIS model supports, in canonical
   *  order (`supportedDirectingModes`, D1) — `motion.input`'s per-model
   *  vocabulary. Absent on an image model — framing has no directing input. */
  readonly inputs?: ReadonlyArray<DirectingMode>
}

export interface FormatRegistry {
  readonly pickers: ReadonlyArray<RegistryPicker>
  /** The keys the FILM layer owns (`filmLayerWrite` drops the rest, D14). */
  readonly filmKeys: ReadonlySet<string>
  readonly transition: RegistryNode
  readonly characterFx: RegistryNode
  readonly imageModels: ReadonlyArray<RegistryModel>
  readonly videoModels: ReadonlyArray<RegistryModel>
  /** The `/` cue vocabulary — {@link AUDIO_MODES}, published so the legend, the
   *  two JSON Schemas and the skill read ONE list rather than each spelling it. */
  readonly audio: { readonly modes: ReadonlyArray<AudioMode> }
  /** `frame.subject`'s vocabulary — every Structured Subject dimension
   *  (Person, Styling, the single-pick props), flattened to one list (D1). */
  readonly subject: ReadonlyArray<RegistrySubjectDimension>
  /** The Soundtrack picker's catalogs — `music.*`'s vocabulary (D1; D5 gives
   *  it a strict shape). */
  readonly music: RegistryMusic
  /** The tenths grid, the shortest window the ladder offers, and the budget for
   *  a model with NO duration lever (the real per-scene budget is
   *  `max(model.durations)`). `minSeconds` is the floor the analysis mapping
   *  states to the generator — read from `lib/beats`, never written down in the
   *  prose, so the doctrine and the editor's ladder cannot disagree. */
  readonly shots: {
    readonly step: number
    readonly minSeconds: number
    readonly fallbackCapSeconds: number
  }
  readonly candidates: { readonly max: number }
  readonly defaults: {
    readonly imageModel: string
    readonly videoModel: string
    readonly aspectRatio: string
    readonly resolution: string
  }
}

/**
 * The three scales the FORMAT can carry (`{ id, position?, duration?,
 * intensity? }`, §3). The catalogs publish exactly these; a fourth would need
 * a format version bump, so it is dropped here rather than smuggled into the
 * current one — `registry.test.ts` fails loudly the day one appears.
 */
const LEVER_FIELDS: ReadonlyArray<RegistryDimension["field"]> = [
  "position",
  "duration",
  "intensity",
]

function isLeverField(field: string): field is RegistryDimension["field"] {
  return (LEVER_FIELDS as ReadonlyArray<string>).includes(field)
}

/** A picker config → its registry row. Labels and terms resolve through the
 *  picker's OWN helpers, so retirement and the `auto`/`none` no-ops behave
 *  exactly as they do in the menus. */
function toPicker(p: LookPickerConfig): RegistryPicker {
  return {
    key: p.key,
    label: p.label,
    surface: p.surface,
    multi: p.multi === true,
    maxPicks: p.multi === true ? (p.maxPicks ?? 2) : 1,
    usableAsPick: p.key !== CHARACTER_FX_KEY,
    options: p.catalog.map((e) => ({
      id: e.id,
      label: p.getLabel(e.id),
      term: p.getTerm(e.id),
    })),
  }
}

function toDimensions(
  dimensions: ReadonlyArray<PickerDimension>,
): ReadonlyArray<RegistryDimension> {
  return dimensions.filter((d) => isLeverField(d.field)).map((d) => ({
    field: d.field as RegistryDimension["field"],
    label: d.label,
    options: d.options.map((o) => ({ id: o.id, label: o.label, term: o.term })),
  }))
}

/** `getVideoAudioCapability`'s four-value `VideoAudioMode` collapsed to the
 *  three the registry publishes: `native_speech` and `audio_driven` both mean
 *  "this model can carry a voice", so both read as `speech` — the legend and
 *  the schema gate on WHETHER a model speaks, never on HOW. A TOTAL map, not a
 *  ternary chain with an unguarded else — a fifth `VideoAudioMode` added to
 *  `@nodaro/shared` fails `tsc` here rather than silently publishing `speech`
 *  for a model that cannot speak. */
const MODEL_AUDIO: Record<VideoAudioMode, NonNullable<RegistryModel["audio"]>> = {
  none: "none",
  ambient: "ambient",
  native_speech: "speech",
  audio_driven: "speech",
}

function audioModeOf(id: string): "none" | "ambient" | "speech" {
  return MODEL_AUDIO[getVideoAudioCapability(id).mode]
}

/** A curated menu row → its registry row (the menu IS `buildModelMenu`, so
 *  every capability is the catalog's; the labels carry the app's overrides). */
function toModel(m: ModelMenuOption, kind: "image" | "video"): RegistryModel {
  return {
    id: m.id,
    label: m.label,
    aspectRatios: m.aspectRatios.map((o) => o.value),
    resolutions: m.resolutions.map((o) => o.value),
    durations: m.durations.map((o) => o.value),
    ...(kind === "video"
      ? { audio: audioModeOf(m.id), inputs: supportedDirectingModes(m.id) }
      : {}),
  }
}

/**
 * Every Structured Subject dimension, flattened to the format's own list
 * (D1). Two shapes, one row each: a `SUBJECT_MULTIDIM` (Person, Styling)
 * dimension resolves its label/term through the pill's OWN `getLabel` (a
 * multi-dim pill exposes no separate short term — the fold happens at the
 * whole-selection level, never per-id); a single-pick prop (`PROP_PICKERS` +
 * {@link ANIMAL_PICKER}, deduplicated — Animal ships in both) resolves its
 * term through the prop's own `getTerm`, exactly as the pickers do elsewhere
 * in this file.
 */
function subjectDimensions(): RegistrySubjectDimension[] {
  const fromDims = SUBJECT_MULTIDIM.flatMap((spec) =>
    spec.sections.flatMap((section) =>
      section.dimensions.map((dim) => ({
        field: dim.field,
        label: dim.label,
        section: `${spec.label} · ${section.label}`,
        multi: dim.multi === true,
        maxPicks: dim.multi === true ? (dim.maxPicks ?? 2) : 1,
        options: dim.pill.catalog.map((e) => ({
          id: e.id,
          label: dim.pill.getLabel(e.id),
          term: dim.pill.getLabel(e.id),
        })),
      })),
    ),
  )
  const seen = new Set<string>()
  const props = [...PROP_PICKERS, ANIMAL_PICKER].flatMap((p: PropPicker) => {
    if (seen.has(p.pill.key)) return []
    seen.add(p.pill.key)
    return [
      {
        field: p.pill.key,
        label: p.pill.label,
        section: "Props",
        multi: false,
        maxPicks: 1,
        options: p.pill.catalog.map((e) => ({
          id: e.id,
          label: p.pill.getLabel(e.id),
          term: p.getTerm(e.id),
        })),
      },
    ]
  })
  return [...fromDims, ...props]
}

/** A `music-options` catalog → its registry rows (no separate short TERM —
 *  the label IS what folds into the Suno prompt, `composeMusicStyle`). */
function musicOptions(opts: ReadonlyArray<MusicOption>): RegistryOption[] {
  return opts.map((o) => ({ id: o.id, label: o.label, term: o.label }))
}

function build(): FormatRegistry {
  const pickers: ReadonlyArray<RegistryPicker> = [
    ...LOOK_PICKERS.map(toPicker),
    toPicker(cameraMovementPicker()),
    toPicker(characterFxPicker()),
  ]
  const optionsOf = (key: string) =>
    pickers.find((p) => p.key === key)?.options ?? []
  return {
    pickers,
    filmKeys: FILM_LOOK_KEYS,
    transition: {
      ids: optionsOf(TRANSITION_DIMENSION),
      dimensions: toDimensions(transitionDimensions()),
    },
    characterFx: {
      ids: optionsOf(CHARACTER_FX_KEY),
      dimensions: toDimensions(characterFxDimensions()),
    },
    imageModels: imageModelOptions().map((m) => toModel(m, "image")),
    videoModels: videoModelOptions().map((m) => toModel(m, "video")),
    audio: { modes: AUDIO_MODES },
    subject: subjectDimensions(),
    music: {
      genres: musicOptions(MUSIC_GENRES),
      moods: musicOptions(MUSIC_MOODS),
      instruments: musicOptions(MUSIC_INSTRUMENTS),
      singingStyles: musicOptions(MUSIC_SINGING_STYLES),
      languages: musicOptions(MUSIC_LANGUAGES),
      vocals: MUSIC_VOCALS,
      vocalGenders: MUSIC_VOCAL_GENDERS,
      maxDuration: MUSIC_MAX_DURATION_SECONDS,
    },
    shots: {
      step: BEAT_SECONDS_STEP,
      minSeconds: BEAT_MIN_SECONDS,
      fallbackCapSeconds: BEATS_AUTHOR_CAP_SECONDS,
    },
    candidates: { max: MAX_CANDIDATES },
    defaults: {
      imageModel: DEFAULT_FRAMING_PROVIDER,
      videoModel: DEFAULT_VIDEO_PROVIDER,
      aspectRatio: DEFAULT_FRAMING_ASPECT,
      resolution: DEFAULT_FRAMING_RESOLUTION,
    },
  }
}

/** Built once — the catalogs are static module data and four renderers read it. */
let cached: FormatRegistry | undefined

export function buildFormatRegistry(): FormatRegistry {
  if (!cached) cached = build()
  return cached
}

/**
 * The pickers a LOOK map may name (`film`, `scenes[].look`) — the pick keys
 * MINUS Camera Movement, which is the scene's own `motion.cameraMotionId`
 * field, never a look. One derivation for the schema and the legend, so they
 * cannot disagree about where a key belongs.
 */
export function lookPickerKeys(
  registry: FormatRegistry,
): ReadonlyArray<RegistryPicker> {
  return registry.pickers.filter(
    (p) => p.usableAsPick && p.key !== CAMERA_MOVEMENT_KEY,
  )
}

/** The pickers a shot's `picks` may name — exactly what the fold resolves. */
export function shotPickKeys(
  registry: FormatRegistry,
): ReadonlyArray<RegistryPicker> {
  return registry.pickers.filter((p) => p.usableAsPick)
}
