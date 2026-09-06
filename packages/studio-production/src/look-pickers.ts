import {
  CAMERA_MOTIONS,
  EXPOSURE_FIELD_BY_CATEGORY,
  LIGHTING_FIELD_BY_CATEGORY,
  TEMPORAL_FIELD_BY_CATEGORY,
  getCameraMotionTerm,
  type DirectionKey,
  type PickerHintMode,
} from "@nodaro/prompts"
import {
  CHARACTER_FX,
  CHARACTER_FX_CATEGORY_LABELS,
  CHARACTER_FX_CATEGORY_ORDER,
  getCharacterFxLabel,
  getCharacterFxPromptHint,
  getCharacterFxTerm,
} from "@nodaro/prompts"
import {
  // ── Catalogs (the option universe — single source of truth) ──
  FRAMINGS,
  LIGHTINGS,
  LENSES,
  CAMERA_FORMATS,
  COLOR_LOOKS,
  ATMOSPHERES,
  STYLES,
  MOODS,
  AESTHETICS,
  SETTINGS,
  ERAS,
  BACKDROPS,
  POSES,
  COMPOSITION_EFFECTS,
  PHOTO_GENRES,
  PHOTOGRAPHERS,
  EXPOSURE_SETTINGS,
  RENDER_QUALITIES,
  POST_PROCESS_EFFECTS,
  ACTION_FX,
  TEMPORALS,
  TRANSITIONS,
  LOOP_SUBJECTS,
  // ── Label resolvers (id → display label) ──
  getFramingLabel,
  getLightingLabel,
  getLensLabel,
  getCameraFormatLabel,
  getColorLookLabel,
  getAtmosphereLabel,
  getStyleLabel,
  getMoodLabel,
  getAestheticLabel,
  getSettingLabel,
  getEraLabel,
  getBackdropLabel,
  getPoseLabel,
  getCompositionEffectLabel,
  getPhotoGenreLabel,
  getPhotographerLabel,
  getExposureLabel,
  getRenderQualityLabel,
  getPostProcessEffectLabel,
  getActionFxLabel,
  getTemporalLabel,
  getTransitionLabel,
  getLoopSubjectLabel,
  // ── Prompt-hint resolvers (id → the RICH descriptive clause) ──
  getFramingPromptHint,
  getLightingPromptHint,
  getLensPromptHint,
  getCameraFormatPromptHint,
  getColorLookPromptHint,
  getAtmospherePromptHint,
  getStylePromptHint,
  getMoodPromptHint,
  getAestheticPromptHint,
  getSettingPromptHint,
  getEraPromptHint,
  getBackdropPromptHint,
  getPosePromptHint,
  getCompositionEffectPromptHint,
  getPhotoGenrePromptHint,
  getPhotographerPromptHint,
  getExposurePromptHint,
  getRenderQualityPromptHint,
  getPostProcessEffectPromptHint,
  getActionFxPromptHint,
  getTemporalPromptHint,
  getTransitionPromptHint,
  getLoopSubjectPromptHint,
  // ── Compact TERM resolvers (id → the SHORT professional term) ──
  getFramingTerm,
  getLightingTerm,
  getLensTerm,
  getCameraFormatTerm,
  getColorLookTerm,
  getAtmosphereTerm,
  getStyleTerm,
  getMoodTerm,
  getAestheticTerm,
  getSettingTerm,
  getEraTerm,
  getBackdropTerm,
  getPoseTerm,
  getCompositionEffectTerm,
  getPhotoGenreTerm,
  getPhotographerTerm,
  getExposureTerm,
  getRenderQualityTerm,
  getPostProcessEffectTerm,
  getActionFxTerm,
  getTemporalTerm,
  getTransitionTerm,
  getLoopSubjectTerm,
  // ── Category grouping (ordered, labelled headings) ──
  FRAMING_CATEGORY_LABELS,
  LIGHTING_CATEGORY_ORDER,
  LIGHTING_CATEGORY_LABELS,
  COLOR_LOOK_CATEGORY_ORDER,
  COLOR_LOOK_CATEGORY_LABELS,
  MOOD_CATEGORY_ORDER,
  MOOD_CATEGORY_LABELS,
  AESTHETIC_CATEGORY_ORDER,
  AESTHETIC_CATEGORY_LABELS,
  SETTING_CATEGORY_LABELS,
  ERA_CATEGORY_ORDER,
  ERA_CATEGORY_LABELS,
  BACKDROP_CATEGORY_ORDER,
  BACKDROP_CATEGORY_LABELS,
  POSE_CATEGORY_ORDER,
  POSE_CATEGORY_LABELS,
  PHOTO_GENRE_CATEGORY_ORDER,
  PHOTO_GENRE_CATEGORY_LABELS,
  PHOTOGRAPHER_CATEGORY_ORDER,
  PHOTOGRAPHER_CATEGORY_LABELS,
  EXPOSURE_CATEGORY_ORDER,
  EXPOSURE_CATEGORY_LABELS,
  ACTION_FX_CATEGORY_ORDER,
  ACTION_FX_CATEGORY_LABELS,
  TEMPORAL_CATEGORY_ORDER,
  TEMPORAL_CATEGORY_LABELS,
  TRANSITION_CATEGORY_ORDER,
  TRANSITION_CATEGORY_LABELS,
  LOOP_SUBJECT_CATEGORY_ORDER,
  LOOP_SUBJECT_CATEGORY_LABELS,
} from "@nodaro/prompts"

