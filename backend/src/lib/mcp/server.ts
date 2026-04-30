import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import type { FastifyInstance } from "fastify"
import { newSession, type McpSession } from "./session.js"
import { passesGate, type ToolGate } from "./tool-schemas.js"
import { registerVerbs } from "./tools/verbs.js"
import { registerJobs } from "./tools/jobs.js"
import { registerWorkflows } from "./tools/workflows.js"
import { registerComponents } from "./tools/components.js"
import { registerApps } from "./tools/apps.js"
import { registerModels } from "./tools/models.js"
import { registerGallery } from "./tools/gallery.js"
import { registerUploadTools } from "./tools/upload.js"
import { registerDynamicTools } from "./tools/dynamic.js"
import { registerTaskHandlers } from "./tasks.js"
import { startProgressEmitter } from "./progress-emitter.js"
import { registerWidgetResources } from "./widgets/registrar.js"
import type { Scope } from "../scopes.js"

interface BuildOpts {
  userId: string
  scopes: Scope[]
  clientName: string
  /**
   * Fastify instance for `app.inject()`-based dispatch from verb tools to the
   * underlying `/v1/...` routes. Routed-through requests carry the
   * internal-orchestrator-secret header, so the auth middleware accepts
   * `userId` from the request body.
   */
  fastify: FastifyInstance
}

/**
 * Build a fresh MCP server bound to a single authenticated request.
 *
 * The returned `McpServer` is **per-request**, not cached. Each OAuth token
 * carries a different (userId, scopes, clientName) tuple, so caching would
 * leak identity and scopes across users. The Fastify adapter
 * (`./fastify-adapter.ts`) calls this once per request, connects the SDK's
 * StreamableHTTP transport, and discards the server when the request ends.
 *
 * Scope-gated tool registration: each tool declares a {@link ToolGate}; tools
 * whose gate isn't satisfied by `opts.scopes` are silently omitted, so they
 * don't appear in `tools/list`. The placeholder `ping` tool has an empty gate
 * (always visible) and exists primarily as a connectivity check — clients can
 * call it to verify the OAuth token resolved to the expected Nodaro user.
 *
 * Tool families wired in (v1.1):
 *  - `ping` — diagnostic, always visible
 *  - generation verbs (image/video/audio/character/location/object) gated by
 *    `workflows:execute`
 *  - jobs / workflows / components / apps / models / gallery — gated per
 *    family by `jobs:read`, `workflows:read`, `assets:read`, `apps:read`,
 *    `credits:read` (cloud-only) as appropriate. See each `tools/*.ts` file
 *    for the exact gate.
 *
 * Note: `swap_face` is intentionally NOT registered — the underlying
 * `/v1/swap-face` route does not exist in the codebase. v1.2+ may revisit.
 */
export async function buildMcpServer(opts: BuildOpts): Promise<McpServer> {
  const session = newSession(opts)
  const server = new McpServer(
    { name: "nodaro-mcp", version: "1.0.0" },
    {
      // v1.2: declare `tasks` capability so the SDK accepts our `tasks/*`
      // request handlers. Without this, `Server.assertRequestHandlerCapability`
      // throws "Server does not support tasks capability" the moment a
      // client invokes one of the four task methods. The empty objects
      // (per `ServerTasksCapabilitySchema`) are a positive presence signal —
      // every key is optional but the parent object MUST exist.
      capabilities: {
        tools: { listChanged: false },
        tasks: {
          list: {},
          cancel: {},
          requests: { tools: { call: {} } },
        },
        // Explicitly declare resources support without `subscribe`. We
        // register MCP App widget resources for Claude.ai's iframe
        // rendering, but we don't push `notifications/resources/updated`,
        // so subscriptions would dangle forever. Cursor specifically gets
        // stuck in a resources/subscribe retry loop when this isn't
        // explicit — declaring `subscribe: false` tells clients not to try.
        resources: { subscribe: false, listChanged: false },
        experimental: {},
      },
    },
  )

  // Register UI resource templates BEFORE tools, so tool _meta.ui.resourceUri
  // references resolve cleanly when the host calls resources/read.
  registerWidgetResources(server)

  registerPing(server, session)
  registerVerbs({ server, session, fastify: opts.fastify })
  registerJobs({ server, session, fastify: opts.fastify })
  registerWorkflows({ server, session, fastify: opts.fastify })
  registerComponents({ server, session, fastify: opts.fastify })
  registerApps({ server, session, fastify: opts.fastify })
  registerModels({ server, session, fastify: opts.fastify })
  registerGallery({ server, session, fastify: opts.fastify })
  registerUploadTools({ server, session })

  // v2.0: per-user dynamic tools (`component_<slug>`, `app_<slug>`). Capped
  // 15 + 15 = 30 dynamic tools per session. Async because it queries
  // published_apps before tools/list responds; making buildMcpServer
  // async lets the caller await registration so tools/list is correct on
  // the very first request.
  await registerDynamicTools({ server, session, fastify: opts.fastify })

  // v1.2: tasks/* + notifications/progress wiring. Tasks are registered
  // against the session's userId (via a thunk so the closure stays
  // consistent), and the emitter polls Supabase every second to bridge
  // BullMQ progress writes onto MCP `notifications/progress`.
  registerTaskHandlers(server, () => session.userId)
  startProgressEmitter(server)

  return server
}

const pingGate: ToolGate = { required: [] }

function registerPing(server: McpServer, session: McpSession): void {
  if (!passesGate(session, pingGate)) return
  server.registerTool(
    "ping",
    {
      title: "Ping",
      description:
        "Returns 'pong' plus the authenticated Nodaro user id and the calling MCP client. Useful for verifying that the connector is wired up correctly.",
      // Empty raw shape = no input arguments. The SDK's registerTool API takes
      // a `ZodRawShapeCompat` (Record<string, ZodTypeAny>), NOT a wrapped
      // ZodObject — passing `z.object({})` here would type-error.
      inputSchema: {},
    },
    async () => ({
      content: [
        {
          type: "text",
          text: `pong (userId: ${session.userId}, client: ${session.clientName})`,
        },
      ],
    }),
  )
}
