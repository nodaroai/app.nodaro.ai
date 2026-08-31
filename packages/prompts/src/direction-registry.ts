/**
 * THE DIRECTION REGISTRY — the single, ordered table of every cinematic
 * dimension the flat `direction` channel carries, plus the one renderer that
 * folds it into prompt text.
 *
 * WHY IT EXISTS: before this module, five of the ~35 cinematic dimensions rode
 * the `direction` wire channel and every other dimension was folded into prompt
 * TEXT by the client. A production copied between clients therefore froze stale
 * catalog wording, and each client re-implemented the fold. The table below is
 * the platform-owned replacement: the wire carries ids, the platform renders
 * the clauses, and the fold ORDER is exported so a client preview cannot drift
 * from what the server actually emits.
 *
 * WIRE VOCABULARY: the keys are the platform's OWN node-data field names — the
 * ones `SINGLE_PICKER_WIRING[].valueField` and the four `*_FIELD_BY_CATEGORY`
 * maps already use (`shotSize`, `lightingStyle`, `isoValue`, `style`, `mood`,
 * `cameraMotion`, …). A Studio-emitted graph and a hand-built canvas node
 * therefore speak ONE vocabulary for one catalog, and every `build*Hints`
 * already consumes these names.
 *
 * IMPORT RULE (hard): this module imports only `get*PromptHint` / `get*Term` /
 * `build*Hints` FUNCTIONS — never a raw UPPERCASE catalog array.
 * `catalog-funnel-ratchet.test.ts` derives its watch set from
 * `picker-catalogs.ts`'s uppercase value imports and can only SHRINK, so a raw
 * array import here would be a new offender. Nothing here reads an environment
 * variable either (`content-free-contract.test.ts`) — verbosity and surface are
 * threaded parameters, never deployment state.
 *
 * DELIBERATELY EXCLUDED, so neither is filed as a gap:
 *  - `characterFx` — a per-shot composer with catalog timing levers
 *    (`composeCharacterFxHintFromConnections`) positioned at an in-prose effect
 *    token, not a bare id. A single-id channel cannot carry it.
 *  - Subject / Styling / prop dimensions (`animal`, `heldProp`, `material`,
 *    Person, Styling) — a separate `subject` channel, deliberately out of scope
 *    here.
 *
 * PACK BLINDNESS (parity, not a regression): `get*PromptHint` reads the frozen
 * base arrays, so ids added by a deployment-registered catalog pack resolve to
 * `""` and contribute no clause. This is identical to the behavior of the five
 * keys that shipped before this table; routing through `getPickerCatalog` is a
 * deliberate non-goal.
 */
import type { PickerHintMode } from "./term.js"
import { getFramingPromptHint, getFramingTerm } from "./framing.js"
import { getLightingPromptHint, getLightingTerm } from "./lighting.js"
import { getLensPromptHint, getLensTerm } from "./lens.js"
import { getCameraFormatPromptHint, getCameraFormatTerm } from "./camera-format.js"
import { getCameraMotionPromptHint, getCameraMotionTerm } from "./camera-motions.js"
import { getPosePromptHint, getPoseTerm } from "./pose.js"
import {
  getCompositionEffectPromptHint,
  getCompositionEffectTerm,
} from "./composition-effects.js"
import { getExposurePromptHint, getExposureTerm } from "./exposure-settings.js"
import { getColorLookPromptHint, getColorLookTerm } from "./color-look.js"
import { buildAtmosphereHints } from "./atmosphere.js"
import { buildPostProcessHints } from "./post-process-effects.js"
import { getStylePromptHint, getStyleTerm } from "./style.js"
import { buildMoodHints } from "./mood.js"
import { buildAestheticHints } from "./aesthetic.js"
import { getPhotoGenrePromptHint, getPhotoGenreTerm } from "./photo-genre.js"
import { buildPhotographerHints } from "./photographer.js"
import { getRenderQualityPromptHint, getRenderQualityTerm } from "./render-quality.js"
import { getSettingPromptHint, getSettingTerm } from "./setting.js"
import { getEraPromptHint, getEraTerm } from "./era.js"
import { getBackdropPromptHint, getBackdropTerm } from "./backdrop.js"
import { buildActionFxHints } from "./action-fx.js"
import { getTemporalPromptHint, getTemporalTerm } from "./temporal.js"
import { getTransitionPromptHint, getTransitionTerm } from "./transitions.js"
import { getLoopSubjectPromptHint, getLoopSubjectTerm } from "./loop-subject.js"