/**
 * The "Look" picker REGISTRY — the single, data-driven source of truth for every
 * cinematic dimension Nodaro exposes, surfaced BELOW the prompt (image + video).
 *
 * WHY A REGISTRY (not 24 hand-wired pills): every Nodaro catalog has the SAME
 * shape — a `<NAME>S` option array, a `get<Name>Label(id)` and (the load-bearing
 * one) a `get<Name>PromptHint(id)` that returns the RICH descriptive clause baked
 * into the catalog (e.g. "set in a cozy coffee shop interior with warm pendant
 * lights, exposed brick walls and steam drifting over espresso machines"), plus
 * `<NAME>_CATEGORY_{ORDER,LABELS}` for grouping. So we describe each picker as ONE
 * row of data and drive BOTH the UI and the prompt-fold off it. Adding a catalog
 * to `@nodaro/shared` → one entry here, nothing else. A guard test
 * (`look-pickers.test.ts`) asserts every entry resolves a non-empty hint for its
 * first option, so a wrong helper wiring fails loudly instead of silently
 * injecting "".
 *
 * THE FOLD (see `direction`, which derives all fold logic from this list):
 * EVERY row carries a `platformField` — the `DirectionKey` this studio dimension
 * projects onto in the platform's `DIRECTION_FIELDS` registry. `direction.ts`
 * turns a selection into that flat wire object; `/v1/generate-image` and
 * `/v1/generate-video` render the clauses server-side (`renderDirectionHints`),
 * so hint TEXT never rides the wire and a catalog improvement reaches a saved
 * production without a re-save. Studio folds NO look clause client-side.
 *
 * `platformField` is the mapping's only home — a row without one is a dimension
 * the registry does not carry, which is why `characterFxPicker()` (the single
 * documented exception) declares none and `look-pickers.test.ts` fails the build
 * for any other omission.
 */

/** A catalog option row (structural — every `@nodaro/shared` catalog entry fits). */
export interface LookCatalogEntry {
  readonly id: string
  readonly label: string
  readonly description?: string
  readonly category?: string
}

/** A categorized catalog rendered as ordered, labelled heading groups. */
export interface LookCategoryConfig {
  /** Canonical category render order (the catalog's `*_CATEGORY_ORDER`). */
  readonly order: ReadonlyArray<string>
  /** Category → heading label (the catalog's `*_CATEGORY_LABELS`). */
  readonly labels: Record<string, string>
  /** Pull the category key off an entry (entries carry `category` when grouped). */
  readonly categoryOf: (entry: LookCatalogEntry) => string
}

/** UI section a picker belongs to (so 24 pickers stay scannable, not a flat wall). */
export type LookGroup =
  | "composition"
  | "camera"
  | "light"
  | "style"
  | "scene"
  | "motion"

/** Which stage(s) a picker is relevant to — drives the per-stage surface filter. */
export type LookSurface = "image" | "video" | "both"

/**
 * The minimal config a single-pick PILL needs to render — shared by the Look
 * pickers AND the multi-dimensional Subject pickers' per-dimension pills (so both
 * reuse the one `ControlPill` grid primitive).
 */
export interface PillConfig {
  /** Selection key (the field this pill writes in its owner's selection map). */
  readonly key: string
  /** Pill label shown when nothing is selected (the studio's wording). */
  readonly label: string
  /** The option universe (already readonly from `@nodaro/shared`). */
  readonly catalog: ReadonlyArray<LookCatalogEntry>
  /** Resolve a selected id → its display label (the catalog's own helper). */
  readonly getLabel: (id?: string | null) => string
  /** Search placeholder for the picker's Command input. */
  readonly searchPlaceholder: string
  /** Present for categorized catalogs (renders ordered heading groups). */
  readonly categories?: LookCategoryConfig
}

/** One Look picker / cinematic dimension — a {@link PillConfig} plus the fold
 *  metadata (`direction` reads `platformField`/`surface`/`getHint`). */
