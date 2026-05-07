import type { NodaroClient } from "../client.js"

export type NodeCategory =
  | "input"
  | "parameter"
  | "ai-image"
  | "ai-video"
  | "ai-audio"
  | "ai-text"
  | "processing"
  | "composition"
  | "trigger"
  | "output"
  | "control"
  | "entity"
  | "utility"

export type OutputType = "text" | "image" | "video" | "audio" | "data" | "none"

/**
 * Field shape inside a node's `inputSchema.fields[]`. Mirrors
 * `backend/src/lib/node-registry.ts`.
 */
export interface NodeInputField {
  key: string
  type: string
  required?: boolean
  options?: string[]
}

export interface NodeInputSchema {
  fields: NodeInputField[]
}

/**
 * Node descriptor returned by `GET /v1/nodes` and `GET /v1/nodes/:type`.
 * Mirrors `backend/src/lib/node-registry.ts#NodeDescriptor`.
 */
export interface NodeDescriptor {
  type: string
  label: string
  category: NodeCategory
  description: string
  outputType: OutputType
  /** Credit cost. Number when fixed, string range like "1-8" when model-dependent, undefined if free. */
  creditCost?: number | string
  /** Input fields the node exposes for user override (subset of full config). */
  inputSchema?: NodeInputSchema
  /** For AI nodes: list of provider IDs supported. */
  providers?: string[]
  /** Capability flags such as "supports-reference-image" or "supports-end-frame". */
  capabilities?: string[]
}

/**
 * Result of a direct node execution. Most node types return `{ jobId }` and
 * are processed asynchronously by a worker — the caller polls
 * `client.jobs.get(jobId)` until status is `completed`/`failed`.
 *
 * A small subset (combine-text, split-text, composite — the "inline"
 * orchestrator categories) execute synchronously and return their full
 * result body. The shape is route-specific; consumers should branch on the
 * presence of `jobId`.
 */
export type RunNodeResult =
  | { jobId: string; usageLogId?: string; [k: string]: unknown }
  | Record<string, unknown>

export class NodesResource {
  constructor(private client: NodaroClient) {}

  /** List all known node descriptors. Server caches publicly for 5 minutes. */
  list(): Promise<{ data: NodeDescriptor[] }> {
    return this.client.request("GET", "/v1/nodes")
  }

  /** Get a single node descriptor by type slug (e.g. "generate-image"). */
  get(type: string): Promise<{ data: NodeDescriptor }> {
    return this.client.request("GET", `/v1/nodes/${encodeURIComponent(type)}`)
  }

  /**
   * Run a single node directly without wrapping it in a workflow. Posts
   * `params` as the request body to `POST /v1/<type>` (the route convention
   * every generation node follows: `generate-image`, `image-to-video`,
   * `text-to-speech`, etc.).
   *
   * This is the SDK equivalent of the MCP server's verb tools — and the
   * path the Nodaro CLI uses for `nodaro nodes run <type>`.
   *
   * Most node types are async: the response includes `{ jobId }` and the
   * actual generation runs on a worker. Poll `client.jobs.get(jobId)` until
   * completed. Inline node types (combine-text, etc.) return their full
   * result synchronously without a `jobId` field.
   *
   * @param type    Node type slug — must match an entry in the registry
   *                returned by `list()` (e.g. "generate-image").
   * @param params  Request body. Field names must match the node's
   *                `inputSchema` (see `get(type).inputSchema`).
   */
  run(type: string, params: Record<string, unknown> = {}): Promise<RunNodeResult> {
    return this.client.request("POST", `/v1/${encodeURIComponent(type)}`, { body: params })
  }
}
