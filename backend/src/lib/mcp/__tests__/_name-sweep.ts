/**
 * The MCP lane's whole surface as a client meets it, read the way a client
 * reads it: through the server's own request handlers (the ones the HTTP
 * transport and the in-app invoker call). Shared by the deployment-name tests:
 * `deployment-name-recording.test.ts` records it with nothing configured, and
 * `deployment-name.test.ts` reads it on a deployment with its own name.
 *
 * What is read:
 *  - `initialize` (the server's name and anything it says about itself);
 *  - `tools/list`, `resources/list`, `resources/templates/list` and every
 *    resource the list names (`resources/read`: the widgets' pages);
 *  - a call to EVERY listed tool, twice: with no arguments, and with
 *    arguments made from its own schema (every required field filled), each
 *    against routes that all answer one status (`SWEEP_STATUSES`), so every
 *    refusal a tool builds from a route's answer, and every sentence it states
 *    once a route accepted, is said once. Nothing reaches a provider or the
 *    network: the routes are a stub, `fetch` refuses, the database answers
 *    empty.
 *
 * The caller mocks `../../supabase.js` and `../../config.js` (`hasCredits`)
 * before importing the server; this file only drives it.
 */
import Fastify, { type FastifyInstance } from "fastify"
import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js"
import type { Scope } from "../../scopes.js"

type Handler = (req: { method: string; params: Record<string, unknown> }, extra: Record<string, unknown>) => Promise<unknown>

function handlers(server: McpServer): Map<string, Handler> {
  return (server as unknown as { server: { _requestHandlers: Map<string, Handler> } }).server._requestHandlers
}

async function ask(server: McpServer, method: string, params: Record<string, unknown> = {}): Promise<unknown> {
  const h = handlers(server).get(method)
  if (!h) return null
  return h({ method, params }, {})
}

/** The statuses every stubbed route answers in turn; 202 is the route accepting the run. */
export const SWEEP_STATUSES = [202, 400, 402, 403, 404, 409, 429, 500, 503] as const
export type SweepStatus = (typeof SWEEP_STATUSES)[number]

/** The fixed ids a stubbed route hands back. */
export const SWEEP_JOB_ID = "a1000000-0000-4000-8000-0000000000a1"
export const SWEEP_UUID = "b2000000-0000-4000-8000-0000000000b2"

/** Routes that all answer `status`: a refusal envelope, or (202) a job accepted. */
export async function stubAll(status: SweepStatus): Promise<FastifyInstance> {
  const fastify = Fastify()
  fastify.all("/*", async (_req, reply) => {
    if (status === 202) {
      return reply.code(202).send({ jobId: SWEEP_JOB_ID, id: SWEEP_JOB_ID, executionId: SWEEP_UUID, status: "pending", data: { jobId: SWEEP_JOB_ID, id: SWEEP_JOB_ID } })
    }
    // 503 with a code whose message is forwarded, so that branch is read too.
    const code = status === 503 ? "probe_timeout" : status === 400 ? "validation_error" : "stub_refusal"
    return reply.code(status).send({ error: { code, message: "the stubbed route refused" } })
  })
  await fastify.ready()
  return fastify
}

type JsonSchema = {
  type?: string | string[]
  properties?: Record<string, JsonSchema>
  required?: string[]
  items?: JsonSchema
  enum?: unknown[]
  const?: unknown
  anyOf?: JsonSchema[]
  oneOf?: JsonSchema[]
  allOf?: JsonSchema[]
  format?: string
  minimum?: number
  exclusiveMinimum?: number
  minItems?: number
  minLength?: number
  default?: unknown
}

/** A value for one schema: the first enum member, a URL for a link, an id for an id, the minimum for a number. */
function valueFor(schema: JsonSchema | undefined, key: string, depth = 0): unknown {
  if (!schema || depth > 6) return "x"
  if (schema.const !== undefined) return schema.const
  if (schema.enum && schema.enum.length > 0) return schema.enum[0]
  const branch = schema.anyOf?.[0] ?? schema.oneOf?.[0] ?? schema.allOf?.[0]
  if (branch && !schema.type) return valueFor(branch, key, depth + 1)
  const type = Array.isArray(schema.type) ? schema.type.find((t) => t !== "null") : schema.type
  switch (type) {
    case "string": {
      if (schema.format === "uri" || schema.format === "url" || /url$/i.test(key)) return "https://media.example.test/a.png"
      if (schema.format === "uuid" || /(^|_)id$/i.test(key) || /Id$/.test(key)) return SWEEP_UUID
      const min = schema.minLength ?? 1
      return "x".repeat(Math.max(1, Math.min(min, 64)))
    }
    case "number":
    case "integer":
      return schema.minimum ?? (schema.exclusiveMinimum !== undefined ? schema.exclusiveMinimum + 1 : 1)
    case "boolean":
      return false
    case "array": {
      const n = Math.max(1, schema.minItems ?? 1)
      return Array.from({ length: Math.min(n, 4) }, () => valueFor(schema.items, key.replace(/s$/, ""), depth + 1))
    }
    case "object":
      return argumentsFor(schema, depth + 1)
    default:
      return "x"
  }
}

