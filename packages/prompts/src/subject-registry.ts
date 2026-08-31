/**
 * THE SUBJECT REGISTRY — the ordered table of every SUBJECT dimension the flat
 * `subject` channel carries (who is in the shot: Person, Styling, and the three
 * prop catalogs), plus the one renderer that folds it into prompt text.
 *
 * WHY A SECOND CHANNEL, NOT `StructuredPromptFields`: that type is FREE TEXT
 * (`person.hair?: string` → "with {hair} hair"), its reader is a hand-authored
 * field table whose totality is compile-time enforced by mapped types, its
 * values are bounded as prose (200 chars), and it renders as headed sentences
 * ("Subject: …. Style: …."). None of those survive contact with ~50 CATALOG IDS
 * plus deployment-registered pack dimensions unknown at compile time, whose
 * hints are authored as comma-joinable compound clauses. `direction-registry.ts`
 * already has the four properties this channel needs — a platform-owned fold
 * order exported for client preview parity, a DERIVED wire schema and node
 * reader, unknown-key/unknown-id inertness, and shared bounds across both doors
 * — so this module mirrors it. `direction-registry.ts` hands this scope off by
 * name in its own header.
 *
 * WIRE VOCABULARY: the keys are the platform's OWN node-data field names — the
 * ones `PERSON_FIELD_BY_DIMENSION` / `STYLING_FIELD_BY_DIMENSION` and the prop
 * pickers' `valueField` already use (`hairBase`, `lipState`, `wardrobeState`,
 * `heldProp`, `material`, `animal`, …). A canvas person/styling node stores
 * exactly these, and every `build*Hints` already consumes them.
 *
 * THE WIRE IS A FLAT BAG, AND THE FLATNESS IS LOAD-BEARING (not a shortcut):
 * `collectStylingFragments` reads `data.lipState` — a PERSON field — to skip
 * `makeup-bold-lips` when `lip-state-bold-red` is already selected. That dedupe
 * only fires for a consumer folding both pickers off ONE shared value map,
 * which is precisely what this channel is. Nesting `person` / `styling` as
 * sub-records would hand the styling builder a bag with no `lipState` in it and
 * the lipstick clause would silently double. Hence: flat wire, and the group
 * rows below receive the WHOLE normalized bag rather than a slice of it.
 *
 * PRE/POST FREE TEXT IS DELIBERATELY OFF THE WIRE (v1): `PersonValue` and
 * `StylingValue` BOTH declare `preText`/`postText` and both `collect*Fragments`
 * read them, so a shared flat bag would emit the same prose twice. They are the
 * only genuine key collision in the set and are simply not `SUBJECT_KEYS`, so
 * the normalizer drops them. Per-subject free text is the one future need that
 * would force either nesting or suffixed keys (`personPreText` / …).
 *
 * IMPORT RULE (hard, inherited from the direction registry): this module
 * imports only `get*PromptHint` / `get*Term` / `build*Hints` FUNCTIONS and the
 * `*_FIELD_BY_DIMENSION` / `*_DIMENSION_ORDER` maps — never a raw UPPERCASE
 * catalog array (`PEOPLE`, `STYLINGS`, `ANIMALS`). `catalog-funnel-ratchet.test.ts`
 * derives its watch set from `picker-catalogs.ts`'s uppercase value imports and
 * can only SHRINK, so a raw array import here would be a new offender — which
 * is exactly why the animal getters live in `@nodaro/shared`. Nothing here
 * reads an environment variable either (`content-free-contract.test.ts`):
 * verbosity and surface are threaded parameters, never deployment state.
 *
 * DISJOINT FROM `direction` BY CONTRACT: `SUBJECT_KEYS ∩ DIRECTION_KEYS = ∅`,
 * pinned by a test. `pose` rides `direction` even though the picker wiring files
 * it under "Subject / Object"; keeping the two key sets disjoint is what stops
 * one selection emitting two clauses.
 */