/** Which generation stages fold a dimension. */
export type DirectionSurface = "image" | "video" | "both"
/** Verbosity family — the video policy folds `motion` compact, `look` full. */
export type DirectionFamily = "look" | "motion"

export interface DirectionFieldSpec {
  /**
   * Wire key — also the `DirectionFields` property name and the canvas
   * node-data field name for the same catalog.
   */
  readonly key: string
  /**
   * Which generation stages fold this dimension. Filtering happens in the
   * RENDERER, never in the wire schema: an image-only key sent to
   * `/v1/generate-video` is accepted and simply contributes no hint.
   */
  readonly surface: DirectionSurface
  /** Verbosity family. The video policy folds `motion` compact, `look` full. */
  readonly family: DirectionFamily
  /** Ids honored per dimension. Extras are SLICED at render, never a 400. */
  readonly maxPicks: number
  /**
   * Render selected ids in this catalog's own doctrine: per-id for independent
   * catalogs, ONE blended clause for Mood / Aesthetic / Photographer, the
   * catalog's own multi builder where it has one. `[]` when nothing resolves.
   */
  readonly render: (ids: readonly string[], mode: PickerHintMode) => string[]
}

// ── Render adapters (module-private) ────────────────────────────────────────

/**
 * Independent per-id emission — the default doctrine.
 *
 * Only ever passes NON-EMPTY strings (the normalizer drops empties), which is
 * what makes `getLoopSubjectPromptHint(id: string)`'s required-string signature
 * safe here alongside the `string | undefined | null` getters.
 */
const perId =
  (full: (id: string) => string, compact: (id: string) => string) =>
  (ids: readonly string[], mode: PickerHintMode): string[] => {
    const out: string[] = []
    for (const id of ids) {
      const frag = mode === "compact" ? compact(id) : full(id)
      if (frag.length > 0) out.push(frag)
    }
    return out
  }

/** Catalogs whose own builder returns a LIST (atmosphere, post-process, action FX). */
const viaListBuilder =
  (build: (v: unknown, mode: PickerHintMode) => string[]) =>
  (ids: readonly string[], mode: PickerHintMode): string[] =>
    build(ids.length === 1 ? ids[0] : [...ids], mode).filter((s) => s.length > 0)

/** Catalogs whose own builder returns ONE blended clause (aesthetic, photographer). */
const viaStringBuilder =
  (build: (v: unknown, mode: PickerHintMode) => string) =>
  (ids: readonly string[], mode: PickerHintMode): string[] => {
    const s = build(ids.length === 1 ? ids[0] : [...ids], mode)
    return s.length > 0 ? [s] : []
  }

/** Mood's builder takes a RECORD and returns a list — and blends multi picks. */
const viaMood = (ids: readonly string[], mode: PickerHintMode): string[] =>
  buildMoodHints({ mood: ids.length === 1 ? ids[0] : [...ids] }, mode).filter(
    (s) => s.length > 0,
  )

const framing = perId(getFramingPromptHint, getFramingTerm)
const lighting = perId(getLightingPromptHint, getLightingTerm)
const exposure = perId(getExposurePromptHint, getExposureTerm)
const temporal = perId(getTemporalPromptHint, getTemporalTerm)

