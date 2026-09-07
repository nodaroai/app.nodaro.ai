import {
  ANIMALS,
  ANIMAL_SUBCATEGORY_ORDER,
  ANIMAL_SUBCATEGORY_LABELS,
  getAnimalLabel,
} from "@nodaro/shared"
import {
  // Person (multi-dim)
  PEOPLE,
  // Styling (multi-dim)
  STYLINGS,
  // Props / elements (single-pick)
  HELD_PROPS,
  PERSON_DIMENSION_LABELS,
  PERSON_DIMENSION_SECTIONS,
  PERSON_FIELD_BY_DIMENSION,
  buildPersonHints,
  getPersonDimensionLimit,
  getPersonLabel,
  STYLING_DIMENSION_LABELS,
  STYLING_DIMENSION_ORDER,
  STYLING_FIELD_BY_DIMENSION,
  buildStylingHints,
  getStylingDimensionLimit,
  getStylingLabel,
  HELD_PROP_CATEGORY_ORDER,
  HELD_PROP_CATEGORY_LABELS,
  getHeldPropLabel,
  getHeldPropPromptHint,
  getHeldPropTerm,
  MATERIALS,
  MATERIAL_CATEGORY_ORDER,
  MATERIAL_CATEGORY_LABELS,
  getMaterialLabel,
  getMaterialPromptHint,
  getMaterialTerm,
  getParameterPromptHint,
  type PersonDimension,
  type PickerHintMode,
  type StylingDimension,
} from "@nodaro/prompts"

import type { LookCatalogEntry, LookCategoryConfig, PillConfig } from "./look-pickers"

/**
 * The "Subject" pickers — WHO / WHAT is in the frame (vs the "Look" pickers, which
 * are HOW it's shot). Two shapes:
 *
 *  - MULTI-DIMENSIONAL (Person, Styling): one flat catalog where each entry's
 *    `dimension` says which sub-dimension it's in, a `*_FIELD_BY_DIMENSION` map
 *    (dimension → data field), and a `build*Hints(value)` that folds the
 *    `{ field: id }` value object into RICH per-dimension clauses. The platform
 *    recipe (confirmed by the author). We render our OWN tile grid and fold via
 *    the official builder — never a re-implementation.
 *  - SINGLE-PICK props (Held Prop, Material, Animal): a normal catalog pill folded
 *    by its own `get*PromptHint` (Animal via the unified `getParameterPromptHint`,
 *    since it ships no standalone helper).
 *
 * THE UI ONLY (S6). These are the pills, their catalogs, their labels and their
 * per-dimension caps. The selection they write — a flat {@link
 * SubjectSelection} keyed by the PLATFORM's own field names — is projected onto
 * the platform's `subject` wire channel by `subject`, and the clauses are
 * folded by the ROUTE. The one client fold left here ({@link
 * subjectCreationHints}) serves the entity creators, which target the entity
 * generate routes instead.
 *
 * VERBOSITY: the fold below takes a REQUIRED {@link PickerHintMode} so the
 * choice is made at the call site, never defaulted. (The generate stages get
 * theirs from the platform's own `SUBJECT_*_HINT_MODE_DEFAULT` — see
 * `subject`.)
 *
 * TODO(nodaro): the author offered to enrich `PICKER_CATALOGS` so multi entries are
 * self-describing — then this builds straight off the registry. Until shipped +
 * re-vendored we assemble from the public exports (all public today).
 */

/** A user's Subject selection — a flat `dimensionField → chosen id(s)` map. Some
 *  dimensions are MULTI-pick (mixed heritage, stacked jewelry…) so a field may
 *  hold an array (the value shape `build*Hints` accepts). */
export type SubjectSelection = Record<string, string | ReadonlyArray<string>>

/** One sub-dimension of a multi-dim picker: which field it writes + its pill. */
export interface SubjectDimension {
  readonly field: string
  readonly label: string
  readonly pill: PillConfig
  /** Allow more than one pick (e.g. Ethnicity → "Israeli + Italian" → mixed heritage). */
  readonly multi?: boolean
  /** Cap for a multi dimension (Nodaro: 2–3 depending on the dimension). */
  readonly maxPicks?: number
}

/** An app-owned UI grouping of sub-dimensions (keeps a many-dim picker scannable). */
export interface SubjectSection {
  readonly label: string
  readonly dimensions: ReadonlyArray<SubjectDimension>
}

