/**
 * What a route mapper is, and the small helpers every mapper uses.
 *
 * A mapper turns the body a verb sends to a route into the canvas node that
 * sends the same request when the user presses Run (see `../node-mappers.ts`).
 */

export type FlowMediaKind = "image" | "video" | "audio"

/** The node-data field holding a node's media result. */
export type FlowOutputKey = "generatedImageUrl" | "generatedVideoUrl" | "generatedAudioUrl"

/** A media input of the call, wired into the node on `targetHandle`. */
export interface FlowNodeInput {
  readonly url: string
  readonly kind: FlowMediaKind
  readonly targetHandle: string
}

export interface FlowNodeSpec {
  readonly type: string
  readonly data: Readonly<Record<string, unknown>>
  readonly inputs: readonly FlowNodeInput[]
  readonly outputKey: FlowOutputKey
  /** The prompt the assistant sent, for naming a conversation the user's words did not name. */
  readonly prompt?: string
}

export type Body = Readonly<Record<string, unknown>>

export interface RouteMapper {
  /** The MCP tools whose calls to this route become nodes. Each takes `user_request` and `flow_id`. */
  readonly tools: readonly string[]
  /** Body fields this mapper carries into the node; a body with any other field maps to no node. */
  readonly fields: ReadonlySet<string>
  readonly map: (body: Body) => FlowNodeSpec | null
}

/** A route → mapper table, one per domain module. */
export type RouteMappers = Readonly<Record<string, RouteMapper>>

/** Which media kind a result field holds. */
export const KIND_OF_OUTPUT: Readonly<Record<FlowOutputKey, FlowMediaKind>> = {
  generatedImageUrl: "image",
  generatedVideoUrl: "video",
  generatedAudioUrl: "audio",
}

/** The job output field (`output_data`) each result field is read from. */
export const OUTPUT_URL_FIELD: Readonly<Record<FlowOutputKey, string>> = {
  generatedImageUrl: "imageUrl",
  generatedVideoUrl: "videoUrl",
  generatedAudioUrl: "audioUrl",
}

export function str(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined
}

export function num(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined
}

export function bool(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined
}

export function urls(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((v): v is string => typeof v === "string" && v.length > 0) : []
}

/** The defined entries only: an undefined field is not written into node data. */
export function defined(record: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(record).filter(([, v]) => v !== undefined))
}

export function inputsOf(kind: FlowMediaKind, targetHandle: string, list: readonly string[]): FlowNodeInput[] {
  return list.map((url) => ({ url, kind, targetHandle }))
}

/** Steps written before the output key was recorded on them name it by their type. */
const LEGACY_OUTPUT_KEY_BY_TYPE: Readonly<Record<string, FlowOutputKey>> = {
  "generate-image": "generatedImageUrl",
  "modify-image": "generatedImageUrl",
  "generate-video": "generatedVideoUrl",
}

/** The result field of a conversation step: what its writer recorded (`mcpProvenance.outputKey`). */
export function outputKeyOfStep(type: string | undefined, data: Readonly<Record<string, unknown>> | undefined): FlowOutputKey | undefined {
  const recorded = (data?.mcpProvenance as { outputKey?: unknown } | undefined)?.outputKey
  if (recorded === "generatedImageUrl" || recorded === "generatedVideoUrl" || recorded === "generatedAudioUrl") return recorded
  return LEGACY_OUTPUT_KEY_BY_TYPE[type ?? ""]
}