export interface LookPickerConfig extends PillConfig {
  /** UI section grouping. */
  readonly group: LookGroup
  /** Stage relevance — Framing shows image+both, Directing shows video+both. */
  readonly surface: LookSurface
  /**
   * The platform `DIRECTION_FIELDS` key this dimension projects onto — the WIRE
   * vocabulary (`@nodaro/prompts`' `DirectionFields`), which is also the canvas
   * node-data field name for the same catalog. `directionWireFields` reads it;
   * absent ⇒ the registry deliberately does not carry this dimension (only
   * {@link characterFxPicker}).
   */
  readonly platformField?: DirectionKey
  /** Resolve a selected id → its RICH prompt clause (the catalog's own helper).
   *  The `"full"` half of {@link pickerFragment}. */
  readonly getHint: (id?: string | null) => string
  /** Resolve a selected id → its SHORT professional term (the catalog's own
   *  `get*Term` sibling — "whip pan left", "hard cut"). The `"compact"` half of
   *  {@link pickerFragment}; never a truncation of the hint, always the wording
   *  a professional writes. */
  readonly getTerm: (id?: string | null) => string
  /** Allow more than one pick — the dimensions Nodaro lets you blend (two moods,
   *  two atmospheres, key+rim lighting, layered composition…). */
  readonly multi?: boolean
  /** Cap for a multi dimension (Nodaro caps these at 2). */
  readonly maxPicks?: number
}

/** A user's Look selections — a flat `pickerKey → selected id(s)` map. A few
 *  dimensions are MULTI-pick (two layered moods/atmospheres, key+rim lighting…),
 *  so a key may hold an array; the fold in `direction` flat-maps it. */
export type LookSelection = Record<string, string | ReadonlyArray<string>>

/** Render-order + labels for the UI section headers. */
export const LOOK_GROUP_ORDER: ReadonlyArray<LookGroup> = [
  "composition",
  "camera",
  "light",
  "style",
  "scene",
  "motion",
]

export const LOOK_GROUP_LABELS: Record<LookGroup, string> = {
  composition: "Composition & Framing",
  camera: "Camera & Lens",
  light: "Light & Color",
  style: "Style & Mood",
  scene: "Scene & Era",
  motion: "Motion & Time",
}

/** Shorthand spec → full {@link LookPickerConfig} (fills derivable fields). The
 *  catalog helpers are typed STRICT (`(id: string) => string`) so BOTH strict and
 *  undefined-tolerant `@nodaro/shared` helpers assign here; the builder wraps them
 *  into the undefined-tolerant shape the UI calls (with a defined id only). */
interface PickerSpec {
  readonly key: string
  readonly label: string
  readonly group: LookGroup
  readonly surface: LookSurface
  /** The platform `DirectionKey` this row projects onto (see {@link LookPickerConfig}). */
  readonly platformField?: DirectionKey
  readonly catalog: ReadonlyArray<LookCatalogEntry>
  readonly getLabel: (id: string) => string
  readonly getHint: (id: string) => string
  readonly getTerm: (id: string) => string
  /** Multi-pick (Nodaro caps at 2). */
  readonly multi?: boolean
  readonly maxPicks?: number
  /** Catalog's `*_CATEGORY_ORDER`; omit when only `*_CATEGORY_LABELS` exists (we
   *  then derive the order from the label keys) or when the catalog is flat. */
  readonly categoryOrder?: ReadonlyArray<string>
  /** Catalog's `*_CATEGORY_LABELS`; presence ⇒ the picker renders grouped. */
  readonly categoryLabels?: Record<string, string>
}

function picker(spec: PickerSpec): LookPickerConfig {
  return {
    key: spec.key,
    label: spec.label,
    group: spec.group,
    surface: spec.surface,
    // Omit-when-absent: a `platformField: undefined` key would make the
    // projection's `if (!p.platformField)` guard read as data rather than shape.
    ...(spec.platformField ? { platformField: spec.platformField } : {}),
    // Retirement is applied HERE so it reaches every picker from one
    // declaration, rather than each call site remembering to filter.
    catalog: spec.catalog.filter((e) => !menuHiddenIds(spec.key).has(e.id)),
    // Wrap to the undefined-tolerant shape the UI/fold call with (guarding the id
    // so a cleared pill resolves to "" instead of calling a strict helper).
    getLabel: (id) => (id ? spec.getLabel(id) : ""),
    getHint: (id) => (id ? spec.getHint(id) : ""),
    getTerm: (id) => (id ? spec.getTerm(id) : ""),
    ...(spec.multi ? { multi: true, maxPicks: spec.maxPicks ?? 2 } : {}),
    searchPlaceholder: `Search ${spec.label.toLowerCase()}…`,
    categories: spec.categoryLabels
      ? {
          order: spec.categoryOrder ?? Object.keys(spec.categoryLabels),
          labels: spec.categoryLabels,
          categoryOf: (e) => e.category ?? "",
        }
      : undefined,
  }
}

// FRAMINGS is multi-dimensional — one flat catalog where each entry's `category`
// IS its dimension (shot-size / angle / coverage / composition / vantage). We
// surface each dimension as its OWN pill so all five can be set at once (the
// platform's multi-dim recipe), and each maps to its own canonical registry key
// (`shotSize` / `angle` / `coverage` / `composition` / `vantage`). Each dimension
// is a flat single-pick (one category), so no sub-grouping.
const framingDim = (category: string) =>
  FRAMINGS.filter((f) => f.category === category)