/** A complete multi-dimensional picker — sections of dimensions + the fold. */
export interface MultiDimPickerSpec {
  readonly key: string
  readonly label: string
  readonly sections: ReadonlyArray<SubjectSection>
  readonly buildHints: (
    value: SubjectSelection,
    mode: PickerHintMode,
  ) => string[]
}

/** A single-pick "prop" picker — one catalog pill + both folds (the RICH
 *  clause and the SHORT professional term; see {@link propFragment}). */
export interface PropPicker {
  readonly pill: PillConfig
  readonly getHint: (id?: string | null) => string
  readonly getTerm: (id?: string | null) => string
}

/** The fragment ONE prop picker injects under `mode` — the single point where
 *  full-vs-compact is decided for the props, mirroring `pickerFragment`. */
export function propFragment(
  p: PropPicker,
  id: string | undefined | null,
  mode: PickerHintMode,
): string {
  return mode === "compact" ? p.getTerm(id) : p.getHint(id)
}

/** Sub-group config for a dimension whose entries carry a `group` (first-seen order). */
function groupsFor(
  options: ReadonlyArray<LookCatalogEntry & { group?: string }>,
): LookCategoryConfig | undefined {
  const order: string[] = []
  for (const o of options) {
    const g = o.group
    if (g && !order.includes(g)) order.push(g)
  }
  if (order.length === 0) return undefined
  return {
    order,
    labels: Object.fromEntries(order.map((g) => [g, g])),
    categoryOf: (e) => (e as { group?: string }).group ?? "",
  }
}

/** Assemble one {@link SubjectDimension}. `maxPicks` (when set) makes it multi-pick. */
function dimension(
  field: string,
  label: string,
  options: ReadonlyArray<LookCatalogEntry & { group?: string }>,
  getLabel: (id?: string | null) => string,
  maxPicks?: number,
): SubjectDimension {
  return {
    field,
    label,
    pill: {
      key: field,
      label,
      catalog: options,
      getLabel,
      searchPlaceholder: `Search ${label.toLowerCase()}…`,
      categories: groupsFor(options),
    },
    ...(maxPicks !== undefined ? { multi: true, maxPicks } : {}),
  }
}

/** Inputs to assemble a multi-dim picker from a flat `@nodaro/shared` catalog. */
interface MultiDimSource {
  readonly key: string
  readonly label: string
  /** App-owned section grouping (label + the dimension keys it holds, in order). */
  readonly sections: ReadonlyArray<{ label: string; dims: ReadonlyArray<string> }>
  /** This dimension's options (catalog filtered to that dimension). */
  readonly optionsFor: (dim: string) => ReadonlyArray<LookCatalogEntry & { group?: string }>
  readonly dimLabel: (dim: string) => string
  readonly dimField: (dim: string) => string
  readonly getLabel: (id?: string | null) => string
  readonly buildHints: (
    value: SubjectSelection,
    mode: PickerHintMode,
  ) => string[]
  /** Multi-pick cap for a dimension, or undefined for single-pick. */
  readonly maxPicks?: (dim: string) => number | undefined
}

function buildMultiDim(src: MultiDimSource): MultiDimPickerSpec {
  return {
    key: src.key,
    label: src.label,
    sections: src.sections.map((s) => ({
      label: s.label,
      dimensions: s.dims.map((dim) =>
        dimension(
          src.dimField(dim),
          src.dimLabel(dim),
          src.optionsFor(dim),
          src.getLabel,
          src.maxPicks?.(dim),
        ),
      ),
    })),
    buildHints: src.buildHints,
  }
}

// ── Person ──────────────────────────────────────────────────────────────────

/**
 * The pick cap for ONE dimension, read from the platform registry — `1` there
 * means single-pick, which studio expresses as "no `maxPicks`" (a bare pill
 * rather than a multi-select).
 *
 * There used to be a hand-written table here, and it had drifted: studio capped
 * `wardrobe-state` at 2 where the registry says 3. Asking the registry removes
 * that class of bug permanently — and it is now belt-and-braces, since
 * `normalizeSubjectFields` slices every dimension at the same limit on the wire.
 */
function multiCap(limit: number): number | undefined {
  return limit > 1 ? limit : undefined
}

