/**
 * Dynamic per-user tool factory.
 *
 * Phase 6 v2.0: each authenticated user's published apps and components show
 * up in tools/list as their own named MCP tools (`app_<slug>`,
 * `component_<slug>`), so the LLM can call "Marketing Video Generator"
 * directly instead of having to know the slug + invoke `run_app`.
 *
 * Cap: PER_KIND_CAP each (15 components + 15 apps = 30 dynamic tools max).
 * Sorted by recency (last_run_at desc, falling back to created_at when
 * never run — coalesce in the index from migration 096). With the static
 * v1.1+v1.2 catalog (~28 tools), the per-session ceiling is ~58.
 *
 * Why not pull from `published_apps` regardless of authoring? Each user
 * sees only their own — the marketplace browse experience already lives in
 * the static `list_apps` / `list_components` tools. Dynamic registration is
 * for the user's own toolbox.
 *
 * Schema mapping:
 *  - Components carry a `component_metadata: ComponentMetadata` with typed
 *    inputs (image/video/audio/text + required flag). We translate each to
 *    a Zod string optional describe()'d with the handle name. Components
 *    are also-published_apps rows with `publish_type='component'`.
 *  - Apps don't have a structured input_schema column; we fall back to a
 *    free-form `inputs` record so the LLM can still pass `{ "node-id":
 *    { "field": "value" } }` overrides as documented in the route schema.
 *
 * Route mapping:
 *  - Component → POST /v1/component/execute  with {appSlug, inputOverrides}
 *  - App       → POST /v1/app/:slug/run      with {inputOverrides}
 *
 * Both paths register an MCP task (so tasks/get works) and return the
 * workflow widget alongside the text result.
 */
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import { z } from "zod"
import type { FastifyInstance } from "fastify"
import { supabase } from "../../supabase.js"
import { sanitizeSlug, dedupeSlugs } from "../slug-sanitizer.js"
import { passesGate, type ToolGate } from "../tool-schemas.js"
import type { McpSession } from "../session.js"
import { registerTask } from "../tasks.js"
import { config } from "../../config.js"
import type { ComponentMetadata } from "@nodaro/shared"

const PER_KIND_CAP = 15
const dynamicGate: ToolGate = { required: ["workflows:execute"] }

interface PublishedAppRow {
  id: string
  name: string
  slug: string | null
  publish_type: "app" | "component"
  description: string | null
  component_metadata: ComponentMetadata | null
  /** snapshot_settings.presentationSettings + nodes — only fetched for apps. */
  snapshot_settings?: Record<string, unknown> | null
  snapshot_nodes?: Array<{ id: string; type?: string; data?: Record<string, unknown> }> | null
}

/**
 * Brief, LLM-readable summary of the inputs an app accepts. Built from the
 * app's presentationSettings.inputItems + snapshot_nodes so the LLM knows
 * which node-id keys to use in `inputs` overrides without guessing.
 */
function summarizeAppInputs(row: PublishedAppRow): string {
  const settings = row.snapshot_settings as
    | { presentationSettings?: { inputItems?: PresentationItem[] } }
    | null
    | undefined
  const items = settings?.presentationSettings?.inputItems
  if (!items || items.length === 0) return ""

  const nodesById = new Map<string, { type?: string; data?: Record<string, unknown> }>()
  for (const n of row.snapshot_nodes ?? []) {
    nodesById.set(n.id, { type: n.type, data: n.data })
  }

  const lines: string[] = []
  for (const item of items) {
    if (item.type === "node") {
      const node = nodesById.get(item.nodeId)
      const label =
        (node?.data?.label as string | undefined) ?? node?.type ?? item.nodeId
      lines.push(`  - "${item.nodeId}" (${label})`)
    } else if (item.type === "field") {
      const node = nodesById.get(item.nodeId)
      const label =
        (node?.data?.label as string | undefined) ?? node?.type ?? item.nodeId
      lines.push(`  - "${item.nodeId}" / field "${item.field}" (${label})`)
    }
    // skip output/richtext/group — not inputs
  }
  if (lines.length === 0) return ""

  return (
    "\n\nInput overrides (pass via `inputs` keyed by node-id):\n" +
    lines.join("\n") +
    `\n\nExample: \`{ inputs: { "${
      lines[0]?.match(/"([^"]+)"/)?.[1] ?? "node-id"
    }": { "value": "..." } } }\`. ` +
    "If the user didn't ask for a specific override, omit `inputs` to use the app's defaults."
  )
}

// Local type alias to avoid circular imports — mirrors @nodaro/shared.
type PresentationItem =
  | { type: "node"; nodeId: string }
  | {
      type: "field"
      id: string
      nodeId: string
      field: string
      allowedValues?: Array<string | number | boolean>
    }
  | { type: "output"; id: string; nodeId: string; outputKey: string }
  | { type: "richtext"; id: string; content: string }
  | { type: "group"; id: string; title: string; items: PresentationItem[] }