/**
 * THE TABLE. Declaration order IS fold order (`DIRECTION_KEYS`), pinned by
 * `__tests__/direction-registry.test.ts`.
 *
 * Group order: camera motion leads (matching the video hint order the canvas
 * and Studio both emit today), then composition → camera → exposure → light →
 * style → scene → motion, then the LEGACY BLOCK last.
 *
 * THE LEGACY BLOCK (the last five rows) is the pre-registry published
 * `DirectionFields`, placed LAST in today's exact `composePromptText` order so
 * every existing caller's fold is byte-identical. They are WHOLE-CATALOG keys —
 * `framingId` accepts ANY `FRAMINGS` id and `lightingId` ANY `LIGHTINGS` id —
 * so they are NOT aliases of `shotSize` / `lightingStyle`, and an alias table
 * would wrongly suppress a legal second selection. Overlap is handled instead
 * by the exact-string dedupe in `renderDirectionHints`.
 *
 * SECOND MEANING OF POSITION: BOTH cap-aware assemblers — `assembleImageInput`
 * (stills) and `composeVideoPromptText` (video) — shed hint clauses from the
 * TAIL of this order when a provider's prompt cap overflows, through the one
 * shared arithmetic in `hint-shedding.ts`. So a row's position is also its
 * survival order under the cap on EVERY surface: reordering rows for one
 * surface silently changes what the other drops first, and the row a
 * video-surface reorder would most likely touch (`cameraMotion`) leads the
 * fold. That is a consequence of reusing the fold order, not a ranking — this
 * table stays a compatibility order; anything that needs a real importance
 * ranking should add an explicit priority column rather than reorder these rows.
 */
export const DIRECTION_FIELDS = [
  { key: "cameraMotion", surface: "video", family: "motion", maxPicks: 1, render: perId(getCameraMotionPromptHint, getCameraMotionTerm) },

  // Composition (the Framing catalog, one row per category).
  { key: "shotSize", surface: "both", family: "look", maxPicks: 1, render: framing },
  { key: "angle", surface: "both", family: "look", maxPicks: 1, render: framing },
  { key: "coverage", surface: "both", family: "look", maxPicks: 1, render: framing },
  { key: "composition", surface: "both", family: "look", maxPicks: 2, render: framing },
  { key: "vantage", surface: "both", family: "look", maxPicks: 1, render: framing },
  { key: "pose", surface: "both", family: "look", maxPicks: 1, render: perId(getPosePromptHint, getPoseTerm) },
  { key: "compositionEffect", surface: "both", family: "look", maxPicks: 1, render: perId(getCompositionEffectPromptHint, getCompositionEffectTerm) },

  // Camera.
  { key: "cameraFormat", surface: "both", family: "look", maxPicks: 1, render: perId(getCameraFormatPromptHint, getCameraFormatTerm) },
  { key: "lens", surface: "both", family: "look", maxPicks: 1, render: perId(getLensPromptHint, getLensTerm) },

  // Exposure (stills only — a video's exposure rides its own temporal levers).
  { key: "aperture", surface: "image", family: "look", maxPicks: 1, render: exposure },
  { key: "shutterSpeed", surface: "image", family: "look", maxPicks: 1, render: exposure },
  { key: "isoValue", surface: "image", family: "look", maxPicks: 1, render: exposure },

  // Light (the Lighting catalog, one row per category).
  { key: "timeOfDay", surface: "both", family: "look", maxPicks: 1, render: lighting },
  { key: "lightingStyle", surface: "both", family: "look", maxPicks: 2, render: lighting },
  { key: "lightingDirection", surface: "both", family: "look", maxPicks: 1, render: lighting },
  { key: "lightingRatio", surface: "both", family: "look", maxPicks: 1, render: lighting },
  { key: "colorTemperature", surface: "both", family: "look", maxPicks: 1, render: lighting },
  { key: "colorLook", surface: "both", family: "look", maxPicks: 1, render: perId(getColorLookPromptHint, getColorLookTerm) },
  { key: "atmosphere", surface: "both", family: "look", maxPicks: 2, render: viaListBuilder(buildAtmosphereHints) },
  { key: "postProcess", surface: "image", family: "look", maxPicks: 2, render: viaListBuilder(buildPostProcessHints) },

  // Style.
  { key: "style", surface: "both", family: "look", maxPicks: 1, render: perId(getStylePromptHint, getStyleTerm) },
  { key: "mood", surface: "both", family: "look", maxPicks: 2, render: viaMood },
  { key: "aesthetic", surface: "both", family: "look", maxPicks: 2, render: viaStringBuilder(buildAestheticHints) },
  { key: "photoGenre", surface: "image", family: "look", maxPicks: 1, render: perId(getPhotoGenrePromptHint, getPhotoGenreTerm) },
  { key: "photographer", surface: "image", family: "look", maxPicks: 2, render: viaStringBuilder(buildPhotographerHints) },
  { key: "renderQuality", surface: "image", family: "look", maxPicks: 1, render: perId(getRenderQualityPromptHint, getRenderQualityTerm) },

  // Scene.
  { key: "setting", surface: "both", family: "look", maxPicks: 1, render: perId(getSettingPromptHint, getSettingTerm) },
  { key: "era", surface: "both", family: "look", maxPicks: 1, render: perId(getEraPromptHint, getEraTerm) },
  { key: "backdrop", surface: "both", family: "look", maxPicks: 1, render: perId(getBackdropPromptHint, getBackdropTerm) },

  // Motion & time.
  { key: "actionFx", surface: "video", family: "motion", maxPicks: 2, render: viaListBuilder(buildActionFxHints) },
  { key: "temporalSpeed", surface: "video", family: "motion", maxPicks: 1, render: temporal },
  { key: "temporalFreeze", surface: "video", family: "motion", maxPicks: 1, render: temporal },
  { key: "temporalDirection", surface: "video", family: "motion", maxPicks: 1, render: temporal },
  { key: "temporalShutter", surface: "video", family: "motion", maxPicks: 1, render: temporal },
  { key: "transition", surface: "video", family: "motion", maxPicks: 2, render: perId(getTransitionPromptHint, getTransitionTerm) },
  { key: "loopSubject", surface: "video", family: "motion", maxPicks: 1, render: perId(getLoopSubjectPromptHint, getLoopSubjectTerm) },

  // ── LEGACY BLOCK — see the table doc above. Placed LAST, in today's exact
  //    `composePromptText` order, so every pre-registry caller is byte-identical.
  { key: "framingId", surface: "both", family: "look", maxPicks: 1, render: framing },
  { key: "framingAngleId", surface: "both", family: "look", maxPicks: 1, render: framing },
  { key: "lightingId", surface: "both", family: "look", maxPicks: 1, render: lighting },
  { key: "lensId", surface: "both", family: "look", maxPicks: 1, render: perId(getLensPromptHint, getLensTerm) },
  { key: "cameraFormatId", surface: "both", family: "look", maxPicks: 1, render: perId(getCameraFormatPromptHint, getCameraFormatTerm) },
] as const satisfies ReadonlyArray<DirectionFieldSpec>

