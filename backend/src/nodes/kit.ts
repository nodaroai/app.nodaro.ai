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
//   budget.ts               → `budget: UnitBudget` (execution.kind "worker"; a pure leaf)
//   recover.ts              → `recover: UnitRecover` (an own-writer worker on a provider whose reconcile reads it)
// The aggregates (backend/src/nodes/_generated/, backend/src/ee/nodes/_generated/)
// are typed with these, so a unit whose export does not fit fails typecheck at
// its aggregate line.
import type { FastifyPluginAsync } from "fastify"
import type { z } from "zod"
import type { NodeDescriptor } from "../lib/node-registry.js"
import type { FinalizeClaimant, FinalizeOutcome } from "../lib/job-finalize.js"
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
  /** The input takes every wire, in order, each its own source (a video/audio input with no field). */
  readonly many?: true
}

export interface UnitOutputHandle {
  readonly id: string
  readonly label: string
  readonly kind: UnitHandleKind
  /** The node-data field that holds this output. */
  readonly from?: string
  /** Its medium is decided at run time (contract.producer "dynamic"): the pip gets no HANDLE_OUTPUT_TYPES row. */
  readonly runtimeTyped?: true
  /**
   * It carries one run's list of files (an image/video/audio output): the job
   * writes the list under the output's id, its `from` field holds it, an Each
   * wire runs the next node once per item and a plain wire reads the first.
   */
  readonly list?: true
  /**
   * A JSON (look) output only: the list output of this unit whose items its
   * entries line up with, one for one. After a run once per upstream item both
   * hand on every row's, each entry with its row (@nodaro/render-rules
   * unitBatchSideOutputs).
   */
  readonly alignedWith?: string
}

export interface UnitRequiredMedia {
  readonly anyOf: ReadonlyArray<string>
  readonly kind: UnitHandleKind
  readonly noun: string
}

/**
 * One setting a published app may expose (unit.json `appFields`, tools/units/README.md
 * "A unit's app fields"): the node-data `field` it writes and every value a run may
 * set it to — a select's option values, or a whole number from `min` to `max` in
 * steps of `step`. The app run holds a submitted value to it
 * (lib/exposed-unit-field-check.ts); `get_app_inputs` types the field by it.
 */
export type UnitAppField =
  | {
      readonly field: string
      readonly kind: "select"
      readonly labelKey: string
      readonly options: ReadonlyArray<{ readonly value: string; readonly labelKey?: string }>
    }
  | {
      readonly field: string
      readonly kind: "integer"
      readonly labelKey: string
      readonly min: number
      readonly max: number
      readonly step: number
    }

/** backend/src/nodes/<type>/descriptor.generated.ts — the server's projection of unit.json. No price. */
export interface UnitDescriptor {
  readonly type: string
  readonly label: string
  /** The manifest's category (the editor's NodeCategory vocabulary). */
  readonly category: string
  readonly description: string
  readonly outputType: "image" | "video" | "audio" | "text" | "data" | "none"
  /** Its /v1/nodes category when its own category is not one the server shares (unit.json registry.category). */
  readonly registryCategory?: string
  /** The medium of its output, `contract.producer` of unit.json (null: it outputs no media). */
  readonly producer: "audio" | "video" | "image" | "dynamic" | null
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
  /** The settings a published app may expose (unit.json `appFields`), when declared — lib/exposed-unit-field-check.ts reads them. */
  readonly appFields?: ReadonlyArray<UnitAppField>
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

/**
 * budget.ts — the job budget (ms) of ONE job of this worker unit, read off its
 * queue payload; undefined when the payload names nothing to size (every reader
 * then keeps its default). job-budget.ts composes it under the unit's type (its
 * BullMQ job name): the video worker's liveness, the orchestrator's ceilings and
 * the row sweeps read it. A PURE leaf — it must not load the ffmpeg runtime,
 * storage, supabase or config (lib/__tests__/job-budget-leaf.test.ts).
 */
export type UnitBudget = (data: unknown) => number | undefined

/** What a reconcile hands a unit's recover.ts: the job, and its provider task as the poll read it, finished. */
export interface UnitRecoverTask {
  readonly jobId: string
  /** The job's request, `jobs.input_data`: what its route or payload wrote, the settings the worker read off its queue payload included. */
  readonly input: Readonly<Record<string, unknown>>
  /** The task the worker saved (`jobs.provider_task_id`) and its kind (`provider_kind`). */
  readonly taskId: string
  readonly providerKind: string
  /** The finished task's whole result as the provider's poll returned it (a KIE record-info task: its parsed `resultJson`). */
  readonly result: unknown
  /** What the task really cost, in the provider's own credits, from its record; undefined when it says nothing. */
  readonly providerCredits?: number
  readonly providerMs?: number
  /** Who finalizes: the reconcile cron, or the worker's stall re-pick. */
  readonly claimant: FinalizeClaimant
}

/**
 * recover.ts — finish an own-writer worker's job (capability
 * "finalize:own-writer") from its provider task's finished result, through the
 * SAME delivery its worker runs after the provider call: the reconcile cron and
 * the worker's stall re-pick (lib/reconcile/kie.ts, through
 * lib/reconcile/unit-recovery.ts) call it instead of bumping the row toward its
 * exhaustion. Resolves with the finalize's outcome (`{ ok: false }` — a lost
 * claim, a held or blocked result — is not a failure). Throws when the result
 * cannot be delivered (unreadable, no base, its store failed after its
 * attempts): the reconcile then fails the job and refunds it at once.
 */
export type UnitRecover = (task: UnitRecoverTask) => Promise<FinalizeOutcome>

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
