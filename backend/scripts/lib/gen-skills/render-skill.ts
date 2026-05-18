/**
 * Renders the body of each auto-gen block from parsed NODE_DEFINITIONS +
 * *Data interface shapes + MCP tool schemas. Pure functions; marker
 * substitution is handled by marker-blocks.ts.
 */
import type {
  NodeDef,
  InterfaceShape,
} from "./parse-node-definitions.js"
import type { CapturedSchema } from "./capture-mcp-schemas.js"

export function renderNodeDataShapeBlock(
  def: NodeDef,
  shape: InterfaceShape | undefined,
): string {
  const lines: string[] = []
  lines.push(`**Type:** \`${def.type}\``)
  lines.push(`**Category:** ${def.category}`)
  lines.push(`**Credit cost:** ${def.creditCost}`)
  lines.push(
    `**Inputs (target handles):** ${
      def.inputs.length
        ? def.inputs.map((h) => `\`${h}\``).join(", ")
        : "(none)"
    }`,
  )
  lines.push(
    `**Outputs (source handles):** ${
      def.outputs.length
        ? def.outputs.map((h) => `\`${h}\``).join(", ")
        : "(none)"
    }`,
  )
  lines.push("")

  if (shape) {
    const required = shape.fields.filter((f) => !f.optional)
    const optional = shape.fields.filter((f) => f.optional)
    if (required.length) {
      lines.push("**Required data fields:**")
      for (const f of required) lines.push(`- \`${f.name}: ${f.type}\``)
      lines.push("")
    }
    if (optional.length) {
      lines.push("**Optional data fields:**")
      for (const f of optional) lines.push(`- \`${f.name}?: ${f.type}\``)
      lines.push("")
    }
  }

  lines.push("**Default data:**")
  lines.push("```json")
  lines.push(JSON.stringify(def.defaultData, null, 2))
  lines.push("```")
  return lines.join("\n")
}

export function renderMcpCallBlock(
  toolName: string,
  schema: CapturedSchema | undefined,
): string {
  if (!schema) return ""
  const lines: string[] = []
  lines.push(`**MCP tool:** \`${toolName}\``)
  lines.push("")
  const fieldNames = Object.keys(schema.inputSchema)
  if (fieldNames.length) {
    lines.push("**Input parameters:**")
    for (const name of fieldNames) lines.push(`- \`${name}\``)
  } else {
    lines.push("**Input parameters:** (none)")
  }
  return lines.join("\n")
}

export function renderExampleBlock(def: NodeDef): string {
  const example = {
    id: `${def.type}-1`,
    type: def.type,
    position: { x: 0, y: 0 },
    data: def.defaultData,
  }
  return [
    "## Worked example",
    "",
    "```json",
    JSON.stringify(example, null, 2),
    "```",
  ].join("\n")
}

export function renderWorkflowEditorCatalog(defs: NodeDef[]): string {
  const lines: string[] = []
  lines.push("## Available node types")
  lines.push("")
  lines.push(
    "Call `get_node_skill(<type>)` for the full schema of any node type:",
  )
  lines.push("")
  const sorted = [...defs].sort((a, b) => a.type.localeCompare(b.type))
  for (const d of sorted) lines.push(`- \`${d.type}\` — ${d.label}`)
  return lines.join("\n")
}