export type DirectionFieldRow = (typeof DIRECTION_FIELDS)[number]
export type DirectionKey = DirectionFieldRow["key"]
export type ImageDirectionKey = Extract<DirectionFieldRow, { surface: "image" | "both" }>["key"]
export type VideoDirectionKey = Extract<DirectionFieldRow, { surface: "video" | "both" }>["key"]

/**
 * Flat cinematic-direction ids (Studio / MCP / canvas node data).
 *
 * Every key accepts a single id OR an array: multi-pick dimensions always carry
 * an array, and a single-pick key may legitimately carry one (a client's
 * partition writer preserving legacy out-of-catalog ids). Absent ≠ empty — a
 * missing key means "no hint", never a default.
 */
export type DirectionFields = { readonly [K in DirectionKey]?: string | readonly string[] }

/**
 * Table order — THE canonical fold order. Exported so a client's "will inject
 * into prompt" preview folds in the exact order the server does instead of
 * re-deriving one.
 */
export const DIRECTION_KEYS: ReadonlyArray<DirectionKey> = DIRECTION_FIELDS.map((f) => f.key)

/** Verbosity for a whole fold, or split per family. */
export type DirectionHintMode =
  | PickerHintMode
  | { readonly look: PickerHintMode; readonly motion: PickerHintMode }

/** Image policy: full clause for every dimension (today's behavior). */
export const IMAGE_HINT_MODE_DEFAULT: DirectionHintMode = "full"

/** Video policy: full look clauses, compact motion terms. */
export const VIDEO_HINT_MODE_DEFAULT: DirectionHintMode = { look: "full", motion: "compact" }

export function modeForFamily(mode: DirectionHintMode, family: DirectionFamily): PickerHintMode {
  return typeof mode === "string" ? mode : family === "motion" ? mode.motion : mode.look
}