/**
 * Split a CATEGORY-based multi-dimensional catalog (Lighting / Temporal /
 * Exposure) into ONE single-pick pill per dimension — the platform's multi-dim
 * recipe, mirroring Framing. `keyPrefix` namespaces the selection key so
 * cross-catalog dimensions that share a name (Lighting + Temporal both have
 * "direction") don't collide.
 *
 * `fieldByCategory` is REQUIRED and comes from the platform's own
 * `*_FIELD_BY_CATEGORY` map — the registry already partitions these catalogs per
 * dimension, so a hand-written list here would be a second source of truth that
 * silently rots when the platform adds a category.
 */
function categoryPickers(opts: {
  readonly catalog: ReadonlyArray<LookCatalogEntry>
  readonly order: ReadonlyArray<string>
  readonly labels: Record<string, string>
  readonly keyPrefix: string
  /** Category → the platform `DirectionKey` for that dimension (never hand-written). */
  readonly fieldByCategory: Readonly<Record<string, DirectionKey>>
  readonly getLabel: (id?: string | null) => string
  readonly getHint: (id?: string | null) => string
  readonly getTerm: (id?: string | null) => string
  readonly group: LookGroup
  readonly surface: LookSurface
  /** Categories that are multi-pick → `category → cap` (e.g. Lighting `style`: 2). */
  readonly multiCategories?: Record<string, number>
}): LookPickerConfig[] {
  return opts.order.map((category) =>
    picker({
      key: `${opts.keyPrefix}-${category}`,
      label: opts.labels[category],
      group: opts.group,
      surface: opts.surface,
      platformField: opts.fieldByCategory[category],
      catalog: opts.catalog.filter((e) => e.category === category),
      getLabel: opts.getLabel,
      getHint: opts.getHint,
      getTerm: opts.getTerm,
      ...(opts.multiCategories?.[category] !== undefined
        ? { multi: true, maxPicks: opts.multiCategories[category] }
        : {}),
    }),
  )
}

/**
 * Options this app RETIRES from its menus, mapped to what replaces them.
 *
 * Curation is the app's (the same right as the model-menu allowlist); the
 * catalog stays the platform's. A row belongs here only when two options are
 * genuinely the SAME thing, so the replacement is lossless — never to express a
 * preference, which is what the picker itself is for.
 *
 * `head-to-knees` and `medium-wide-shot` are one crop under two names:
 *
 *   medium-wide-shot : "subject framed from the knees up"
 *   head-to-knees    : "from the top of the head down to just above the knees"
 *
 * The previews made it visible — two tiles, one picture. Medium Wide survives
 * as the standard term. The platform agreed and dropped `head-to-knees` from
 * the catalog (@nodaro/prompts 1.8.1) — the entry stays HERE so a production
 * saved with the retired id still frames the same shot.
 */
export const RETIRED_LOOK_IDS: Readonly<Record<string, string>> = {
  "head-to-knees": "medium-wide-shot",
}

/** The id a stored selection resolves to — retired ids follow their
 *  replacement, everything else passes through untouched. */
export function liveLookId(id: string): string {
  return RETIRED_LOOK_IDS[id] ?? id
}

/**
 * Options hidden from ONE picker's menu — rows the catalog carries that this
 * app's menu has no use for. Scoped by picker key, and deliberately not a
 * retirement: retirement above maps an id to a replacement on the SAME key so
 * a stored pick migrates losslessly; this hides a menu entry and nothing else,
 * and a stored pick keeps folding exactly as the catalog says.
 *
 * `none` on Composition FX is the catalog's own no-op default row (added in
 * @nodaro/prompts 1.9.0 so an unconfigured canvas node stops injecting a
 * paper-tear). Studio's tile picker already clears a dimension with its
 * Default action, so a None tile would be the same action twice.
 *
 * (The cross-key duplicate this map was first written for — `3x3-grid-collage`
 * in both Composition FX and Layout, hidden here from the effects menu — was
 * resolved upstream in 1.9.0: the effects copy is gone from the catalog, the
 * Layout one stays.)
 */
const HIDDEN_BY_PICKER: Readonly<Record<string, ReadonlySet<string>>> = {
  compositionEffectId: new Set(["none"]),
  // `early-color-photo` (@nodaro/prompts 1.14.0, 2026-09-02): hidden ONLY until a
  // style-previews render exists — a REGISTERED preview set with one gradient tile
  // among 48 renders is exactly the blank-tile failure the coverage guard forbids
  // (`look-previews.test.ts`). Not a judgement on the style. Un-hide by deleting
  // this entry once the render, its `look-previews/style.ts` row and the
  // `data/look-previews/style-previews.v1.json` option all land.
  styleId: new Set(["early-color-photo"]),
}

