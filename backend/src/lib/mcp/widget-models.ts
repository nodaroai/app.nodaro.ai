// backend/src/lib/mcp/widget-models.ts — the `model` an MCP verb's result
// widget shows when the verb dispatches one node type's job (gif_to_video →
// "gif-to-video"): the legacy literal the verb passes ∪ the node unit that
// declares the verb in its unit.json (`mcp.widgetModelFor`, §5.8 B;
// tools/units/README.md). Keyed by the MCP tool name, so a verb whose node is
// a unit names no type id (G2): the value is always the unit's own type.
// @registry-enumerates widgetModelOf answers from every node unit's mcp.widgetModelFor
import type { UnitDescriptor } from "../../nodes/kit.js"
import { UNIT_NODE_DESCRIPTORS } from "../unit-descriptors.js"

/** MCP tool name → the unit type its widget names, over `units` (null-prototype). Throws when two units claim one tool. */
export function unitWidgetModels(units: ReadonlyArray<UnitDescriptor>): Readonly<Record<string, string>> {
  const out: Record<string, string> = Object.create(null)
  for (const u of units) {
    for (const tool of u.mcp?.widgetModelFor ?? []) {
      if (tool in out && out[tool] !== u.type) {
        throw new Error(`MCP widget model: "${tool}" is claimed by both ${out[tool]} and ${u.type} — an MCP tool's widget names one node`)
      }
      out[tool] = u.type
    }
  }
  return out
}

/**
 * The widget model of `tool`: `legacy` (the literal a legacy verb passes) or
 * the unit that declares the tool — exactly one of the two. Both, or neither,
 * throws: a type lives in one place, and a verb without a model is a
 * migration that dropped its literal without declaring the tool in unit.json.
 */
export function composeWidgetModel(tool: string, legacy: string | undefined, byTool: Readonly<Record<string, string>>): string {
  const unit = byTool[tool]
  if (unit !== undefined && legacy !== undefined) {
    throw new Error(`MCP widget model of "${tool}": the verb passes the legacy "${legacy}" but node unit ${unit} declares the tool (mcp.widgetModelFor) — drop the verb's literal`)
  }
  const model = unit ?? legacy
  if (model === undefined) {
    throw new Error(`MCP widget model of "${tool}": no legacy literal and no node unit declares it in mcp.widgetModelFor`)
  }
  return model
}

let unitTable: Readonly<Record<string, string>> | undefined

/**
 * The widget model of `tool`, for a verb to resolve once while it registers
 * (never inside its handler, so a bad declaration fails at registration — in
 * every test that builds the MCP server — not mid-call for a user). A legacy
 * verb passes its literal; a verb whose node is a unit passes none.
 */
export function widgetModelOf(tool: string, legacy?: string): string {
  unitTable ??= unitWidgetModels(UNIT_NODE_DESCRIPTORS)
  return composeWidgetModel(tool, legacy, unitTable)
}