export interface RegisterDynamicOpts {
  server: McpServer
  session: McpSession
  fastify: FastifyInstance
}

export async function registerDynamicTools(opts: RegisterDynamicOpts): Promise<void> {
  const { server, session, fastify } = opts
  if (!passesGate(session, dynamicGate)) return

  const components = await fetchByKind(session.userId, "component")
  const apps = await fetchByKind(session.userId, "app")

  const componentNames = dedupeSlugs(
    components.map((c) => `component_${sanitizeSlug(c.slug ?? c.name)}`),
  )
  const appNames = dedupeSlugs(apps.map((a) => `app_${sanitizeSlug(a.slug ?? a.name)}`))

  for (let i = 0; i < components.length; i++) {
    registerComponentTool(server, fastify, session, components[i]!, componentNames[i]!)
  }
  for (let i = 0; i < apps.length; i++) {
    registerAppTool(server, fastify, session, apps[i]!, appNames[i]!)
  }
}

async function fetchByKind(
  userId: string,
  kind: "app" | "component",
): Promise<PublishedAppRow[]> {
  // Schema notes: published_apps uses creator_id (not owner_user_id) and
  // is_active boolean (not deleted_at). last_run_at + the recency index
  // were added in migration 096; the coalesce keeps ordering stable for
  // never-run rows where last_run_at is null.
  //
  // For apps we ALSO fetch snapshot_settings + snapshot_nodes so we can
  // generate per-app input summaries in the tool description (LLM needs
  // node-ids to override defaults). Components don't need this — their
  // typed component_metadata is already authoritative.
  const cols =
    kind === "app"
      ? "id, name, slug, publish_type, description, component_metadata, snapshot_settings, snapshot_nodes"
      : "id, name, slug, publish_type, description, component_metadata"
  const { data } = await supabase
    .from("published_apps")
    .select(cols)
    .eq("creator_id", userId)
    .eq("publish_type", kind)
    .eq("is_active", true)
    .order("last_run_at", { ascending: false, nullsFirst: false })
    .order("created_at", { ascending: false })
    .limit(PER_KIND_CAP)
  return (data as PublishedAppRow[] | null) ?? []
}