/** Ids this app keeps out of a picker's menu — retired ones plus that picker's
 *  own hidden duplicates. The guards read this so a hidden option is expected
 *  to be missing from the menu rather than reported as drift. */
export function menuHiddenIds(pickerKey: string): ReadonlySet<string> {
  return new Set([
    ...Object.keys(RETIRED_LOOK_IDS),
    ...(HIDDEN_BY_PICKER[pickerKey] ?? []),
  ])
}

/**
 * The COMPLETE Look picker set — every cinematic catalog `@nodaro/shared` ships,
 * grouped for the UI and tagged by stage surface. EVERY row carries the
 * `platformField` it projects onto; the platform renders every clause.
 *
 * The four rows that used to ride the pre-registry `DirectionFields` block
 * (`framingId` / `framingAngleId` / `cameraFormatId` / `lensId`) map to their
 * CANONICAL registry keys (`shotSize` / `angle` / `cameraFormat` / `lens`), not
 * the legacy block: canonical is the vocabulary the canvas config panels read,
 * and `renderDirectionHints`' exact-clause dedupe makes the prompt text
 * identical either way (only the clause's position in the fold changes).
 */
export const LOOK_PICKERS: ReadonlyArray<LookPickerConfig> = [
  // ── Composition & Framing ──
  // The 5 Framing dimensions (catalog labels drive the pill names) — one
  // canonical registry key each.
  picker({
    key: "framingId",
    label: FRAMING_CATEGORY_LABELS["shot-size"],
    group: "composition",
    surface: "both",
    platformField: "shotSize",
    catalog: framingDim("shot-size"),
    getLabel: getFramingLabel,
    getHint: getFramingPromptHint,
    getTerm: getFramingTerm,
  }),
  picker({
    key: "framingAngleId",
    label: FRAMING_CATEGORY_LABELS["angle"],
    group: "composition",
    surface: "both",
    platformField: "angle",
    catalog: framingDim("angle"),
    getLabel: getFramingLabel,
    getHint: getFramingPromptHint,
    getTerm: getFramingTerm,
  }),
  picker({
    key: "framingCoverageId",
    label: FRAMING_CATEGORY_LABELS["coverage"],
    group: "composition",
    surface: "both",
    platformField: "coverage",
    catalog: framingDim("coverage"),
    getLabel: getFramingLabel,
    getHint: getFramingPromptHint,
    getTerm: getFramingTerm,
  }),
  picker({
    key: "framingCompositionId",
    label: FRAMING_CATEGORY_LABELS["composition"],
    group: "composition",
    surface: "both",
    platformField: "composition",
    // Composition is multi-pick (layered — e.g. rule-of-thirds + leading-lines).
    multi: true,
    maxPicks: 2,
    catalog: framingDim("composition"),
    getLabel: getFramingLabel,
    getHint: getFramingPromptHint,
    getTerm: getFramingTerm,
  }),
  picker({
    key: "framingVantageId",
    label: FRAMING_CATEGORY_LABELS["vantage"],
    group: "composition",
    surface: "both",
    platformField: "vantage",
    catalog: framingDim("vantage"),
    getLabel: getFramingLabel,
    getHint: getFramingPromptHint,
    getTerm: getFramingTerm,
  }),
  picker({
    key: "poseId",
    label: "Pose",
    group: "composition",
    surface: "both",
    platformField: "pose",
    catalog: POSES,
    getLabel: getPoseLabel,
    getHint: getPosePromptHint,
    getTerm: getPoseTerm,
    categoryOrder: POSE_CATEGORY_ORDER,
    categoryLabels: POSE_CATEGORY_LABELS,
  }),
  picker({
    key: "compositionEffectId",
    label: "Composition FX",
    group: "composition",
    surface: "both",
    platformField: "compositionEffect",
    catalog: COMPOSITION_EFFECTS,
    getLabel: getCompositionEffectLabel,
    getHint: getCompositionEffectPromptHint,
    getTerm: getCompositionEffectTerm,
  }),

  // ── Camera & Lens ──
  picker({
    key: "cameraFormatId",
    label: "Camera / Film",
    group: "camera",
    surface: "both",
    platformField: "cameraFormat",
    catalog: CAMERA_FORMATS,
    getLabel: getCameraFormatLabel,
    getHint: getCameraFormatPromptHint,
    getTerm: getCameraFormatTerm,
  }),
  picker({
    key: "lensId",
    label: "Lens",
    group: "camera",
    surface: "both",
    platformField: "lens",
    catalog: LENSES,
    getLabel: getLensLabel,
    getHint: getLensPromptHint,
    getTerm: getLensTerm,
  }),
  // Exposure is multi-dimensional (Aperture / Shutter Speed / ISO) — one pill each.
  ...categoryPickers({
    catalog: EXPOSURE_SETTINGS,
    order: EXPOSURE_CATEGORY_ORDER,
    labels: EXPOSURE_CATEGORY_LABELS,
    keyPrefix: "exposure",
    fieldByCategory: EXPOSURE_FIELD_BY_CATEGORY,
    getLabel: getExposureLabel,
    getHint: getExposurePromptHint,
    getTerm: getExposureTerm,
    group: "camera",
    surface: "image",
  }),

  // ── Light & Color ──
  // Lighting is multi-dimensional (Time of Day / Style / Direction / Ratio / Color
  // Temperature) — one pill each (all client-folded; see categoryPickers).
  ...categoryPickers({
    catalog: LIGHTINGS,
    order: LIGHTING_CATEGORY_ORDER,
    labels: LIGHTING_CATEGORY_LABELS,
    keyPrefix: "lighting",
    fieldByCategory: LIGHTING_FIELD_BY_CATEGORY,
    getLabel: getLightingLabel,
    getHint: getLightingPromptHint,
    getTerm: getLightingTerm,
    group: "light",
    surface: "both",
    // Lighting Style is multi-pick (layered setups — key + rim, soft + hard).
    multiCategories: { style: 2 },
  }),
  picker({
    key: "colorLookId",
    label: "Color / Look",
    group: "light",
    surface: "both",
    platformField: "colorLook",
    catalog: COLOR_LOOKS,
    getLabel: getColorLookLabel,
    getHint: getColorLookPromptHint,
    getTerm: getColorLookTerm,
    categoryOrder: COLOR_LOOK_CATEGORY_ORDER,
    categoryLabels: COLOR_LOOK_CATEGORY_LABELS,
  }),
  picker({
    key: "atmosphereId",
    label: "Atmosphere",
    group: "light",
    surface: "both",
    platformField: "atmosphere",
    catalog: ATMOSPHERES,
    getLabel: getAtmosphereLabel,
    getHint: getAtmospherePromptHint,
    getTerm: getAtmosphereTerm,
    multi: true,
    maxPicks: 2,
  }),
  picker({
    key: "postProcessId",
    label: "Post-Process",
    group: "light",
    surface: "image",
    platformField: "postProcess",
    catalog: POST_PROCESS_EFFECTS,
    getLabel: getPostProcessEffectLabel,
    getHint: getPostProcessEffectPromptHint,
    getTerm: getPostProcessEffectTerm,
    multi: true,
    maxPicks: 2,
  }),

  // ── Style & Mood ──
  picker({
    key: "styleId",
    label: "Style",
    group: "style",
    surface: "both",
    platformField: "style",
    catalog: STYLES,
    getLabel: getStyleLabel,
    getHint: getStylePromptHint,
    getTerm: getStyleTerm,
  }),
  picker({
    key: "moodId",
    label: "Mood",
    group: "style",
    surface: "both",
    platformField: "mood",
    catalog: MOODS,
    getLabel: getMoodLabel,
    getHint: getMoodPromptHint,
    getTerm: getMoodTerm,
    multi: true,
    maxPicks: 2,
    categoryOrder: MOOD_CATEGORY_ORDER,
    categoryLabels: MOOD_CATEGORY_LABELS,
  }),
  picker({
    key: "aestheticId",
    label: "Aesthetic",
    group: "style",
    surface: "both",
    platformField: "aesthetic",
    catalog: AESTHETICS,
    getLabel: getAestheticLabel,
    getHint: getAestheticPromptHint,
    getTerm: getAestheticTerm,
    multi: true,
    maxPicks: 2,
    categoryOrder: AESTHETIC_CATEGORY_ORDER,
    categoryLabels: AESTHETIC_CATEGORY_LABELS,
  }),
  picker({
    key: "photoGenreId",
    label: "Photo Genre",
    group: "style",
    surface: "image",
    platformField: "photoGenre",
    catalog: PHOTO_GENRES,
    getLabel: getPhotoGenreLabel,
    getHint: getPhotoGenrePromptHint,
    getTerm: getPhotoGenreTerm,
    categoryOrder: PHOTO_GENRE_CATEGORY_ORDER,
    categoryLabels: PHOTO_GENRE_CATEGORY_LABELS,
  }),
  picker({
    key: "photographerId",
    label: "Photographer",
    group: "style",
    surface: "image",
    platformField: "photographer",
    catalog: PHOTOGRAPHERS,
    getLabel: getPhotographerLabel,
    getHint: getPhotographerPromptHint,
    getTerm: getPhotographerTerm,
    multi: true,
    maxPicks: 2,
    categoryOrder: PHOTOGRAPHER_CATEGORY_ORDER,
    categoryLabels: PHOTOGRAPHER_CATEGORY_LABELS,
  }),
  picker({
    key: "renderQualityId",
    label: "Render Quality",
    group: "style",
    surface: "image",
    platformField: "renderQuality",
    catalog: RENDER_QUALITIES,
    getLabel: getRenderQualityLabel,
    getHint: getRenderQualityPromptHint,
    getTerm: getRenderQualityTerm,
  }),

  // ── Scene & Era ──
  picker({
    key: "settingId",
    label: "Setting",
    group: "scene",
    surface: "both",
    platformField: "setting",
    catalog: SETTINGS,
    getLabel: getSettingLabel,
    getHint: getSettingPromptHint,
    getTerm: getSettingTerm,
    // SETTINGS exports only `*_CATEGORY_LABELS` (no ORDER) — derive the order.
    categoryLabels: SETTING_CATEGORY_LABELS,
  }),
  picker({
    key: "eraId",
    label: "Era",
    group: "scene",
    surface: "both",
    platformField: "era",
    catalog: ERAS,
    getLabel: getEraLabel,
    getHint: getEraPromptHint,
    getTerm: getEraTerm,
    categoryOrder: ERA_CATEGORY_ORDER,
    categoryLabels: ERA_CATEGORY_LABELS,
  }),
  picker({
    key: "backdropId",
    label: "Backdrop",
    group: "scene",
    surface: "both",
    platformField: "backdrop",
    catalog: BACKDROPS,
    getLabel: getBackdropLabel,
    getHint: getBackdropPromptHint,
    getTerm: getBackdropTerm,
    categoryOrder: BACKDROP_CATEGORY_ORDER,
    categoryLabels: BACKDROP_CATEGORY_LABELS,
  }),

  // ── Motion & Time (video only — generate-video folds them client-side) ──
  picker({
    key: "actionFxId",
    label: "Action FX",
    group: "motion",
    surface: "video",
    platformField: "actionFx",
    catalog: ACTION_FX,
    getLabel: getActionFxLabel,
    getHint: getActionFxPromptHint,
    getTerm: getActionFxTerm,
    multi: true,
    maxPicks: 2,
    categoryOrder: ACTION_FX_CATEGORY_ORDER,
    categoryLabels: ACTION_FX_CATEGORY_LABELS,
  }),
  // Temporal is multi-dimensional (Speed / Freeze / Direction / Shutter) — one
  // pill each (video-only; all client-folded).
  ...categoryPickers({
    catalog: TEMPORALS,
    order: TEMPORAL_CATEGORY_ORDER,
    labels: TEMPORAL_CATEGORY_LABELS,
    keyPrefix: "temporal",
    fieldByCategory: TEMPORAL_FIELD_BY_CATEGORY,
    getLabel: getTemporalLabel,
    getHint: getTemporalPromptHint,
    getTerm: getTemporalTerm,
    group: "motion",
    surface: "video",
  }),
  picker({
    key: "transitionId",
    label: "Transition",
    group: "motion",
    surface: "video",
    platformField: "transition",
    catalog: TRANSITIONS,
    getLabel: getTransitionLabel,
    getHint: getTransitionPromptHint,
    getTerm: getTransitionTerm,
    multi: true,
    maxPicks: 2,
    categoryOrder: TRANSITION_CATEGORY_ORDER,
    categoryLabels: TRANSITION_CATEGORY_LABELS,
  }),
  picker({
    key: "loopSubjectId",
    label: "Loop Subject",
    group: "motion",
    surface: "video",
    platformField: "loopSubject",
    catalog: LOOP_SUBJECTS,
    getLabel: getLoopSubjectLabel,
    getHint: getLoopSubjectPromptHint,
    getTerm: getLoopSubjectTerm,
    categoryOrder: LOOP_SUBJECT_CATEGORY_ORDER,
    categoryLabels: LOOP_SUBJECT_CATEGORY_LABELS,
  }),
]