import type { PickerHintMode } from "./term.js"
import {
  DIRECTION_ARRAY_CEILING,
  DIRECTION_ID_MAX_CHARS,
} from "./direction-registry.js"
import {
  buildPersonHints,
  getPersonDimensionLimit,
  PERSON_DIMENSION_ORDER,
  PERSON_FIELD_BY_DIMENSION,
  type PersonDimension,
  type PersonValue,
} from "./person.js"
import { getRegisteredPersonFieldByDimension } from "./person-packs.js"
import {
  buildStylingHints,
  getStylingDimensionLimit,
  STYLING_DIMENSION_ORDER,
  STYLING_FIELD_BY_DIMENSION,
  type StylingDimension,
  type StylingValue,
} from "./styling.js"
import { buildHeldPropHints } from "./held-prop.js"
import { buildMaterialHints } from "./materials.js"
import { getAnimalPromptHint, getAnimalTerm } from "@nodaro/shared"

/** Which generation stages fold a dimension (mirrors `DirectionSurface`). */
export type SubjectSurface = "image" | "video" | "both"

/**
 * Flat subject ids — the wire shape and the canvas node-data shape.
 *
 * Keys are the platform's own field names; a value is one id, a list of ids, or
 * (for `customAge` alone) a number. Absent ≠ empty: a missing key means "no
 * hint", never a default.
 */
export type SubjectFields = Readonly<Record<string, string | readonly string[] | number>>

/**
 * A fold row whose render consumes the WHOLE normalized bag and returns ONE
 * already-joined clause.
 *
 * Two reasons this kind exists rather than one row per person/styling field:
 *  1. the cross-catalog dedupe described in the module header needs the whole
 *     bag in one call;
 *  2. these builders emit FRAGMENTS, not clauses — 30 person fragments handed
 *     to the `". "` prompt-hint join read as "a beautiful woman. in her 30s.
 *     East Asian." The catalogs' own grammar is a comma-joined compound clause,
 *     so the row joins with ", " and hands back a single piece.
 */
export interface SubjectGroupFieldSpec {
  /** Fold-row id. NOT a wire key — a group row reads many of them. */
  readonly key: string
  readonly kind: "group"
  readonly surface: SubjectSurface
  /** The whole normalized bag in, one joined clause out (`[]` when empty). */
  readonly render: (subject: SubjectFields, mode: PickerHintMode) => string[]
}

/** A fold row that reads ONE wire key holding catalog ids (the prop catalogs). */
export interface SubjectIdsFieldSpec {
  /** Wire key AND fold-row id — these rows are one key each. */
  readonly key: string
  readonly kind: "ids"
  readonly surface: SubjectSurface
  /** Ids honored. Extras are SLICED by the normalizer, never a 400. */
  readonly maxPicks: number
  readonly render: (ids: readonly string[], mode: PickerHintMode) => string[]
}

export type SubjectFieldSpec = SubjectGroupFieldSpec | SubjectIdsFieldSpec

// ── Render adapters (module-private) ────────────────────────────────────────

/**
 * The shape both group builders accept. Their declared parameters are
 * `Record<string, unknown> & PersonValue` and `… & StylingValue`; the
 * intersection is assignable to both, so ONE adapter serves both rows without
 * erasing the argument type — a builder signature change fails to typecheck
 * here rather than silently passing the wrong bag.
 */
type SubjectBuilderData = Record<string, unknown> & PersonValue & StylingValue

/** A `build*Hints` that returns FRAGMENTS → one comma-joined clause. */
const viaFragmentBuilder =
  (build: (data: SubjectBuilderData, mode: PickerHintMode) => string[]) =>
  (subject: SubjectFields, mode: PickerHintMode): string[] => {
    const clause = build(subject as unknown as SubjectBuilderData, mode)
      .filter((s) => s.length > 0)
      .join(", ")
    return clause.length > 0 ? [clause] : []
  }

/** A catalog whose own builder already returns a clause LIST (held props). */
const viaListBuilder =
  (build: (v: unknown, mode: PickerHintMode) => string[]) =>
  (ids: readonly string[], mode: PickerHintMode): string[] =>
    build(ids.length === 1 ? ids[0] : [...ids], mode).filter((s) => s.length > 0)

