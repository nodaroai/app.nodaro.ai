import { z } from "zod"
import {
  PEOPLE,
  PERSON_DIMENSION_ORDER,
  PERSON_DIMENSION_LABELS,
  PERSON_FIELD_BY_DIMENSION,
  getPersonDimensionLimit,
} from "./person.js"
import {
  STYLINGS,
  STYLING_DIMENSION_ORDER,
  STYLING_DIMENSION_LABELS,
  STYLING_FIELD_BY_DIMENSION,
  getStylingDimensionLimit,
} from "./styling.js"
import {
  FRAMINGS,
  FRAMING_CATEGORY_ORDER,
  FRAMING_CATEGORY_LABELS,
  FRAMING_FIELD_BY_CATEGORY,
  getFramingCategoryLimit,
} from "./framing.js"
import { LENSES } from "./lens.js"
import { CAMERA_FORMATS } from "./camera-format.js"

// ─── Descriptor model ────────────────────────────────────────────────────────

/** A catalog entry as the analyzer consumes it. Flat catalogs lack
 *  dimension/category; discriminated catalogs carry exactly one. */
interface AnalyzerEntry {
  readonly id: string
  readonly label: string
  readonly description: string
  readonly dimension?: string
  readonly category?: string
}

export type PickerApplyMode = "override" | "overwrite-detected" | "fill-empty"
type ApplyCleanup = (patch: Record<string, unknown>, mode: PickerApplyMode) => void

/** Describes how to build an analyzer spec for one picker type. Three shapes:
 *  - "discriminated": ONE catalog whose entries carry `dimension` or `category`;
 *    `order`/`fieldByKey`/`labels` translate keys → fields/labels; `limitFn`
 *    gives the per-key cardinality.
 *  - "flat": a single-value catalog (lens, camera-format) → one limit-1
 *    dimension whose key == the node-data field. */
export type PickerAnalyzerDescriptor =
  | {
      readonly kind: "discriminated"
      readonly toolName: string
      readonly discriminator: "dimension" | "category"
      readonly order: ReadonlyArray<string>
      readonly fieldByKey: Readonly<Record<string, string>>
      readonly labels: Readonly<Record<string, string>>
      readonly entries: ReadonlyArray<AnalyzerEntry>
      readonly limitFn: (key: string) => number
      readonly excludedIds?: ReadonlySet<string>
      readonly cleanup?: ApplyCleanup
    }
  | {
      readonly kind: "flat"
      readonly toolName: string
      readonly field: string
      readonly label: string
      readonly entries: ReadonlyArray<AnalyzerEntry>
    }

// ─── Registry (person only in Task 2; +4 in Task 3) ─────────────────────────

const PERSON_EXCLUDED = new Set<string>(["age-custom"])

const personCleanup: ApplyCleanup = (patch, mode) => {
  if (mode === "override") {
    patch.customAge = undefined
    patch.lips = undefined
  } else if ("age" in patch && patch.age !== "age-custom") {
    patch.customAge = undefined
  }
}