export const PERSON_PICKER: MultiDimPickerSpec = buildMultiDim({
  key: "person",
  label: "Person",
  // DATA-DRIVEN section grouping: derive straight from the platform's own
  // PERSON_DIMENSION_SECTIONS (the machine-readable form of the catalog's
  // dimension-order section comments — its guard test asserts it partitions
  // every PersonDimension exactly once). New dimensions ride in automatically on
  // the next re-vendor — e.g. the facial-geometry layer (cheekbones, facial
  // fullness, eyelid type, canthal tilt, eye spacing, eye-set/brow, nose tip,
  // lip fullness, lip shape) — and retired ones drop out (the legacy combined
  // `lips`, split into lip-fullness + lip-shape) with ZERO studio edits. Studio
  // owns NOTHING of this any more: section membership, order and the multi-pick
  // caps are all the platform's, never re-listed here.
  sections: PERSON_DIMENSION_SECTIONS.map((s) => ({
    label: s.label,
    dims: s.dimensions,
  })),
  optionsFor: (dim) => PEOPLE.filter((p) => p.dimension === (dim as PersonDimension)),
  dimLabel: (dim) => PERSON_DIMENSION_LABELS[dim as PersonDimension],
  dimField: (dim) => PERSON_FIELD_BY_DIMENSION[dim as PersonDimension],
  getLabel: getPersonLabel,
  buildHints: (v, mode) =>
    buildPersonHints(v as Parameters<typeof buildPersonHints>[0], mode),
  maxPicks: (dim) => multiCap(getPersonDimensionLimit(dim as PersonDimension)),
})

// ── Styling ─────────────────────────────────────────────────────────────────

/**
 * Styling has no platform section table the way Person does
 * (`PERSON_DIMENSION_SECTIONS`), so the LABELS and the grouping below stay
 * app-owned — but MEMBERSHIP is reconciled against `STYLING_DIMENSION_ORDER` by
 * {@link stylingSections}, so the list can no longer silently disagree with the
 * catalog in either direction.
 */
const STYLING_SECTION_GROUPING: ReadonlyArray<{
  label: string
  dims: ReadonlyArray<string>
}> = [
  {
    label: "Beauty & Hair",
    dims: ["makeup", "hair-cut", "hair-treatment", "hair-state", "nails", "face-paint"],
  },
  { label: "Accessories", dims: ["eyewear", "headwear", "jewelry"] },
  {
    label: "Wardrobe",
    dims: ["outfit", "top", "bottom", "outerwear", "legwear", "footwear"],
  },
  { label: "Fabric & Fit", dims: ["fabric", "wardrobe-state"] },
]

/**
 * The curated grouping, RECONCILED with the platform's own dimension list:
 *
 *  - a dimension the catalog retired drops out of its section (studio would
 *    otherwise render an empty pill whose label lookup is `undefined`);
 *  - a dimension the catalog ADDED that no section lists lands in a trailing
 *    "More" section, so a new styling dimension can never be invisible in
 *    studio's UI — the drift this replaces, and the one Person is already
 *    immune to because its sections are platform-derived.
 *
 * The invariant (every `STYLING_DIMENSION_ORDER` entry appears exactly once) is
 * pinned by a guard test rather than trusted.
 */
function stylingSections(): ReadonlyArray<{
  label: string
  dims: ReadonlyArray<string>
}> {
  const live = new Set<string>(STYLING_DIMENSION_ORDER)
  const placed = new Set<string>()
  const sections = STYLING_SECTION_GROUPING.map((s) => {
    const dims = s.dims.filter((d) => live.has(d))
    for (const d of dims) placed.add(d)
    return { label: s.label, dims }
  }).filter((s) => s.dims.length > 0)
  const rest = STYLING_DIMENSION_ORDER.filter((d) => !placed.has(d))
  return rest.length > 0 ? [...sections, { label: "More", dims: rest }] : sections
}

export const STYLING_PICKER: MultiDimPickerSpec = buildMultiDim({
  key: "styling",
  label: "Styling",
  sections: stylingSections(),
  optionsFor: (dim) => STYLINGS.filter((s) => s.dimension === (dim as StylingDimension)),
  dimLabel: (dim) => STYLING_DIMENSION_LABELS[dim as StylingDimension],
  dimField: (dim) => STYLING_FIELD_BY_DIMENSION[dim as StylingDimension],
  getLabel: getStylingLabel,
  buildHints: (v, mode) =>
    buildStylingHints(v as Parameters<typeof buildStylingHints>[0], mode),
  maxPicks: (dim) => multiCap(getStylingDimensionLimit(dim as StylingDimension)),
})

/** The multi-dimensional Subject builders, rendered in order in the Structured tab. */
export const SUBJECT_MULTIDIM: ReadonlyArray<MultiDimPickerSpec> = [
  PERSON_PICKER,
  STYLING_PICKER,
]

// ── Props / elements (single-pick) ────────────────────────────────────────────

