/**
 * The use-case node rows (decided 2026-10-18): which node type runs which
 * graph builder (a USE_CASE_SPECS key), its English label and its input pips:
 * the node units' rows (execution.kind "use-case", unit-use-cases.generated.ts),
 * held to USE_CASE_NODE_TYPES of @nodaro/shared. Imports no builder, so a builder may import it (to read its
 * own type by its builder key) without a cycle. Pure.
 */
import { USE_CASE_NODE_TYPES, type UseCaseNodeType } from "@nodaro/shared/nodes"
import { UNIT_USE_CASE_ROWS } from "./unit-use-cases.generated"
import type { UseCaseInputHandle } from "./use-case-registry"

export interface UseCaseRow {
  readonly type: UseCaseNodeType
  /** Its graph builder: a USE_CASE_SPECS key. */
  readonly builder: string
  /** English label (server messages, MCP); the editor shows its own localized label. */
  readonly label: string
  readonly inputs: readonly UseCaseInputHandle[]
}

/**
 * The units' rows, in `types` order, held to `types` (USE_CASE_NODE_TYPES).
 * Throws when a type has two rows, a builder is named by two rows (so a
 * builder finds exactly one type), or the rows and `types` disagree. Exported
 * for its test; USE_CASE_ROWS is its one use.
 */
export function composeUseCaseRows(
  units: readonly UseCaseRow[],
  types: readonly string[],
): readonly UseCaseRow[] {
  const byType = new Map(units.map((r) => [r.type as string, r]))
  if (byType.size !== units.length) throw new Error("use-case rows: a type has more than one row — a type lives in one place")
  if (new Set(units.map((r) => r.builder)).size !== units.length) throw new Error("use-case rows: a builder is named by more than one node — one use-case spec builds one node type")
  const missing = types.filter((t) => !byType.has(t))
  const extra = units.filter((r) => !types.includes(r.type))
  if (missing.length || extra.length) {
    throw new Error(`use-case rows disagree with USE_CASE_NODE_TYPES: missing ${missing.join(", ") || "none"}, extra ${extra.map((r) => r.type).join(", ") || "none"}`)
  }
  return types.map((t) => byType.get(t)!)
}

/** Every use-case node's row, in USE_CASE_NODE_TYPES order. Throws at load when the two disagree. */
export const USE_CASE_ROWS: readonly UseCaseRow[] = composeUseCaseRows(
  UNIT_USE_CASE_ROWS as readonly UseCaseRow[],
  USE_CASE_NODE_TYPES,
)

export function usecaseRowOf(type: UseCaseNodeType): UseCaseRow {
  return USE_CASE_ROWS.find((r) => r.type === type)!
}

/** The use-case type whose builder is `builder`. Throws when no node declares it — read at call time, never at module load. */
export function usecaseTypeOfBuilder(builder: string): UseCaseNodeType {
  const row = USE_CASE_ROWS.find((r) => r.builder === builder)
  if (!row) throw new Error(`no use-case node declares builder "${builder}" (unit.json execution.builder)`)
  return row.type
}