function registerComponentTool(
  server: McpServer,
  fastify: FastifyInstance,
  session: McpSession,
  row: PublishedAppRow,
  toolName: string,
): void {
  const inputSchema = componentInputsToZod(row.component_metadata)

  server.registerTool(
    toolName,
    {
      title: row.name,
      description:
        row.description ??
        `Run "${row.name}" component (your saved component). `,
      inputSchema,
      outputSchema: {
        executionId: z.string(),
        name: z.string().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    _meta: {
      "ui/resourceUri": "ui://nodaro/widget/v3/workflow",
      ui: {
        resourceUri: "ui://nodaro/widget/v3/workflow",
        visibility: ["model", "app"],
      },
    },
    },
    async (args: Record<string, unknown>) => {
      // Component route routes by slug, NOT by id. If the row has no slug
      // (legacy or in-flight state), we can't dispatch — surface clearly.
      if (!row.slug) {
        return {
          content: [{ type: "text", text: `Component "${row.name}" has no slug; cannot run.` }],
          isError: true,
        }
      }

      // Components accept inputOverrides keyed by node id. Map each handle's
      // typed arg back into the inputOverrides shape using fieldKey.
      const inputOverrides = inputsToOverrides(row.component_metadata, args)

      const res = await fastify.inject({
        method: "POST",
        url: "/v1/component/execute",
        headers: {
          "x-internal-orchestrator-secret": config.INTERNAL_ORCHESTRATOR_SECRET || "",
        },
        payload: {
          appSlug: row.slug,
          inputOverrides,
          mcp_client: session.clientName,
          userId: session.userId,
        },
      })
      if (res.statusCode >= 400) {
        return {
          content: [{ type: "text", text: `Error: ${res.statusCode} ${res.body}` }],
          isError: true,
        }
      }

      const body = parseBody(res.body)
      const execId = body.jobId ?? body.executionId ?? body.id ?? ""
      if (!execId) {
        return {
          content: [
            {
              type: "text",
              text: `Submitted but couldn't parse execution id: ${res.body}`,
            },
          ],
          isError: true,
        }
      }
      registerTask({ taskId: execId, userId: session.userId, kind: "component" })

      // Iframe template at ui://nodaro/widget/v3/workflow consumes structuredContent.
      return {
        content: [
          {
            type: "text" as const,
            text: `Started component "${row.name}" (job ${execId}).`,
          },
        ],
        structuredContent: { executionId: execId, name: row.name },

      }
    },
  )
}

function registerAppTool(
  server: McpServer,
  fastify: FastifyInstance,
  session: McpSession,
  row: PublishedAppRow,
  toolName: string,
): void {
  // Apps don't have a typed input schema we can rely on (the consumer-side
  // shape lives in snapshot_settings.presentationSettings.inputItems and is
  // far too dynamic to surface as Zod). Fall back to a free-form
  // inputOverrides record — the LLM passes { node-id: { field: value }, ... }.
  const inputSchema: Record<string, z.ZodType> = {
    inputs: z
      .record(z.string(), z.record(z.string(), z.unknown()))
      .optional()
      .describe("Per-node input overrides keyed by node id"),
  }

  const inputSummary = summarizeAppInputs(row)
  server.registerTool(
    toolName,
    {
      title: row.name,
      description:
        (row.description ?? `Run "${row.name}" published app (your published app).`) +
        inputSummary,
      inputSchema,
      outputSchema: {
        executionId: z.string(),
        name: z.string().optional(),
      },
      annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: true },
    _meta: {
      "ui/resourceUri": "ui://nodaro/widget/v3/workflow",
      ui: {
        resourceUri: "ui://nodaro/widget/v3/workflow",
        visibility: ["model", "app"],
      },
    },
    },
    async (args: Record<string, unknown>) => {
      if (!row.slug) {
        return {
          content: [{ type: "text", text: `App "${row.name}" has no slug; cannot run.` }],
          isError: true,
        }
      }

      const res = await fastify.inject({
        method: "POST",
        url: `/v1/app/${encodeURIComponent(row.slug)}/run`,
        headers: {
          "x-internal-orchestrator-secret": config.INTERNAL_ORCHESTRATOR_SECRET || "",
        },
        payload: {
          inputOverrides: args.inputs,
          mcp_client: session.clientName,
          userId: session.userId,
        },
      })
      if (res.statusCode >= 400) {
        return {
          content: [{ type: "text", text: `Error: ${res.statusCode} ${res.body}` }],
          isError: true,
        }
      }

      const body = parseBody(res.body)
      const execId = body.executionId ?? body.id ?? ""
      if (!execId) {
        return {
          content: [
            {
              type: "text",
              text: `Submitted but couldn't parse execution id: ${res.body}`,
            },
          ],
          isError: true,
        }
      }
      registerTask({ taskId: execId, userId: session.userId, kind: "app" })

      return {
        content: [
          {
            type: "text" as const,
            text: `Started app "${row.name}" (execution ${execId}). Open: https://app.nodaro.ai/apps/${row.slug}/runs/${execId}`,
          },
        ],
        structuredContent: { executionId: execId, name: row.name },

      }
    },
  )
}

/**
 * Translate a component's typed handles into a Zod raw shape for tool
 * registration. The MCP SDK takes Record<string, ZodType>, NOT a wrapped
 * z.object().
 *
 * We surface ONE Zod field per handle (string-typed, optional unless required).
 * For media handles (image/video/audio) the LLM passes a URL; for text the
 * LLM passes the text directly. The mapping back to inputOverrides happens
 * in `inputsToOverrides`.
 */
function componentInputsToZod(
  metadata: ComponentMetadata | null,
): Record<string, z.ZodType> {
  if (!metadata?.inputs?.length) return {}
  const shape: Record<string, z.ZodType> = {}
  for (const handle of metadata.inputs) {
    const safeKey = sanitizeSlug(handle.name) || handle.id
    let z1: z.ZodType
    if (handle.type === "image" || handle.type === "video" || handle.type === "audio") {
      z1 = z.string().describe(`URL of the ${handle.type} for "${handle.name}"`)
    } else {
      z1 = z.string().describe(`Text for "${handle.name}"`)
    }
    shape[safeKey] = handle.required ? z1 : z1.optional()
  }
  return shape
}

/**
 * Build the inputOverrides payload from the LLM-supplied args. Component
 * inputs go to the source node identified by handle.id under
 * data.<fieldKey>.
 */
function inputsToOverrides(
  metadata: ComponentMetadata | null,
  args: Record<string, unknown>,
): Record<string, Record<string, unknown>> | undefined {
  if (!metadata?.inputs?.length) return undefined
  const overrides: Record<string, Record<string, unknown>> = {}
  for (const handle of metadata.inputs) {
    const safeKey = sanitizeSlug(handle.name) || handle.id
    const value = args[safeKey]
    if (value === undefined || value === null) continue
    overrides[handle.id] = { ...overrides[handle.id], [handle.fieldKey]: value }
  }
  return Object.keys(overrides).length ? overrides : undefined
}

function parseBody(raw: string): {
  jobId?: string
  executionId?: string
  id?: string
} {
  try {
    return JSON.parse(raw) as {
      jobId?: string
      executionId?: string
      id?: string
    }
  } catch {
    return {}
  }
}