/** A single-pick prop pill config (catalog + its ordered category sub-groups). */
function propPill(
  key: string,
  label: string,
  catalog: ReadonlyArray<LookCatalogEntry>,
  getLabel: (id?: string | null) => string,
  order: ReadonlyArray<string>,
  labels: Record<string, string>,
  categoryKey: "category" | "subcategory",
): PillConfig {
  return {
    key,
    label,
    catalog,
    getLabel,
    searchPlaceholder: `Search ${label.toLowerCase()}…`,
    categories: {
      order,
      labels,
      categoryOf: (e) =>
        (e as unknown as Record<string, string | undefined>)[categoryKey] ?? "",
    },
  }
}

/** Animal ships no standalone prompt-hint/term helper → use the unified
 *  dispatcher, which reads the verbosity off the node data's `hintMode` exactly
 *  as the platform's own animal node does (byte-identical to the app's
 *  "featuring a …" clause in full mode, the bare species term in compact). */
function animalFragment(
  id: string | undefined | null,
  mode: PickerHintMode,
): string {
  if (!id) return ""
  return getParameterPromptHint({
    id: "animal",
    type: "animal",
    data: { animal: id, hintMode: mode },
  })
}

/**
 * The Animal single-pick — the full platform `ANIMALS` catalog grouped by
 * subcategory (cats/dogs/wild/birds/…/mythical). Exported standalone because
 * the CREATURE creator's structured mode reuses it as the species picker
 * (same pill, same hint fold) alongside its Subject-tab home below.
 */
export const ANIMAL_PICKER: PropPicker = {
  pill: propPill(
    "animal",
    "Animal",
    ANIMALS,
    getAnimalLabel,
    ANIMAL_SUBCATEGORY_ORDER,
    ANIMAL_SUBCATEGORY_LABELS,
    "subcategory",
  ),
  getHint: (id) => animalFragment(id, "full"),
  getTerm: (id) => animalFragment(id, "compact"),
}

/** The scene "props / extras" — single-pick catalogs surfaced under the Subject tab. */
export const PROP_PICKERS: ReadonlyArray<PropPicker> = [
  {
    pill: propPill(
      "heldProp",
      "Held Prop",
      HELD_PROPS,
      getHeldPropLabel,
      HELD_PROP_CATEGORY_ORDER,
      HELD_PROP_CATEGORY_LABELS,
      "category",
    ),
    getHint: getHeldPropPromptHint,
    getTerm: getHeldPropTerm,
  },
  {
    pill: propPill(
      "material",
      "Material",
      MATERIALS,
      getMaterialLabel,
      MATERIAL_CATEGORY_ORDER,
      MATERIAL_CATEGORY_LABELS,
      "category",
    ),
    getHint: getMaterialPromptHint,
    getTerm: getMaterialTerm,
  },
  ANIMAL_PICKER,
]

// ── Fold ──────────────────────────────────────────────────────────────────────

/** First string id of a selection value (props are single-pick → ignore arrays). */
function asId(v: string | ReadonlyArray<string> | undefined): string | undefined {
  return typeof v === "string" ? v : undefined
}

/** Prompt clauses for ONLY the Person dimensions of a selection (the test
 *  contract). `mode` is REQUIRED — see the module note on verbosity. */
export function personHints(
  value: SubjectSelection,
  mode: PickerHintMode,
): string[] {
  return PERSON_PICKER.buildHints(value, mode)
}

/**
 * Prompt clauses for the WHOLE Subject selection — Person + Styling + props,
 * each builder reading its own disjoint fields from the shared map, all
 * resolved at the SAME verbosity (a half-compact subject would read as two
 * voices).
 *
 * THE CLIENT FOLD, AND ONLY FOR ENTITY CREATION (S6). The generate submits and
 * all three "will inject into prompt" previews now send picker IDS on the
 * platform's `subject` channel and render the server's own fold
 * (`subject`), so this survives for exactly one surface: the
 * Character/Creature creators, which fold into `seedPrompt`/`description`
 * against the ENTITY generate routes rather than `/v1/generate-image`.
 * TODO(nodaro): extend the `subject` channel to the entity generate routes and
 * this goes with it (the plan's S6.7, deliberately out of the S6 leg).
 */
export function subjectCreationHints(
  value: SubjectSelection,
  mode: PickerHintMode,
): string[] {
  return [
    ...PERSON_PICKER.buildHints(value, mode),
    ...STYLING_PICKER.buildHints(value, mode),
    ...PROP_PICKERS.map((p) =>
      propFragment(p, asId(value[p.pill.key]), mode),
    ).filter((h) => h.length > 0),
  ]
}