/**
 * Wire tolerance ceiling for an array-valued direction key. The SEMANTIC cap is
 * the per-row render-time slice (`maxPicks`) — this is only the point past
 * which a body is malformed rather than merely over-generous.
 */
export const DIRECTION_ARRAY_CEILING = 8

/**
 * Tolerance ceiling for the LENGTH of a single direction id. Catalog ids are
 * short slugs (<= ~40 chars); 100 is generous and closes an otherwise unbounded
 * string channel that lands verbatim in `jobs.input_data`.
 *
 * ONE literal for BOTH doors into the fold — the route's `directionSchema`
 * (`backend/src/lib/direction-schema.ts`) and the persisted-node reader
 * (`read-node-direction.ts`) — so the wire and the canvas cannot start
 * disagreeing about which strings are ids at all.
 */
export const DIRECTION_ID_MAX_CHARS = 100

/**
 * `string | string[]` → deduped, non-empty, capped id list.
 *
 * The `ids.length >= maxPicks` bail is load-bearing, not an optimization: the
 * dedupe is an `includes` scan, so without it the cost is quadratic in the
 * CALLER's array length — and one caller (`readDirectionFields`) reads
 * untrusted persisted JSONB. Bailing is semantics-preserving: once `maxPicks`
 * unique ids exist, no later entry can change the sliced result (and
 * `maxPicks = 0` still yields `[]`).
 */
function normalizeDirectionIds(value: unknown, maxPicks: number): string[] {
  const ids: string[] = []
  if (typeof value === "string") {
    if (value) ids.push(value)
  } else if (Array.isArray(value)) {
    for (const v of value) {
      if (ids.length >= maxPicks) break
      if (typeof v === "string" && v && !ids.includes(v)) ids.push(v)
    }
  }
  return ids.slice(0, maxPicks)
}

/** The rows a given generation stage folds, in table order. */
export function directionFieldsForSurface(
  surface: "image" | "video",
): ReadonlyArray<DirectionFieldSpec> {
  return DIRECTION_FIELDS.filter((f) => f.surface === "both" || f.surface === surface)
}

/**
 * Every clause the `direction` channel injects, in canonical table order.
 *
 * Iterates the TABLE (never the caller's object), so unknown wire keys are
 * ignored, the order is platform-owned, and off-surface dimensions are inert.
 * Unknown IDS are silently skipped too — every `get*PromptHint` returns `""` on
 * a miss, so a retired or pack-only id contributes no clause rather than a 400.
 *
 * DEDUPE: the result is de-duplicated by exact clause string, FIRST OCCURRENCE
 * WINS (order-preserving). This is what lets the five legacy whole-catalog keys
 * (`framingId`, `lightingId`, …) coexist with their canonical counterparts
 * without an alias table: a caller sending `framingId` and `shotSize` with the
 * SAME id emits the clause once, while `lightingId: "golden-hour"` alongside
 * `lightingStyle: "rembrandt"` correctly emits BOTH (they are different ids in
 * the same catalog — an alias table would have wrongly suppressed one).
 * A caller sending two DIFFERENT ids for the same dimension gets both clauses,
 * exactly as two wired picker nodes of one family behave today.
 *
 * Exported so a client's "will inject into prompt" preview renders the exact
 * server output instead of re-implementing the fold.
 */
export function renderDirectionHints(
  direction: DirectionFields | undefined,
  opts: { surface: "image" | "video"; mode?: DirectionHintMode },
): string[] {
  if (!direction) return []
  const mode = opts.mode ?? "full"
  const out: string[] = []
  const seen = new Set<string>()
  for (const spec of DIRECTION_FIELDS) {
    if (spec.surface !== "both" && spec.surface !== opts.surface) continue
    const ids = normalizeDirectionIds(
      (direction as Record<string, unknown>)[spec.key],
      spec.maxPicks,
    )
    if (ids.length === 0) continue
    for (const hint of spec.render(ids, modeForFamily(mode, spec.family))) {
      if (hint.length > 0 && !seen.has(hint)) {
        seen.add(hint)
        out.push(hint)
      }
    }
  }
  return out
}