/** Arguments with every required field of `schema` filled. */
export function argumentsFor(schema: JsonSchema | undefined, depth = 0): Record<string, unknown> {
  const out: Record<string, unknown> = {}
  for (const key of schema?.required ?? []) out[key] = valueFor(schema?.properties?.[key], key, depth)
  return out
}

/**
 * A reply with what changes on every call read as a placeholder: an upload
 * link's signed token, a fresh id, a timestamp. Everything else is kept.
 */
export function normalizedReply(reply: string): string {
  return reply
    .replace(/eyJ[A-Za-z0-9_-]{8,}(?:\.[A-Za-z0-9_-]+)*/g, "<token>")
    .replace(/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, "<uuid>")
    .replace(/\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z/g, "<time>")
}

/** One call's answer, serialized as a client receives it; a call that does not settle in time reads as such. */
async function called(server: McpServer, name: string, args: Record<string, unknown>): Promise<string> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<string>((resolve) => {
    timer = setTimeout(() => resolve("<did not settle>"), 10_000)
  })
  const reply = ask(server, "tools/call", { name, arguments: args }).then(
    (r) => JSON.stringify(r),
    (e: unknown) => `<threw> ${e instanceof Error ? e.message : String(e)}`,
  )
  try {
    return await Promise.race([reply, timeout])
  } finally {
    clearTimeout(timer)
  }
}

export interface LaneSurface {
  initialize: string
  toolsList: string
  resourcesList: string
  resourceTemplates: string
  /** Each resource the list names, by its URI: the page `resources/read` answers. */
  resources: Record<string, string>
  /** Each call, keyed `<status> <tool> <empty|filled>`. */
  calls: Record<string, string>
}

export interface SweepOpts {
  buildMcpServer: (opts: { userId: string; scopes: Scope[]; clientName: string; fastify: FastifyInstance; conversation?: { client: string; key: string | null } }) => Promise<McpServer>
  scopes: readonly Scope[]
  /** Which statuses to sweep calls against (all by default); [] reads only the lists and resources. */
  statuses?: readonly SweepStatus[]
}

/** The lane's surface for one grant: lists, resources, and every tool called against every status. */
export async function sweepLane(opts: SweepOpts): Promise<LaneSurface> {
  const build = async (fastify: FastifyInstance) =>
    opts.buildMcpServer({ userId: "c0000000-0000-4000-8000-00000000000c", scopes: [...opts.scopes], clientName: "Claude", fastify, conversation: { client: "claude", key: null } })
  const server = await build(Fastify())
  const initialize = JSON.stringify(await ask(server, "initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "sweep", version: "1" } }))
  const list = (await ask(server, "tools/list")) as { tools: Array<{ name: string; inputSchema?: JsonSchema }> }
  const resourcesListed = (await ask(server, "resources/list")) as { resources?: Array<{ uri: string }> } | null
  const resources: Record<string, string> = {}
  for (const r of resourcesListed?.resources ?? []) resources[r.uri] = JSON.stringify(await ask(server, "resources/read", { uri: r.uri }))
  const calls: Record<string, string> = {}
  for (const status of opts.statuses ?? SWEEP_STATUSES) {
    const fastify = await stubAll(status)
    const s = await build(fastify)
    for (const tool of list.tools) {
      calls[`${status} ${tool.name} empty`] = await called(s, tool.name, {})
      calls[`${status} ${tool.name} filled`] = await called(s, tool.name, argumentsFor(tool.inputSchema))
    }
    await fastify.close()
  }
  return {
    initialize,
    toolsList: JSON.stringify(list),
    resourcesList: JSON.stringify(resourcesListed),
    resourceTemplates: JSON.stringify(await ask(server, "resources/templates/list")),
    resources,
    calls,
  }
}