export const PICKER_ANALYZER_REGISTRY = {
  person: {
    kind: "discriminated",
    toolName: "emit_person",
    discriminator: "dimension",
    order: PERSON_DIMENSION_ORDER as ReadonlyArray<string>,
    fieldByKey: PERSON_FIELD_BY_DIMENSION as Readonly<Record<string, string>>,
    labels: PERSON_DIMENSION_LABELS as Readonly<Record<string, string>>,
    entries: PEOPLE as ReadonlyArray<AnalyzerEntry>,
    limitFn: (k) => getPersonDimensionLimit(k as never),
    excludedIds: PERSON_EXCLUDED,
    cleanup: personCleanup,
  },
  styling: {
    kind: "discriminated",
    toolName: "emit_styling",
    discriminator: "dimension",
    order: STYLING_DIMENSION_ORDER as ReadonlyArray<string>,
    fieldByKey: STYLING_FIELD_BY_DIMENSION as Readonly<Record<string, string>>,
    labels: STYLING_DIMENSION_LABELS as Readonly<Record<string, string>>,
    entries: STYLINGS as ReadonlyArray<AnalyzerEntry>,
    limitFn: (k) => getStylingDimensionLimit(k as never),
  },
  framing: {
    kind: "discriminated",
    toolName: "emit_framing",
    discriminator: "category",
    order: FRAMING_CATEGORY_ORDER as ReadonlyArray<string>,
    fieldByKey: FRAMING_FIELD_BY_CATEGORY as Readonly<Record<string, string>>,
    labels: FRAMING_CATEGORY_LABELS as Readonly<Record<string, string>>,
    entries: FRAMINGS as ReadonlyArray<AnalyzerEntry>,
    limitFn: (k) => getFramingCategoryLimit(k as never),
  },
  lens: {
    kind: "flat",
    toolName: "emit_lens",
    field: "lens",
    label: "Lens",
    entries: LENSES as ReadonlyArray<AnalyzerEntry>,
  },
  "camera-format": {
    kind: "flat",
    toolName: "emit_camera_format",
    field: "cameraFormat",
    label: "Camera / Film Stock",
    entries: CAMERA_FORMATS as ReadonlyArray<AnalyzerEntry>,
  },
} satisfies Record<string, PickerAnalyzerDescriptor>

export type PickerType = keyof typeof PICKER_ANALYZER_REGISTRY
export const PICKER_TYPES = Object.keys(PICKER_ANALYZER_REGISTRY) as PickerType[]
export const ANALYZABLE_PICKER_TYPES: ReadonlySet<string> = new Set(PICKER_TYPES)
export function isAnalyzablePicker(t: string): t is PickerType {
  return ANALYZABLE_PICKER_TYPES.has(t)
}

// ─── Spec model ──────────────────────────────────────────────────────────────

export interface PickerDimensionSpec {
  /** Catalog dimension id, e.g. "hair-color". Also the JSON key in the emitted pickerJson. */
  readonly dimension: string
  /** Target node-data field, e.g. "hairColor". */
  readonly field: string
  /** Human label/description, for the system-prompt legend. */
  readonly label: string
  /** 1 = single select; 2/3 = array with maxItems. */
  readonly limit: number
  /** Allowed catalog entry ids (the forced enum). */
  readonly entryIds: ReadonlyArray<string>
  /** id → human label/description, for the system-prompt legend. */
  readonly legend: ReadonlyArray<{ id: string; label: string; description: string }>
}

export interface PickerAnalyzerSpec {
  readonly pickerType: PickerType
  readonly toolName: string
  readonly dimensions: ReadonlyArray<PickerDimensionSpec>
  readonly cleanup?: ApplyCleanup
}

export function buildPickerAnalyzerSpec(pickerType: PickerType): PickerAnalyzerSpec {
  const d = PICKER_ANALYZER_REGISTRY[pickerType] as PickerAnalyzerDescriptor
  if (d.kind === "flat") {
    return {
      pickerType,
      toolName: d.toolName,
      dimensions: [
        {
          dimension: d.field,
          field: d.field,
          label: d.label,
          limit: 1,
          entryIds: d.entries.map((e) => e.id),
          legend: d.entries.map((e) => ({ id: e.id, label: e.label, description: e.description })),
        },
      ],
    }
  }
  const dimensions: PickerDimensionSpec[] = d.order.map((key) => {
    const entries = d.entries.filter(
      (e) =>
        (d.discriminator === "dimension" ? e.dimension : e.category) === key &&
        !(d.excludedIds?.has(e.id)),
    )
    return {
      dimension: key,
      field: d.fieldByKey[key],
      label: d.labels[key] ?? key,
      limit: d.limitFn(key),
      entryIds: entries.map((e) => e.id),
      legend: entries.map((e) => ({ id: e.id, label: e.label, description: e.description })),
    }
  })
  return { pickerType, toolName: d.toolName, dimensions, cleanup: d.cleanup }
}