/** A catalog whose own builder returns ONE blended clause (materials). */
const viaStringBuilder =
  (build: (v: unknown, mode: PickerHintMode) => string) =>
  (ids: readonly string[], mode: PickerHintMode): string[] => {
    const s = build(ids.length === 1 ? ids[0] : [...ids], mode)
    return s.length > 0 ? [s] : []
  }

/**
 * Independent per-id emission — the same doctrine as the direction registry's
 * `perId`. Only ever receives NON-EMPTY ids (the normalizer drops empties).
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

/**
 * THE TABLE. Declaration order IS fold order (`SUBJECT_FOLD_KEYS`), pinned by
 * `__tests__/subject-registry.test.ts`.
 *
 * Person leads (who), then how they are styled, then what they hold, what it is
 * made of, and finally the animal in frame. Both group rows run over the SAME
 * normalized bag, in this order, which is what keeps the styling builder's
 * `lipState` dedupe alive.
 */
export const SUBJECT_FIELDS = [
  { key: "person", kind: "group", surface: "both", render: viaFragmentBuilder(buildPersonHints) },
  { key: "styling", kind: "group", surface: "both", render: viaFragmentBuilder(buildStylingHints) },
  { key: "heldProp", kind: "ids", surface: "both", maxPicks: 2, render: viaListBuilder(buildHeldPropHints) },
  { key: "material", kind: "ids", surface: "both", maxPicks: 2, render: viaStringBuilder(buildMaterialHints) },
  { key: "animal", kind: "ids", surface: "both", maxPicks: 1, render: perId(getAnimalPromptHint, getAnimalTerm) },
] as const satisfies ReadonlyArray<SubjectFieldSpec>

export type SubjectFieldRow = (typeof SUBJECT_FIELDS)[number]

/**
 * Table order — THE canonical fold order, over ROWS (not wire keys). Exported
 * so a client's "will inject into prompt" preview folds in the exact order the
 * server does, the way `DIRECTION_KEYS` does for direction.
 */
export const SUBJECT_FOLD_KEYS: ReadonlyArray<string> = SUBJECT_FIELDS.map((f) => f.key)

/** The prop rows — the wire keys a fold row owns one-to-one. */
const IDS_ROWS: ReadonlyArray<SubjectIdsFieldSpec> = (
  SUBJECT_FIELDS as ReadonlyArray<SubjectFieldSpec>
).filter((f): f is SubjectIdsFieldSpec => f.kind === "ids")

/**
 * The one person field that is a NUMBER, not ids: the literal age in years,
 * consulted only when `age === "age-custom"` (`buildAgeFragment`). It has no
 * styling twin, so it rides the flat bag without collision.
 */
export const SUBJECT_CUSTOM_AGE_KEY = "customAge"

/** `customAge` bounds, mirroring `buildAgeFragment`'s own clamp. */
const CUSTOM_AGE_MIN = 0
const CUSTOM_AGE_MAX = 120

/**
 * THE WIRE KEY SET, derived — every person field, `customAge`, every styling
 * field, then the prop rows, in fold order. Never hand-listed: a dimension
 * added to either catalog joins the channel by construction.
 *
 * BASE ONLY, deliberately: a deployment-registered person pack adds dimensions
 * at RUNTIME, so the pack-aware set is computed per call inside
 * `normalizeSubjectFields` (and inside `readSubjectFields`). This constant is
 * what a client enumerates to build its projection; a pack dimension it cannot
 * know about still rides the wire and still folds.
 *
 * ONE CONSEQUENCE, noted rather than fixed: the person builder's legacy `lips`
 * fallback field is not a dimension and so is not here, making it unreachable
 * through this channel. Intended — the wire speaks the current vocabulary; the
 * fallback stays for node blobs written before the split.
 */
export const SUBJECT_KEYS: ReadonlyArray<string> = [
  ...PERSON_DIMENSION_ORDER.map((d) => PERSON_FIELD_BY_DIMENSION[d]),
  SUBJECT_CUSTOM_AGE_KEY,
  ...STYLING_DIMENSION_ORDER.map((d) => STYLING_FIELD_BY_DIMENSION[d]),
  ...IDS_ROWS.map((f) => f.key),
]

