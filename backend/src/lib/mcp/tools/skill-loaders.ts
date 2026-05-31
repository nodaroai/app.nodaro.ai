/**
 * Skill-loader MCP tools — return per-node and workflow-editor skill
 * content from backend/skills/ markdown files.
 *
 * `start_workflow_editor` — returns workflow-editor.md (general workflow
 * JSON/edges/handles teaching content).
 * `get_node_skill(node_type)` — returns nodes/<node_type>.md (per-node
 * schema, defaults, MCP call shape, gotchas, worked examples).
 *
 * Both tools are read-only, no scope gate, idempotent — same posture as
 * `start_film_director`. Universal discoverability is the point.
 *
 * Loading strategy: at module load, glob the nodes/ directory and read
 * workflow-editor.md into memory. Production: `backend/skills/` is
 * whitelisted in `.dockerignore` AND explicitly copied into the runner
 * stage by `Dockerfile`, so disk reads work in both development and
 * Railway production. The `WORKFLOW_EDITOR_FALLBACK_CONTENT` constant is
 * defense-in-depth for the disk-unavailable case; `get_node_skill` falls
 * back to an error response listing the (possibly empty) catalog when its
 * file is unreadable.
 */
import { readFileSync, readdirSync, existsSync } from "node:fs"
import { fileURLToPath } from "node:url"
import { dirname, resolve, basename } from "node:path"
import { z } from "zod"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import type { McpSession } from "../session.js"

/**
 * Embedded fallback for workflow-editor.md. Deliberately compact — the full
 * file is on disk in production via the .dockerignore whitelist. This is an
 * emergency-only safety net (the on-disk file is ~5KB; this is a ~30-line
 * subset with the bare essentials so Claude can still produce valid JSON
 * even if disk I/O fails).
 *
 * Tests in `__tests__/skill-loaders.test.ts` assert:
 *   - length > 200 chars
 *   - contains "Nodaro Workflow Editor"
 *   - contains "get_node_skill"
 */
export const WORKFLOW_EDITOR_FALLBACK_CONTENT = `---
generated_at: 2026-05-18T00:00:00Z
generated_from: hand-written-fallback
---

# Nodaro Workflow Editor — General Patterns

Call this skill BEFORE building or editing any Nodaro workflow. The on-disk file at backend/skills/workflow-editor.md was not readable — this is an embedded fallback with the core guidance only.

## Workflow JSON shape

\`\`\`json
{
  "nodes": [{ "id": "...", "type": "...", "position": { "x": 0, "y": 0 }, "data": {} }],
  "edges": [{ "id": "...", "source": "...", "sourceHandle": "...", "target": "...", "targetHandle": "..." }]
}
\`\`\`

Each node needs a unique \`id\`, a registered \`type\`, a \`position\` (x/y in pixels), and a type-specific \`data\` payload. Wire nodes left-to-right with edges; an edge's \`sourceHandle\` and \`targetHandle\` MUST reference handle ids that exist on the source/target node types.

## update_workflow_json contract

\`update_workflow_json(workflow_id, workflow, expected_updated_at?)\` overwrites the workflow's full graph. Always merge new nodes into the existing graph rather than replacing it. After each approved stage, call it once to attach that stage's new nodes — the user watches their canvas fill up during conversation.

## Per-node schema

Call \`get_node_skill(<type>)\` for the exact required + optional data fields, asset-URL result-field name, and a worked example for any specific node type. Available kebab-case types include: text-prompt, list, generate-image, image-to-video, generate-music, trim-video, combine-videos, merge-video-audio.
`

/**
 * Resolve `backend/skills/` regardless of whether this module is running
 * from source (tsx watch → `backend/src/lib/mcp/tools/skill-loaders.ts`)
 * or compiled (tsc out → `backend/dist/lib/mcp/tools/skill-loaders.js`).
 *
 * Both source and compiled paths sit 4 levels deep under `backend/`
 * (src|dist → lib → mcp → tools), so `../../../..` lands on `backend/`
 * and we append `skills/` to reach the markdown directory.
 */
function resolveSkillsDir(): string {
  const here = dirname(fileURLToPath(import.meta.url))
  return resolve(here, "../../../..", "skills")
}

function loadWorkflowEditorContent(): string {
  try {
    const path = resolve(resolveSkillsDir(), "workflow-editor.md")
    const content = readFileSync(path, "utf-8")
    // Suspiciously short — treat as a damaged file and use the embedded copy.
    if (content.length < 200) return WORKFLOW_EDITOR_FALLBACK_CONTENT
    return content
  } catch {
    return WORKFLOW_EDITOR_FALLBACK_CONTENT
  }
}

/**
 * Strict kebab-case validator for `node_type` input. The Zod schema enforces
 * this at the boundary; this constant is also used by `loadNodeSkillContent`
 * for defense-in-depth so the loader never trusts unvalidated input.
 */
const NODE_TYPE_RE = /^[a-z][a-z0-9-]*$/

