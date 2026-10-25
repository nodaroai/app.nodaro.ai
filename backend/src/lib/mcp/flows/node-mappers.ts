/**
 * From the body a verb sends to a route to the canvas node that sends the
 * same request when the user presses Run.
 *
 * Verbs inject the very routes the editor's single-node Run calls, so the
 * mapping is "route body → node data", keyed by the route. Each domain
 * module (`mappers/`) declares its routes, the tools whose calls to that
 * route become nodes, and the body fields its node carries. Everything else
 * is derived from that one table: which tools take `user_request`, and what
 * kind of result each node holds.
 *
 * A mapper only maps what the node can carry. A body holding any field the
 * mapper does not list (a fan-out, a count, a direction the node cannot hold)
 * maps to NO node, rather than to a node whose Run would make something else:
 * a node that does not reproduce the call is worse than no node. The job is
 * still in the user's library and "Recent from MCP".
 */
import { AUDIO_ROUTE_MAPPERS } from "./mappers/audio.js"
import { IMAGE_ROUTE_MAPPERS } from "./mappers/image.js"
import { VIDEO_ROUTE_MAPPERS } from "./mappers/video.js"
import type { Body, FlowNodeSpec, RouteMapper, RouteMappers } from "./mappers/kit.js"

export type { FlowMediaKind, FlowNodeInput, FlowNodeSpec, FlowOutputKey } from "./mappers/kit.js"

function compose(...tables: readonly RouteMappers[]): RouteMappers {
  const all: Record<string, RouteMapper> = {}
  for (const table of tables) {
    for (const [route, mapper] of Object.entries(table)) {
      if (all[route]) throw new Error(`Two conversation-node mappers for ${route}`)
      all[route] = mapper
    }
  }
  return all
}

const ROUTE_MAPPERS = compose(IMAGE_ROUTE_MAPPERS, VIDEO_ROUTE_MAPPERS, AUDIO_ROUTE_MAPPERS)

/** The routes whose calls become nodes. */
export const MAPPED_ROUTES: readonly string[] = Object.keys(ROUTE_MAPPERS)

/** Every tool whose calls can become nodes: each takes `user_request` and `flow_id`. */
export const FLOW_TOOLS: ReadonlySet<string> = new Set(Object.values(ROUTE_MAPPERS).flatMap((m) => m.tools))

/** Fields every verb body carries that are about the request, not the node. */
const TRANSPORT_FIELDS: ReadonlySet<string> = new Set(["mcp_client", "userId", "workflowId", "nodeId"])

/** The body's fields that are about the node: set, and not transport. */
function nodeFields(body: Body): string[] {
  return Object.entries(body)
    .filter(([key, value]) => !TRANSPORT_FIELDS.has(key) && value !== undefined && value !== null)
    .map(([key]) => key)
}

/**
 * The node `tool`'s call to `route` with `body` becomes, or null when that
 * tool's calls to the route are not nodes or the node could not reproduce it.
 */
export function flowNodeFor(route: string, body: unknown, tool: string | undefined): FlowNodeSpec | null {
  const mapper = ROUTE_MAPPERS[route]
  if (!mapper || !tool || !mapper.tools.includes(tool)) return null
  if (!body || typeof body !== "object" || Array.isArray(body)) return null
  const record = body as Body
  if (nodeFields(record).some((key) => !mapper.fields.has(key))) return null
  return mapper.map(record)
}

/**
 * Job types whose route is not `/v1/<type>`: the unified video route files
 * its image-to-video jobs under the old type.
 */
const ROUTE_OF_JOB_TYPE: Readonly<Record<string, string>> = {
  "image-to-video": "/v1/generate-video",
  "suno-generate": "/v1/suno/generate",
}

/**
 * For a finished job of `type` (its `input_data.type`), the route that made
 * it and a tool whose calls to that route become nodes — or null when no
 * mapper covers it. Used to file past jobs into conversations (`history.ts`).
 */
export function historyRouteFor(type: string): { readonly route: string; readonly tool: string } | null {
  const route = ROUTE_OF_JOB_TYPE[type] ?? `/v1/${type}`
  const tool = ROUTE_MAPPERS[route]?.tools[0]
  return tool ? { route, tool } : null
}
