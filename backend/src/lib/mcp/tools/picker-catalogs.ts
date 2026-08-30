/**
 * `get_picker_catalog` — discovery for parameter-picker value catalogs.
 *
 * No node_type → directory of every picker (nodeType/label/kind/field/count).
 * node_type → that picker's catalog of valid ids (compact by default — which
 * already carries each id's short professional `term` for compact prompt
 * injection; `detail: "full"` adds description + the exact prompt fragment each
 * id injects; `category`/`field` slice the large catalogs).
 *
 * Read-only, ungated — pure static reference (same posture as get_node_skill /
 * start_workflow_editor). All data comes from @nodaro/shared's PICKER_CATALOGS,
 * the single source of truth mirrored from the editor picker registry.
 */
import { z } from "zod"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import type { McpSession } from "../session.js"
import { getPickerCatalog, summarizePickerCatalogs, projectPickerCatalog } from "@nodaro/prompts"

export const GET_PICKER_CATALOG_TOOL_DESCRIPTION =
  "Returns the catalog of valid values for a parameter-picker node type " +
  "(setting, mood, person, action-fx, lens, …). Call with no node_type to " +
  "list every picker and its option count; call with a kebab-case node_type " +
  "(from start_workflow_editor's catalog) to get its valid ids, labels, each " +
  "id's short professional `term` (what to write into a prompt when you want " +
  "a compact instruction), the target data field(s), and — with " +
  "detail='full' — each id's full prompt fragment. Use this before writing a " +
  "picker node's value field in update_workflow_json so you set a real " +
  "catalog id, not a guess. Read-only, idempotent, free of side effects."

const NODE_TYPE_RE = /^[a-z0-9][a-z0-9-]*$/

export function registerPickerCatalogs(server: McpServer, _session: McpSession): void {
  server.registerTool(
    "get_picker_catalog",
    {
      title: "Get Picker Catalog",
      description: GET_PICKER_CATALOG_TOOL_DESCRIPTION,
      inputSchema: {
        node_type: z
          .string()
          .min(1)
          .max(64)
          .regex(NODE_TYPE_RE, "must be kebab-case (lowercase a-z, digits, hyphens)")
          .optional()
          .describe("Picker node type, e.g. 'setting'. Omit to list all pickers."),
        detail: z
          .enum(["compact", "full"])
          .optional()
          .describe(
            "compact (default): id, label, category, term, icon. full: additionally includes description + promptHint (the prompt fragment each id injects). " +
              "`term` rides at BOTH levels: it is the short professional phrase to inject in compact hint mode (\"whip pan left\"), where `label` is display-only and `promptHint` is the full mechanism sentence. Empty for a no-op (\"auto\"/\"none\") entry that injects nothing.",
          ),
        category: z
          .string()
          .optional()
          .describe("Single-dim pickers: filter options to one category."),
        field: z
          .string()
          .optional()
          .describe("Return only this dimension field. Multi-dim pickers (person/styling/framing), and single-dim pickers with secondary parameters (transition and character-fx: position/duration/intensity)."),
      },
      annotations: { readOnlyHint: true, destructiveHint: false, openWorldHint: false },
    },
    async (args: {
      node_type?: string
      detail?: "compact" | "full"
      category?: string
      field?: string
    }) => {
      if (!args.node_type) {
        return {
          content: [
            { type: "text" as const, text: JSON.stringify({ pickers: summarizePickerCatalogs() }, null, 2) },
          ],
        }
      }
      const catalog = getPickerCatalog(args.node_type)
      if (!catalog) {
        const valid = summarizePickerCatalogs()
          .map((s) => s.nodeType)
          .join(", ")
        return {
          isError: true as const,
          content: [
            {
              type: "text" as const,
              text:
                `No picker catalog for node_type='${args.node_type}'. ` +
                `Valid picker types: ${valid}.`,
            },
          ],
        }
      }
      const projected = projectPickerCatalog(catalog, {
        detail: args.detail,
        category: args.category,
        field: args.field,
      })
      return { content: [{ type: "text" as const, text: JSON.stringify(projected, null, 2) }] }
    },
  )
}