/** A picker is relevant to a stage when its surface is "both" or that stage's. */
export function pickersForSurface(
  surface: "image" | "video",
): ReadonlyArray<LookPickerConfig> {
  return LOOK_PICKERS.filter((p) => p.surface === "both" || p.surface === surface)
}

/** Group a stage's pickers into ordered `{ group, label, pickers }` UI sections. */
export function groupedPickersForSurface(
  surface: "image" | "video",
): ReadonlyArray<{
  group: LookGroup
  label: string
  pickers: ReadonlyArray<LookPickerConfig>
}> {
  const relevant = pickersForSurface(surface)
  return LOOK_GROUP_ORDER.map((group) => ({
    group,
    label: LOOK_GROUP_LABELS[group],
    pickers: relevant.filter((p) => p.group === group),
  })).filter((s) => s.pickers.length > 0)
}

/** Resolve one picker config by its selection key (the v2 FILM strip / SCENE
 *  LOOK cards mount specific dimensions by key). Undefined = no such picker —
 *  callers must drop the control rather than render a dead one. */
export function pickerByKey(key: string): LookPickerConfig | undefined {
  return LOOK_PICKERS.find((p) => p.key === key)
}

/**
 * Camera MOVEMENT as a picker config — derived from `CAMERA_MOTIONS`, NOT part
 * of {@link LOOK_PICKERS} (classic keeps its own MotionPicker untouched). The
 * editor-v2 shot cards show Movement as an always-visible pill per the handoff
 * README ("Always visible: Size, Angle, Position, Camera Movement"), and the
 * beats fold resolves its hint through {@link CAMERA_MOTIONS}' own promptHint.
 */
