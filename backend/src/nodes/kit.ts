// backend/src/nodes/kit.ts — the node-unit kit of the server (§5.8 B, decided
// 2026-10-16; tools/units/README.md). TYPE-ONLY: every import below is
// `import type` and this module declares no value, so a unit that imports it
// adds no run-time edge — never into the billing cycle around credits.ts, and
// never into an engine module (payload-builder.ts, node-executor.ts), which
// G5 forbids a unit to import.
//
// What a unit file exports, by file:
//   descriptor.generated.ts → `descriptor: UnitDescriptor` (generated from unit.json)
//   route.ts / route.ee.ts  → `route: UnitRoute`
//   payload.ts              → `payload: UnitPayload`
//   worker.ts               → `worker: UnitWorker`
//   price.ee.ts             → `price: UnitPrice` (Enterprise License, by filename)
//   use-case.ts             → `useCase: UnitUseCase` (execution.kind "use-case")
// The aggregates (backend/src/nodes/_generated/, backend/src/ee/nodes/_generated/)
// are typed with these, so a unit whose export does not fit fails typecheck at
// its aggregate line.
import type { FastifyPluginAsync } from "fastify"
import type { z } from "zod"
import type { NodeDescriptor } from "../lib/node-registry.js"
import type { HandlerFn } from "../workers/shared.js"
import type { PayloadResult } from "../services/workflow-engine/payload-builder.js"
import type { ResolvedInputs, SimpleNode } from "../services/workflow-engine/types.js"

/** What a handle carries (tools/units/vocabulary.mjs HANDLE_KINDS — the editor's HANDLE_COLORS keys). */
export type UnitHandleKind =
  | "text" | "image" | "imageRef" | "endFrame" | "video" | "audio" | "audioRef" | "look" | "pickerJson"
  | "reference" | "identity" | "negative" | "face" | "mask" | "approve" | "list" | "variables" | "control"

export interface UnitInputHandle {
  readonly id: string
  readonly label: string
  readonly accepts: ReadonlyArray<UnitHandleKind>
  readonly field?: string
}

export interface UnitOutputHandle {
  readonly id: string
  readonly label: string
  readonly kind: UnitHandleKind
  /** The node-data field that holds this output. */
  readonly from?: string
  /** Its medium is decided at run time (contract.producer "dynamic"): the pip gets no HANDLE_OUTPUT_TYPES row. */
  readonly runtimeTyped?: true
}

export interface UnitRequiredMedia {
  readonly anyOf: ReadonlyArray<string>
  readonly kind: UnitHandleKind
  readonly noun: string
}

/** backend/src/nodes/<type>/descriptor.generated.ts — the server's projection of unit.json. No price. */
export interface UnitDescriptor {
  readonly type: string
  readonly label: string
  /** The manifest's category (the editor's NodeCategory vocabulary). */
  readonly category: string
  readonly description: string
  readonly outputType: "image" | "video" | "audio" | "text" | "data" | "none"
  /** Where the unit sits among the nodes: right after this type (null = first). */
  readonly position: { readonly after: string | null }
  /** Its place in /v1/nodes (NODE_REGISTRY) when unit.json states one apart from position.after (registry.after). */
  readonly registryPosition?: { readonly after: string | null }
  readonly inputs: ReadonlyArray<string>
  readonly outputs: ReadonlyArray<string>
  readonly handles: { readonly inputs: ReadonlyArray<UnitInputHandle>; readonly outputs: ReadonlyArray<UnitOutputHandle> }
  readonly execution: {
    readonly kind: "source" | "inline" | "sync" | "worker" | "use-case"
    readonly queue?: string
    readonly requires?: UnitRequiredMedia
    /** execution.kind "use-case": its graph builder's key in USE_CASE_SPECS (@nodaro/render-rules). */
    readonly builder?: string
  }
  /** Memberships central seams read (tools/units/capabilities.mjs). */
  readonly capabilities: ReadonlyArray<string>
  /** unit.json `mcp`, when declared: the MCP tools whose result widget names this type as its model (lib/mcp/widget-models.ts). */
  readonly mcp?: { readonly widgetModelFor: ReadonlyArray<string> }
  /** Why no rule bounds its video output's length: unit.json's lengthUnknownReason, present exactly with the "length:unknown" capability (UNBOUNDED_LENGTH_REASONS). */
  readonly lengthUnknownReason?: string
}

/** route.ts / route.ee.ts — the unit's Fastify plugin (Zod body, creditGuard, the insert-job funnel). */
export type UnitRoute = FastifyPluginAsync

/** What payload.ts is handed by buildPayload, after the shared prelude (deny checks, required media). */
export interface UnitPayloadKit {
  readonly node: SimpleNode
  readonly data: Readonly<Record<string, unknown>>
  readonly resolvedInputs: ResolvedInputs
  readonly jobId: string
  readonly usageLogId: string | undefined
  /** The video-queue job every local-ffmpeg node runs as (`modelIdentifier` defaults to `jobName`). */
  ffmpegResult(jobName: string, payload: Record<string, unknown>, modelIdentifier?: string): PayloadResult
}

/** payload.ts — the orchestrator payload builder for the unit. */
export type UnitPayload = (kit: UnitPayloadKit) => PayloadResult

/** worker.ts — the BullMQ handler, registered on the unit's `execution.queue`. */
export type UnitWorker = HandlerFn

/** use-case.ts — a use-case node's request body (the factory route POST /v1/<type> parses it) and its GET /v1/nodes input schema. */
export interface UnitUseCase {
  readonly body: z.ZodObject<z.ZodRawShape>
  readonly inputSchema: NonNullable<NodeDescriptor["inputSchema"]>
}

/**
 * price.ee.ts — the unit's static credit rows and, when the id a run reserves
 * depends on the node's data, the resolver that names it (CREDIT_COSTS). A
 * flat-priced unit omits `creditId`: its run reserves the row named by its type.
 */
export interface UnitPrice {
  readonly staticCosts: Readonly<Record<string, number>>
  creditId?(data: Readonly<Record<string, unknown>>): string
}
