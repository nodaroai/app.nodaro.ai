import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import type { FastifyInstance } from "fastify"
import { newSession, type McpSession } from "./session.js"
import { passesGate, type ToolGate } from "./tool-schemas.js"
import { registerVerbs } from "./tools/verbs.js"
import { registerJobs } from "./tools/jobs.js"
import { registerWorkflows } from "./tools/workflows.js"
import { registerProjectTools } from "./tools/projects.js"
import { registerComponents } from "./tools/components.js"
import { registerApps } from "./tools/apps.js"
import { registerModels } from "./tools/models.js"
import { registerGallery } from "./tools/gallery.js"
import { registerCharacterTools } from "./tools/characters.js"
import { registerUploadTools } from "./tools/upload.js"
import { registerFilmDirectorTool } from "./tools/film-director.js"
import { registerSkillLoaders } from "./tools/skill-loaders.js"
// v3.0: dynamic per-user app_<slug> / component_<slug> tools dropped in
// favor of the pure-discovery model (list_* / get_*_inputs / run_*).
// They didn't scale past ~15 saved apps and the prefer-verbs nudge in
// their descriptions admitted they didn't belong as first-class tools.
import { registerTaskHandlers } from "./tasks.js"
// Progress emitter intentionally not invoked — see comment in buildMcpServer.
// Import kept so the future re-enable is one line, not a re-import.
import { startProgressEmitter as _startProgressEmitter } from "./progress-emitter.js"
void _startProgressEmitter
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
  registerProjectTools(server, session)
  registerComponents({ server, session, fastify: opts.fastify })
  registerApps({ server, session, fastify: opts.fastify })
  registerModels({ server, session, fastify: opts.fastify })
  registerGallery({ server, session, fastify: opts.fastify })
  registerCharacterTools({ server, session, fastify: opts.fastify })
  registerUploadTools({ server, session })
  registerFilmDirectorTool(server, session)
  registerSkillLoaders(server, session)

  // v3.0: dynamic per-user tools dropped — see import comment above.

  // v1.2: tasks/* request handlers stay wired (they're spec-mandated and
  // respond to client-initiated polls). The proactive progress-emitter
  // however is intentionally NOT started — it sends `notifications/progress`
  // with the job id as the progressToken, but per MCP spec those tokens
  // must match a `_meta.progressToken` the client sent in the originating
  // tool call. Cursor (and other strict clients) log "Received a progress
  // notification for an unknown token" when we emit unsolicited ones.
  // Both widgets (single-job and workflow) now poll get_asset / get_app_run
  // explicitly via tools/call so they don't depend on push notifications;
  // re-enable the emitter once the client→server progressToken negotiation
  // is wired correctly.
  registerTaskHandlers(server, () => session.userId)

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