/** Verbosity for a whole subject fold. No family split — subject is one family. */
export type SubjectHintMode = PickerHintMode

/** Image policy: the full mechanism clause for every dimension. */
export const SUBJECT_IMAGE_HINT_MODE_DEFAULT: SubjectHintMode = "full"

/**
 * Video policy: the compact professional term.
 *
 * A fully specified person at `"full"` is ~30 paragraph clauses, and on the
 * video stage the start frame already carries the subject's identity — the
 * clip's prompt needs the subject NAMED, not re-described. (The image stage,
 * which is where the subject is actually being built, keeps `"full"`.)
 */
export const SUBJECT_VIDEO_HINT_MODE_DEFAULT: SubjectHintMode = "compact"

/**
 * Wire tolerance ceiling for an array-valued subject key, and the ceiling for
 * one id's length. DEFINED AS the direction constants rather than re-typed, so
 * ONE literal governs both channels and both doors (the route schema and the
 * persisted-node reader) — the wire and the canvas cannot start disagreeing
 * about which strings are ids at all.
 */
export const SUBJECT_ARRAY_CEILING = DIRECTION_ARRAY_CEILING
export const SUBJECT_ID_MAX_CHARS = DIRECTION_ID_MAX_CHARS

/**
 * Bound on the NUMBER of keys in a subject bag. `SUBJECT_KEYS` is 54 today;
 * this leaves generous headroom for deployment-registered pack dimensions while
 * still closing an otherwise unbounded record that lands verbatim in
 * `jobs.input_data`. Unknown keys are inert (the renderer never reads them), so
 * this is storage hygiene, not validation.
 */
export const MAX_SUBJECT_KEYS = 128

/** Bound on the LENGTH of one wire key. Field names are short identifiers. */
export const SUBJECT_KEY_MAX_CHARS = 64

/**
 * `string | string[]` → deduped, non-empty, capped id list.
 *
 * Byte-for-byte the direction registry's `normalizeDirectionIds`, including the
 * `ids.length >= maxPicks` bail — load-bearing, not an optimization: the dedupe
 * is an `includes` scan, so without it the cost is quadratic in the CALLER's
 * array length, and one caller reads untrusted persisted JSONB. Bailing is
 * semantics-preserving: once `maxPicks` unique ids exist, no later entry can
 * change the sliced result.
 */
