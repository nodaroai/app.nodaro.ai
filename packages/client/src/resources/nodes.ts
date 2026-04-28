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
}