// ─── Zod schema / legend / analyzer cache (unchanged logic) ──────────────────

/** Zod object: each dimension is an optional enum (single) or capped enum array
 *  (multi). `.strict()` blocks unknown keys. Mirrors the field cardinality. */
export function buildPickerZodSchema(
  spec: PickerAnalyzerSpec,
): z.ZodType<Record<string, string | string[]>, z.ZodTypeDef, unknown> {
  const shape: Record<string, z.ZodTypeAny> = {}
  for (const d of spec.dimensions) {
    const ids = d.entryIds as unknown as [string, ...string[]]
    const enumZ = z.enum(ids)
    shape[d.dimension] = d.limit > 1 ? z.array(enumZ).max(d.limit).optional() : enumZ.optional()
  }
  // dynamic shape → Zod can't infer the narrowed output type; runtime-validated by picker-analyzer-registry.test.ts
  return z.object(shape).strict() as unknown as z.ZodType<
    Record<string, string | string[]>,
    z.ZodTypeDef,
    unknown
  >
}

export interface PickerAnalyzer {
  readonly spec: PickerAnalyzerSpec
  readonly schema: z.ZodType<Record<string, string | string[]>, z.ZodTypeDef, unknown>
  readonly legend: string
}

const ANALYZER_CACHE = new Map<PickerType, PickerAnalyzer>()

/** Memoized analyzer build: spec → Zod schema → legend, computed once per
 *  picker type and cached at module level. The three artifacts are catalog-
 *  derived and stable, so the per-request route handler can reuse them instead
 *  of rebuilding all three on every analysis call. */
export function getPickerAnalyzer(pickerType: PickerType): PickerAnalyzer {
  const cached = ANALYZER_CACHE.get(pickerType)
  if (cached) return cached
  const spec = buildPickerAnalyzerSpec(pickerType)
  const analyzer: PickerAnalyzer = {
    spec,
    schema: buildPickerZodSchema(spec),
    legend: buildPickerLegend(spec),
  }
  ANALYZER_CACHE.set(pickerType, analyzer)
  return analyzer
}

// ─── Gaps + multi-picker union spec ──────────────────────────────────────────

export const GAPS_SCHEMA = z
  .object({
    missingItems: z
      .array(
        z.object({
          picker: z.string(),
          dimension: z.string(),
          observed: z.string().max(120),
        }),
      )
      .max(8)
      .default([]),
    missingCategories: z
      .array(
        z.object({
          picker: z.string(),
          suggestedDimension: z.string(),
          observed: z.string().max(120),
        }),
      )
      .max(8)
      .default([]),
  })
  .default({ missingItems: [], missingCategories: [] })

export interface PickerGaps {
  readonly missingItems: ReadonlyArray<{ picker: string; dimension: string; observed: string }>
  readonly missingCategories: ReadonlyArray<{
    picker: string
    suggestedDimension: string
    observed: string
  }>
}

export interface MultiPickerAnalyzerSpec {
  readonly schema: z.ZodType<Record<string, unknown>, z.ZodTypeDef, unknown>
  readonly toolName: string
  readonly legend: string
}

const MULTI_CACHE = new Map<string, MultiPickerAnalyzerSpec>()

/** Build ONE forced-tool schema spanning the given pickers (each section
 *  optional so an omitted picker doesn't trigger a validation retry) plus the
 *  capped `gaps` sidecar. Memoized by the sorted picker-set key. */