export const CAMERA_MOVEMENT_KEY = "cameraMotionId"

export function cameraMovementPicker(): LookPickerConfig {
  return {
    key: CAMERA_MOVEMENT_KEY,
    label: "Camera Movement",
    group: "motion",
    surface: "video",
    // `cameraMotion` is `DIRECTION_FIELDS[0]` — the platform emits it FIRST,
    // exactly where studio folded its phrase by hand before the registry.
    platformField: "cameraMotion",
    catalog: CAMERA_MOTIONS.map((m) => ({ id: m.id, label: m.label })),
    getLabel: (id) => CAMERA_MOTIONS.find((m) => m.id === id)?.label ?? "",
    getHint: (id) => CAMERA_MOTIONS.find((m) => m.id === id)?.promptHint ?? "",
    getTerm: (id) => getCameraMotionTerm(id),
    searchPlaceholder: "Search camera movement",
  }
}

/**
 * Character FX as a picker config — derived from the platform's `character-fx`
 * catalog, NOT part of {@link LOOK_PICKERS} (classic keeps its Look wall
 * untouched). The shots editor mounts it per shot behind the FX pill; the
 * node's three timing levers are catalog DIMENSIONS read by
 * `lib/character-fx`, and the fold composes both through the platform's own
 * builder so the shot's effect reaches the model exactly as the canvas node's.
 *
 * NO `platformField` — THE single documented exception to the projection
 * invariant (`look-pickers.test.ts`). The platform's direction registry excludes
 * `characterFx` deliberately: it is "a per-shot composer with catalog timing
 * levers positioned at an in-prose effect token; a single-id channel cannot
 * carry it" (`direction-registry.ts`). It therefore stays CLIENT-folded, at its
 * `[fx:…]` token position, and must not be "fixed" by adding a key here.
 */