function normalizeIds(value: unknown, maxPicks: number): string[] {
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

/**
 * Pack-aware field → per-dimension pick limit, rebuilt per call.
 *
 * Person's dimension→field map is pack-composed at runtime
 * (`getRegisteredPersonFieldByDimension`), so this cannot be a module constant;
 * a pack dimension is single-select today (`getPersonDimensionLimit` knows only
 * the base union and resolves a pack key to 1 — see `PersonPack.dimensions`).
 * Styling has no pack seam and reads its static map.
 */
function limitByField(): Map<string, number> {
  const out = new Map<string, number>()
  const personFieldByDimension = getRegisteredPersonFieldByDimension()
  for (const dimension of Object.keys(personFieldByDimension)) {
    const field = personFieldByDimension[dimension]
    if (field) out.set(field, getPersonDimensionLimit(dimension as PersonDimension))
  }
  for (const dimension of STYLING_DIMENSION_ORDER) {
    out.set(
      STYLING_FIELD_BY_DIMENSION[dimension],
      getStylingDimensionLimit(dimension as StylingDimension),
    )
  }
  for (const row of IDS_ROWS) out.set(row.key, row.maxPicks)
  return out
}

/**
 * THE NORMALIZER — a known-key, per-dimension-capped copy of a subject bag.
 *
 * WHY IT EXISTS (and why the fold is unusable without it): the subject builders
 * do NOT cap. `collectPersonFragments` / `collectStylingFragments` /
 * `emitIndependentFragments` emit EVERY id they are handed; `normalizePickIds`
 * and `pickHeldPropIds` dedupe but never slice; only `buildMaterialHints` caps,
 * and only structurally at 2. `MAX_SELECTED_BY_DIMENSION`'s own doc names its
 * consumers as the picker UI, the analyzer schema and the Zod validator — NOT
 * the builders. Straight off the wire, then, a bag is a clause amplifier: 8 ids
 * (the array ceiling) on each of ~50 dimensions. This is where the per-dimension
 * cap actually gets enforced.
 *
 * It also:
 *  - DROPS UNKNOWN KEYS, so `jobs.input_data` stays the platform's vocabulary
 *    (unknown IDS stay inert instead — every getter resolves a miss to `""`);
 *  - UNWRAPS a single-id array to a bare string. Load-bearing:
 *    `collectPersonFragments` reads a single-pick dimension with
 *    `typeof raw === "string"`, so a legitimate `["hair-base-long"]` from a
 *    client's array-shaped store would otherwise contribute NOTHING;
 *  - clamps `customAge` to a whole `0..120`, mirroring `buildAgeFragment`.
 *
 * Copy-on-write: the caller's object is never mutated. Idempotent, so calling it
 * at a door AND inside the renderer is free.
 */
export function normalizeSubjectFields(
  subject: SubjectFields | undefined,
): SubjectFields | undefined {
  if (!subject || typeof subject !== "object" || Array.isArray(subject)) return undefined
  const src = subject as Record<string, unknown>
  const limits = limitByField()
  const out: Record<string, string | string[] | number> = {}

  const rawAge = src[SUBJECT_CUSTOM_AGE_KEY]
  if (typeof rawAge === "number" && Number.isFinite(rawAge)) {
    out[SUBJECT_CUSTOM_AGE_KEY] = Math.max(
      CUSTOM_AGE_MIN,
      Math.min(CUSTOM_AGE_MAX, Math.round(rawAge)),
    )
  }

  for (const [field, limit] of limits) {
    const ids = normalizeIds(src[field], limit)
    if (ids.length === 0) continue
    out[field] = ids.length === 1 ? ids[0]! : ids
  }

  return Object.keys(out).length > 0 ? out : undefined
}

/** The rows a given generation stage folds, in table order. */
export function subjectFieldsForSurface(
  surface: "image" | "video",
): ReadonlyArray<SubjectFieldSpec> {
  return SUBJECT_FIELDS.filter((f) => f.surface === "both" || f.surface === surface)
}

/**
 * Every clause the `subject` channel injects, in canonical table order.
 *
 * NORMALIZES ONCE, at the top, and hands THE SAME bag to both group rows — that
 * single shared bag is the mechanism behind the styling builder's cross-catalog
 * `lipState` dedupe, and it must not depend on a door having normalized first
 * (the normalizer is idempotent, so a door may do it too).
 *
 * Iterates the TABLE, never the caller's object: unknown wire keys contribute
 * nothing, the order is platform-owned, and an off-surface row is inert.
 * Unknown IDS are skipped too — every `get*PromptHint` returns `""` on a miss,
 * so a retired or pack-only id costs no clause rather than a 400.
 *
 * DEDUPE by exact clause string, FIRST OCCURRENCE WINS (order-preserving),
 * matching `renderDirectionHints`.
 *
 * Exported so a client's "will inject into prompt" preview renders the exact
 * server output — called on the very object the client sends — instead of
 * re-implementing the fold.
 */
export function renderSubjectHints(
  subject: SubjectFields | undefined,
  opts: { surface: "image" | "video"; mode?: SubjectHintMode },
): string[] {
  const bag = normalizeSubjectFields(subject)
  if (!bag) return []
  const mode = opts.mode ?? "full"
  const out: string[] = []
  const seen = new Set<string>()
  for (const spec of SUBJECT_FIELDS) {
    if (spec.surface !== "both" && spec.surface !== opts.surface) continue
    const hints =
      spec.kind === "group"
        ? spec.render(bag, mode)
        : spec.render(normalizeIds((bag as Record<string, unknown>)[spec.key], spec.maxPicks), mode)
    for (const hint of hints) {
      if (hint.length > 0 && !seen.has(hint)) {
        seen.add(hint)
        out.push(hint)
      }
    }
  }
  return out
}
