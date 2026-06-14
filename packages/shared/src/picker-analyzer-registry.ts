import { z } from "zod"
import {
  PEOPLE,
  PERSON_DIMENSION_ORDER,
  PERSON_DIMENSION_LABELS,
  PERSON_FIELD_BY_DIMENSION,
  getPersonDimensionLimit,
} from "./person.js"

export type PickerType = "person"

export interface PickerDimensionSpec {
  /** Catalog dimension id, e.g. "hair-color". Also the JSON key in the emitted pickerJson. */
  readonly dimension: string
  /** Target node-data field, e.g. "hairColor". */
  readonly field: string
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
}

/** Ids excluded from the analyzer enum because they require a paired value the
 *  model cannot supply (age-custom needs a separate customAge number). */
const EXCLUDED_ENTRY_IDS = new Set<string>(["age-custom"])

export function buildPickerAnalyzerSpec(pickerType: PickerType): PickerAnalyzerSpec {
  if (pickerType !== "person") {
    throw new Error(`Unknown picker type: ${pickerType}`)
  }
  const dimensions: PickerDimensionSpec[] = PERSON_DIMENSION_ORDER.map((dimension) => {
    const entries = PEOPLE.filter(
      (p) => p.dimension === dimension && !EXCLUDED_ENTRY_IDS.has(p.id),
    )
    return {
      dimension,
      field: PERSON_FIELD_BY_DIMENSION[dimension],
      limit: getPersonDimensionLimit(dimension),
      entryIds: entries.map((p) => p.id),
      legend: entries.map((p) => ({ id: p.id, label: p.label, description: p.description })),
    }
  })
  return { pickerType, toolName: "emit_person", dimensions }
}

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

/** Human-readable legend appended to the system prompt so enum ids are meaningful. */
export function buildPickerLegend(spec: PickerAnalyzerSpec): string {
  const lines: string[] = []
  for (const d of spec.dimensions) {
    const label = PERSON_DIMENSION_LABELS[d.dimension as keyof typeof PERSON_DIMENSION_LABELS] ?? d.dimension
    const cap = d.limit > 1 ? `up to ${d.limit}` : "one"
    lines.push(`## ${label} (key: "${d.dimension}", choose ${cap})`)
    for (const e of d.legend) {
      lines.push(`- ${e.id}: ${e.label}${e.description ? ` — ${e.description}` : ""}`)
    }
  }
  return lines.join("\n")
}

export type PickerApplyMode = "override" | "overwrite-detected" | "fill-empty"

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
 * also clears undetected dimension fields, resets customAge, and clears the
 * deprecated `lips` field.
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
  if (mode === "override") {
    patch.customAge = undefined
    patch.lips = undefined
  } else if ("age" in patch && patch.age !== "age-custom") {
    patch.customAge = undefined
  }
  return patch
}