export const CHARACTER_FX_KEY = "characterFxId"

export function characterFxPicker(): LookPickerConfig {
  return picker({
    key: CHARACTER_FX_KEY,
    label: "Character FX",
    group: "motion",
    surface: "video",
    catalog: CHARACTER_FX,
    getLabel: getCharacterFxLabel,
    getHint: getCharacterFxPromptHint,
    getTerm: getCharacterFxTerm,
    categoryOrder: CHARACTER_FX_CATEGORY_ORDER,
    categoryLabels: CHARACTER_FX_CATEGORY_LABELS,
  })
}

/**
 * WHICH form of a picker's fragment gets injected — the studio's half of the
 * platform's {@link PickerHintMode}.
 *
 * A BARE mode applies to every dimension. The SPLIT form chooses per FAMILY,
 * because one prompt legitimately wants both: a video prompt still describes
 * its LOOK in full paragraphs (the model reads them as description) while its
 * shot-level MOTION reads best as the short professional term a
 * cinematographer would write.
 *
 * The split is keyed off the registry's own {@link LookGroup} — `motion` is the
 * Motion & Time group (Action FX, Temporal, Transition, Loop Subject, plus the
 * standalone Camera Movement picker, which declares the same group), `look` is
 * everything else. Data-driven on purpose: a new motion catalog added to that
 * group rides the motion policy with no edit here.
 */
export type LookHintMode = PickerHintMode | LookHintModeSplit

/** Per-family verbosity (see {@link LookHintMode}). */
export interface LookHintModeSplit {
  /** Mode for the Motion & Time pickers (shot-level video motion). */
  readonly motion: PickerHintMode
  /** Mode for every other cinematic dimension. */
  readonly look: PickerHintMode
}

/** The {@link PickerHintMode} ONE picker resolves under, given a (possibly
 *  split) {@link LookHintMode}. */
export function modeForPicker(
  picker: LookPickerConfig,
  mode: LookHintMode,
): PickerHintMode {
  if (typeof mode === "string") return mode
  return picker.group === "motion" ? mode.motion : mode.look
}

/**
 * The fragment ONE picker injects for a selected id — the SINGLE point where
 * full-vs-compact is decided, so no caller ever branches on the mode itself.
 * Empty string for a cleared pill or a no-op ("auto"/"none") entry, in BOTH
 * modes (the platform's `resolveTerm` guarantees the compact half).
 */
export function pickerFragment(
  picker: LookPickerConfig,
  id: string | undefined | null,
  mode: LookHintMode,
): string {
  return modeForPicker(picker, mode) === "compact"
    ? picker.getTerm(id)
    : picker.getHint(id)
}

// (`cameraMotionFragment` lived here until the direction channel went
// server-side: camera movement is `cameraMotion` in the projection, and
// `renderDirectionHints` emits it FIRST — exactly where studio used to fold its
// phrase by hand. Nothing folds a Look clause client-side any more; do not
// reintroduce a per-picker text helper for one.)