export function buildMultiPickerAnalyzerSpec(types: ReadonlyArray<PickerType>): MultiPickerAnalyzerSpec {
  const sorted = [...new Set(types)].sort()
  const key = sorted.join(",")
  const cached = MULTI_CACHE.get(key)
  if (cached) return cached

  const shape: Record<string, z.ZodTypeAny> = {}
  const legendParts: string[] = []
  for (const t of sorted) {
    const spec = buildPickerAnalyzerSpec(t)
    shape[t] = buildPickerZodSchema(spec).optional()
    legendParts.push(`# ${t.toUpperCase()} PICKER\n${buildPickerLegend(spec)}`)
  }
  shape.gaps = GAPS_SCHEMA
  const result: MultiPickerAnalyzerSpec = {
    schema: z.object(shape).strict() as unknown as MultiPickerAnalyzerSpec["schema"],
    toolName: "emit_pickers",
    legend: legendParts.join("\n\n"),
  }
  MULTI_CACHE.set(key, result)
  return result
}

/** Human-readable legend appended to the system prompt so enum ids are meaningful. */
export function buildPickerLegend(spec: PickerAnalyzerSpec): string {
  const lines: string[] = []
  for (const d of spec.dimensions) {
    const cap = d.limit > 1 ? `up to ${d.limit}` : "one"
    lines.push(`## ${d.label} (key: "${d.dimension}", choose ${cap})`)
    for (const e of d.legend) {
      lines.push(`- ${e.id}: ${e.label}${e.description ? ` — ${e.description}` : ""}`)
    }
  }
  return lines.join("\n")
}

// ─── applyPickerJson (cleanup now via spec, not hardcoded person) ────────────

function isEmptyValue(v: unknown): boolean {
  if (v === undefined || v === null) return true
  if (Array.isArray(v)) return v.length === 0
  return String(v).length === 0
}

function coerce(value: unknown, limit: number): string | string[] {
  const arr = Array.isArray(value) ? value.map(String) : [String(value)]
  return limit > 1 ? arr.slice(0, limit) : arr[0]
}

/**
 * Produces the patch to merge into the picker node's data. Touches ONLY the
 * dimension fields (never label/preText/postText/maxItemsPerRow). `override`
 * also clears undetected dimension fields, and runs the picker's `cleanup`
 * (e.g. person resets customAge + clears the deprecated `lips` field).
 */
export function applyPickerJson(
  current: Record<string, unknown>,
  pickerJson: Record<string, unknown>,
  mode: PickerApplyMode,
  spec: PickerAnalyzerSpec,
): Record<string, unknown> {
  const patch: Record<string, unknown> = {}
  for (const d of spec.dimensions) {
    const incoming = pickerJson[d.dimension]
    const present = !isEmptyValue(incoming)
    if (mode === "override") {
      patch[d.field] = present ? coerce(incoming, d.limit) : undefined
    } else if (mode === "overwrite-detected") {
      if (present) patch[d.field] = coerce(incoming, d.limit)
    } else {
      if (present && isEmptyValue(current[d.field])) patch[d.field] = coerce(incoming, d.limit)
    }
  }
  spec.cleanup?.(patch, mode)
  return patch
}

// ─── Edge-derived fan-out selection (shared by frontend + backend) ───────────

/** The analyzable picker node types wired to a producer's `picker-json` output
 *  (deduped). The ONE definition of edge-derived selection; the frontend
 *  execute path and the backend orchestrator both call this so they can't
 *  drift. Accepts minimal structural node/edge shapes so both layers' richer
 *  types satisfy it. */
export function pickerFanoutTargets(
  producerId: string,
  edges: ReadonlyArray<{ source: string; target: string; sourceHandle?: string | null }>,
  nodes: ReadonlyArray<{ id: string; type?: string }>,
): PickerType[] {
  const out = new Set<string>()
  for (const e of edges) {
    if (e.source !== producerId || e.sourceHandle !== "picker-json") continue
    const t = nodes.find((n) => n.id === e.target)?.type
    if (t && isAnalyzablePicker(t)) out.add(t)
  }
  return [...out] as PickerType[]
}
