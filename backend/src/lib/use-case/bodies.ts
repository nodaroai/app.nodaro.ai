// @registry-enumerates USE_CASE_BODIES carries every use-case node unit's body
/**
 * The request bodies of the use-case routes (decided 2026-10-14): one schema
 * per type, sharing the lane fields every use-case route reads (body-shapes.ts).
 * REST, the MCP loopback, the SDK, the editor and the backend engine all send
 * these. Each is its use-case node unit's `use-case.ts` (the "use-cases"
 * aggregate).
 */
import { z } from "zod"
import { USE_CASE_NODE_TYPES, type UseCaseNodeType } from "@nodaro/render-rules"
import type { UnitUseCase } from "../../nodes/kit.js"
import { UNIT_USE_CASES } from "../../nodes/_generated/use-cases.js"

/**
 * Every use-case type's body: each use-case unit's (its use-case.ts). A
 * use-case type with none throws at load — the route factory would otherwise
 * serve a type it cannot parse.
 */
export const USE_CASE_BODIES: { readonly [K in UseCaseNodeType]: z.ZodObject<z.ZodRawShape> } = (() => {
  const out: Record<string, z.ZodObject<z.ZodRawShape>> = {}
  for (const [type, u] of Object.entries(UNIT_USE_CASES)) out[type] = u.body
  const missing = USE_CASE_NODE_TYPES.filter((t) => !Object.hasOwn(out, t))
  if (missing.length) throw new Error(`USE_CASE_BODIES: no body for ${missing.join(", ")} (a use-case unit's use-case.ts)`)
  return out as { readonly [K in UseCaseNodeType]: z.ZodObject<z.ZodRawShape> }
})()

/** A use-case unit's GET /v1/nodes input schema (its use-case.ts); undefined for any other type. */
export function usecaseInputSchemaOf(type: string): UnitUseCase["inputSchema"] | undefined {
  return Object.hasOwn(UNIT_USE_CASES, type) ? UNIT_USE_CASES[type]!.inputSchema : undefined
}

/**
 * Whether `type`'s body takes `null` for `key` — a setting whose None is not
 * its default (Tighten's framing). Any other null a node holds (an agent's or
 * an import's write) is left out of a request: the route then takes its default.
 */
export function usecaseBodyTakesNull(type: UseCaseNodeType, key: string): boolean {
  const field = USE_CASE_BODIES[type].shape[key]
  return field !== undefined && z.safeParse(field, null).success
}

/** What every type's parsed body carries (its own settings ride as further keys). */
export type UseCaseBody = {
  mediaUrls: string[]
  musicUrl?: string
  introCardUrl?: string
  reviewBeforeRender?: boolean
  componentDepth?: number
  executingComponentIds?: string[]
  previewStopRule?: boolean
  reviewerPresent?: boolean
  billingContext?: unknown
  userId?: string
  workflowId?: string
  nodeId?: string
  mcp_client?: string
} & Record<string, unknown>