function loadNodeSkillContent(nodeType: string): string | null {
  // Defense-in-depth: even though the Zod regex blocks bad input at the API
  // boundary, the loader must reject anything that isn't a strict kebab-case
  // identifier to prevent path traversal (`../../CLAUDE`, etc.).
  if (!NODE_TYPE_RE.test(nodeType)) return null
  const nodesDir = resolve(resolveSkillsDir(), "nodes")
  const path = resolve(nodesDir, `${nodeType}.md`)
  // Ensure the resolved path is a direct child of nodesDir. Belt-and-braces
  // with the regex above — symlinks or other oddities can't escape either.
  const prefix = nodesDir + "/"
  if (!path.startsWith(prefix)) return null
  try {
    if (!existsSync(path)) return null
    const content = readFileSync(path, "utf-8")
    if (content.length < 50) return null
    return content
  } catch {
    return null
  }
}

function listAvailableNodeTypes(): string[] {
  try {
    const dir = resolve(resolveSkillsDir(), "nodes")
    return readdirSync(dir)
      .filter((f) => f.endsWith(".md") && !f.startsWith("_"))
      .map((f) => basename(f, ".md"))
      .sort()
  } catch {
    return []
  }
}

/** Cached at module load — no per-invocation file I/O or directory walks. */
const WORKFLOW_EDITOR_CONTENT = loadWorkflowEditorContent()
const AVAILABLE_NODE_TYPES = listAvailableNodeTypes()

/**
 * Tool description shown to every connecting MCP client. Designed to be the
 * activation trigger for Claude when the user asks to build or edit a Nodaro
 * workflow — must reference workflow / edit / JSON / update_workflow_json /
 * node so the heuristic surfaces this tool first.
 */
export const WORKFLOW_EDITOR_TOOL_DESCRIPTION =
  "Call FIRST when building or editing any Nodaro workflow JSON. Returns " +
  "the canonical workflow JSON shape, edge/handle wiring conventions, the " +
  "update_workflow_json contract, the asset-URL result-field contract for " +
  "every generation node type, and the catalog of node types you can " +
  "request per-node skills for via get_node_skill. Read this before " +
  "calling update_workflow_json or create_workflow to construct, edit, or " +
  "extend a workflow. The tool is read-only, idempotent, and free of side " +
  "effects."

/**
 * Tool description for `get_node_skill`. Tests require (case-insensitive)
 * the trigger words: "node_type", "schema", "data shape" — keep all three.
 */
export const GET_NODE_SKILL_TOOL_DESCRIPTION =
  "Returns the full skill content for a specific Nodaro node type: the " +
  "schema and data shape (required + optional fields, defaults), the " +
  "data-shape contract for the node's MCP tool call (if any), when-to-use " +
  "guidance, common gotchas, and a worked example JSON. Pass the exact " +
  "kebab-case node_type from the catalog returned by start_workflow_editor " +
  "(e.g., generate-image, image-to-video, list, trim-video). If the " +
  "node_type doesn't have a skill file the tool returns an error with the " +
  "list of valid types so you can self-correct."

export function registerSkillLoaders(
  server: McpServer,
  _session: McpSession,
): void {
  // No scope gate — both tools are pure content delivery. The actions they
  // instruct the LLM to take (update_workflow_json, create_workflow, etc.)
  // are themselves scope-gated by their own tools, so omitting the gate
  // here doesn't leak capability.
  server.registerTool(
    "start_workflow_editor",
    {
      title: "Start Workflow Editor",
      description: WORKFLOW_EDITOR_TOOL_DESCRIPTION,
      inputSchema: {},
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async () => ({
      content: [{ type: "text" as const, text: WORKFLOW_EDITOR_CONTENT }],
    }),
  )

  server.registerTool(
    "get_node_skill",
    {
      title: "Get Node Skill",
      description: GET_NODE_SKILL_TOOL_DESCRIPTION,
      inputSchema: {
        node_type: z
          .string()
          .min(1)
          .max(64)
          .regex(
            NODE_TYPE_RE,
            "must be kebab-case (lowercase a-z, digits, hyphens; no leading dash/digit)",
          )
          .describe(
            "Kebab-case node type, e.g. 'generate-image'. Get the full catalog from start_workflow_editor.",
          ),
      },
      annotations: {
        readOnlyHint: true,
        destructiveHint: false,
        openWorldHint: false,
      },
    },
    async (args: { node_type: string }) => {
      const content = loadNodeSkillContent(args.node_type)
      if (content == null) {
        const validList = AVAILABLE_NODE_TYPES.length
          ? AVAILABLE_NODE_TYPES.join(", ")
          : "(catalog unavailable — workflow-editor.md should list current types)"
        return {
          isError: true as const,
          content: [
            {
              type: "text" as const,
              text:
                `No skill file found for node_type='${args.node_type}'. ` +
                `Valid types: ${validList}.`,
            },
          ],
        }
      }
      return {
        content: [{ type: "text" as const, text: content }],
      }
    },
  )
}
