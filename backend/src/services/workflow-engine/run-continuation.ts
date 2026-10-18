/**
 * A run CONTINUED from an earlier execution (`continueFromExecutionId`; TA11,
 * decided 2026-10-04). Render final after a run that stopped at a preview is
 * one, and an app's Render final runs as one, outside the app run.
 *
 * A continuation runs the nodes it names (`nodeIds`) and nothing else. Every
 * other node hands on what the EARLIER execution produced — its
 * `node_states` — never the workflow's saved results in place of them: an
 * app run's results never reach the workflow (its snapshot is the creator's),
 * and a server run's results reach the canvas only through an open editor.
 * A seed carries no job id and no start time (it ran in the earlier
 * execution, not this one; the editor reads such a state as seeded), and
 * names the execution it came from (`seededFromExecution`). A seed of a node
 * that execution did not complete keeps the id of the last attempt at it that
 * FAILED — in that execution, or carried from an earlier one — as
 * `failedAttemptJobId` (never `jobId`), so a use-case node resumes that attempt
 * however many generations later the run is continued.
 *
 * The run RE-APPLIES the input overrides the earlier run used (round 2,
 * decided 2026-10-06), applied to the graph by the one merge every run uses
 * (`applyInputOverridesToNodes`) exactly as that run applied them. They are
 * the ones PINNED on its execution (round 3, decided 2026-10-06:
 * `workflow_executions.input_overrides`, written by the orchestrator when the
 * run started — any lane, an app run or a `/run` alike), so nothing edited
 * since leaks in. An execution made before the pin existed has none: an app
 * run's continuation then reads `app_runs.input_values` (which a draft run
 * with no inputs, or a PATCH after the run, can leave different from what it
 * applied), and a live run's takes only the overrides it is sent. An override
 * sent with the continuation wins over a stored one, field by field
 * (`continuationInputOverrides`).
 *
 * A seed lets a reader fall back to `node.data` (`fromSavedData`) exactly
 * where the earlier execution's own state did: a node it froze or left
 * outside its subset handed on its saved results there, often more than its
 * state's output holds (a list reader reads every saved result), so it hands
 * on the same here. Never for a node that execution ran. For a source or
 * parameter node or an Edit Plan, only where this run's data of the node is
 * taken to be what that run read: a continuation of an APP run (its published
 * snapshot never changes, and the stored overrides are re-applied over it)
 * whose own overrides change nothing of the node (they do not name it, or
 * name it only with the values stored). That rests on the stored overrides
 * being the ones that run applied: the pin is; an execution from before the
 * pin falls back to `app_runs.input_values`, which may not be. A continuation
 * of a live run cannot know it even with a pin — the canvas may have changed
 * since — so there the seed alone stands.
 *
 * An Edit Plan's seed is the plan that execution made, with the person's
 * review (`data.editedEdl`) applied by the one resolver both engines use
 * (`resolveEditPlanOutput`): an edit made on that plan wins; an edit of any
 * other plan is ignored by its basis. The review is judged against the plan
 * AS PLANNED — `plannedJson` when the state holds a plan with a review
 * already applied (a seed from saved data, or from a continuation), else
 * `json` — so a continuation of a continuation, or of a partial run, applies
 * the review made since. A state recorded before seeds carried `plannedJson`
 * holds only the resolved plan: a newer review reads as stale against it.
 *
 * Refusals (stable codes, `@nodaro/shared` run-continuation): no subset, an
 * execution that does not exist or that the caller did not start, another
 * workflow, another version of the graph (a published app version, or the
 * live workflow), an execution that has not ended `completed` (`failed`, for
 * continue-from-failed).
 *
 * An INLINE (use-case) run has no workflow and no app version: its identity
 * is the hash STORED with its snapshot (decided 2026-10-13). A continuation's
 * execution carries the source's snapshot verbatim, so the two match by
 * construction — never a hash of a freshly rebuilt graph, which covers node
 * positions and labels and would drift across a builder change. A saved
 * workflow's run and an inline run never continue each other.
 *
 * The continue-from-failed mode: the source must have ended `failed`, and the
 * run executes every node it did not complete (`fromFailedRunSet`); the
 * completed ones are seeded, never dispatched, so never billed again. A saved
 * workflow's run whose lineage has a newer generation that completed part of
 * what was left is BUILT ON that one (decided 2026-10-18): seeded from its
 * states and running only what it left (`continuationHeadRefusal`). Inline
 * (use-case) runs had it first (decided 2026-10-13); a run of a SAVED workflow
 * has it too (decided 2026-10-17) — under every other check above (the
 * caller's own run, the same workflow, the same version: `POST
 * /v1/workflows/:id/run` runs the live workflow, so an app run's execution
 * stays refused). A failed server run's completed outputs live only in its
 * `node_states` (a server run reaches the saved node data only through an
 * open editor), so this is the one way to keep them.
 */
import {
  isPreviewHoldingType,
  CONTINUATION_NOT_COMPLETED,
  CONTINUATION_NOT_FAILED,
  CONTINUATION_NOT_FOUND,
  CONTINUATION_PREVIEW_PENDING,
  CONTINUATION_SUPERSEDED,
  CONTINUATION_SUBSET_REQUIRED,
  CONTINUATION_VERSION_MISMATCH,
  CONTINUATION_WORKFLOW_MISMATCH,
  PREVIEW_RENDER_NODE_TYPES,
  SAVED_RENDER_STAMPS,
  type RunContinuationCode,
  type SavedRenderQualityStamp,
  type SavedRenderStampReader,
} from "@nodaro/shared/nodes"
import {
  PARAMETER_NODE_TYPES,
} from "@nodaro/shared/catalogs"
import {
  resolveEditPlanOutput,
} from "@nodaro/shared/edl"
import { isDeepStrictEqual } from "node:util"
import { supabase } from "../../lib/supabase.js"
import { resolveRunStateStamps } from "../../lib/canvas-result-ids.js"
import { mergeInputOverrides } from "../../lib/mcp/extract-app-inputs.js"
import {
  noteInputOverridesColumnError,
  pinnedInputOverridesOf,
  withInputOverridesColumn,
} from "../../lib/execution-input-overrides.js"
import { inlineGraphOf, noteInlineGraphColumnError, withInlineGraphColumns } from "../../lib/execution-inline-graph.js"
import { serverStamps } from "../../lib/trigger-data-stamps.js"
import { ancestorsOf, bypassTeleports, type WalkEdge } from "@nodaro/render-rules"
import { lineageRootOf, type ContinueFromFailedStamp } from "../../lib/continue-from-failed-lineage.js"
import { isSkipNode, isSourceNode } from "./execution-graph.js"
import { failedAttemptJobIdOf } from "./failed-attempt.js"
import type { NodeExecutionState, NodeOutput, SimpleNode } from "./types.js"

/** The execution a run continues from, as the checks and the seeds read it. */
export interface ContinuationSource {
  readonly id: string
  /** Who started it (`workflow_executions.user_id`). */
  readonly userId: string
  /** Null for an inline (use-case) execution: it ran a stored snapshot, not a saved workflow. */
  readonly workflowId: string | null
  readonly status: string
  /** The published app version it ran (`app_runs.app_id`, found by the run's
   *  pointer or by the execution's app-run stamp); `null` = the live workflow. */
  readonly appVersionId: string | null
  /** An inline (use-case) run's stored snapshot hash — its identity in place of
   *  a workflow and a version. Absent or null: a saved-workflow run, or an
   *  inline run whose snapshot is gone (expunged) or unreadable. */
  readonly inlineGraphHash?: string | null
  /** The input overrides it ran with: its pin (`workflow_executions.input_overrides`);
   *  without one (an execution from before the pin), an app run's
   *  `app_runs.input_values`. `null`: none — it applied none, or it is a
   *  pre-pin run of the live workflow. Loaded with the states, or with `withPin`. */
  readonly inputOverrides?: Readonly<Record<string, Record<string, unknown>>> | null
  /** Its `node_states` — loaded only when the caller seeds from them. */
  readonly nodeStates?: Readonly<Record<string, NodeExecutionState>>
  /** When it started running (`started_at`); null: it never did. Absent on a literal. */
  readonly startedAt?: string | null
  /** A continue-from-failed of a saved workflow's run: what it continues, and
   *  its lineage's first run (lib/continue-from-failed-lineage.ts). */
  readonly continueFromFailed?: ContinueFromFailedStamp | null
}

/** What the run asks to continue with. */
export interface ContinuationRun {
  readonly userId: string
  /** Null for an inline (use-case) run. */
  readonly workflowId: string | null
  /** The published app version this run executes; absent = the live workflow. */
  readonly appVersionId?: string | null
  readonly nodeIds?: readonly string[] | null
  /** The stored snapshot hash of the inline (use-case) graph this run executes. */
  readonly inlineGraphHash?: string | null
  /** "from-failed": resume a run that failed (inline or of a saved
   *  workflow), keeping what it completed. Default "subset" (Render final
   *  after a preview). */
  readonly mode?: "subset" | "from-failed"
}

/**
 * Load the execution a run continues from, or `null` when there is no such
 * execution. `withStates` also reads its `node_states` (the orchestrator
 * seeds from them; a route only checks), with every render in them stamped:
 * one made before renders were labelled is stamped from its job, by the rule
 * a saved canvas's results are (`resolveRunStateStamps`, canvas-result-ids.ts),
 * so a preview it hands on is never read as a final. The seeding read also
 * takes the overrides the run re-applies (`inputOverrides`); a route's check
 * takes them too with `withPin` — without the states — so its pre-checks
 * (the Preview review, the outbound lock) judge the same merged map the
 * orchestrator applies (`continuationInputOverrides`).
 */
export async function loadContinuationSource(
  executionId: string,
  opts:
    | {
        readonly withStates: false
        /** Also read the overrides the run re-applies (the pin, or its fallback). */
        readonly withPin?: boolean
      }
    | {
        readonly withStates: true
        /** Is this node a render? Asked of the graph the run executes, never
         *  of what a state happens to record about itself. */
        readonly isRenderNode: (nodeId: string) => boolean
      },
): Promise<ContinuationSource | null> {
  // `trigger_data`: a Render final's stamp names the version it ran (below) —
  // read only on a run a stamp-writing lane started (`trigger_type`,
  // lib/server-started-runs.ts): a webhook's body is a caller's.
  const base = opts.withStates
    ? "id, user_id, workflow_id, status, started_at, trigger_type, trigger_data, node_states"
    : "id, user_id, workflow_id, status, started_at, trigger_type, trigger_data"
  const withOverrides = opts.withStates || opts.withPin === true
  // The seeding read (and a route's `withPin` check) also takes the overrides
  // the run pinned when it started (round 3) — through the column guard: until
  // migration 466 reaches the shared database the column is missing, and the
  // read retries without it.
  const select = (columns: string) =>
    supabase.from("workflow_executions").select(columns).eq("id", executionId).maybeSingle()
  // The inline snapshot too (migration 509), through its own column guard:
  // each missing-column error marks one column absent, and the read retries
  // without it.
  const columns = () => withInlineGraphColumns(withOverrides ? withInputOverridesColumn(base) : base)
  let { data: row, error } = await select(columns())
  for (let attempt = 0; error && attempt < 2; attempt++) {
    const retry = (withOverrides && noteInputOverridesColumnError(error)) || noteInlineGraphColumnError(error)
    if (!retry) break
    ;({ data: row, error } = await select(columns()))
  }
  if (error) throw new Error(`continuation: ${error.message}`)
  if (!row) return null
  const execution = row as unknown as {
    id: string
    user_id: string
    workflow_id: string | null
    status: string
    started_at?: string | null
    trigger_type?: unknown
    trigger_data?: unknown
    node_states?: Record<string, NodeExecutionState> | null
  }
  const stamps = serverStamps(execution)
  const pinned = withOverrides ? pinnedInputOverridesOf(row as unknown as Record<string, unknown>) : null
  // The published version an app run executed. Every app lane links its
  // execution here (`executeAppRun`, the draft run); a run of the live
  // workflow has no row.
  // Its stored inputs ride along when the caller reads the overrides and the
  // execution holds no pin (one made before the pin existed).
  const appRunColumns = withOverrides && pinned === null ? "app_id, input_values" : "app_id"
  const { data: appRun, error: appRunError } = await supabase
    .from("app_runs")
    .select(appRunColumns)
    .eq("execution_id", executionId)
    // The execution owner's run only (lib/app-run-ownership.ts).
    .eq("runner_id", execution.user_id)
    .maybeSingle()
  if (appRunError) throw new Error(`continuation: ${appRunError.message}`)
  let appRow = appRun as { app_id?: string | null; input_values?: unknown } | null
  // `execution_id` names a run's CURRENT execution only: a Retry or re-run
  // moves it to a new one. Every execution an app run starts is stamped with
  // the run (lib/app-run-stamp.ts), so an earlier one is still the run's — an
  // app version's execution, never the live workflow's.
  const stampedRun = appRow ? null : stamps.appRun
  if (stampedRun) {
    const { data: stamped, error: stampedError } = await supabase
      .from("app_runs")
      .select(appRunColumns)
      .eq("id", stampedRun)
      .eq("runner_id", execution.user_id)
      .maybeSingle()
    if (stampedError) throw new Error(`continuation: ${stampedError.message}`)
    appRow = stamped as { app_id?: string | null; input_values?: unknown } | null
  }
  // An app run's Render final is an execution no app run names by
  // `execution_id`; a later final continues from it (a chain, decided
  // 2026-10-06). Its stamp, written when it was created, names the version it
  // ran — so the check holds at the worker too, after the run's link has
  // moved on to the new final.
  const finalVersion = appRow ? null : (stamps.appRenderFinal?.appVersionId ?? null)
  return {
    id: execution.id,
    userId: execution.user_id,
    workflowId: execution.workflow_id,
    status: execution.status,
    // A stamped execution whose run is gone still ran a published version:
    // it reads as one no run matches (`STAMPED_APP_RUN_UNKNOWN_VERSION`).
    appVersionId: (appRow?.app_id ?? null) || finalVersion || (stampedRun ? STAMPED_APP_RUN_UNKNOWN_VERSION : null),
    inlineGraphHash: inlineGraphOf(row as unknown as Record<string, unknown>)?.hash ?? null,
    startedAt: execution.started_at ?? null,
    continueFromFailed: stamps.continueFromFailed,
    ...(opts.withStates
      ? { nodeStates: await resolveRunStateStamps(execution.node_states ?? {}, opts.isRenderNode, execution.user_id) }
      : {}),
    // The pin wins; without one, the round-2 reading: an app run's row, a
    // live run's none.
    ...(withOverrides ? { inputOverrides: storedOverrides(pinned !== null ? pinned : appRow?.input_values) } : {}),
  }
}

/** The version a stamped app-run execution reads as when its run row is gone: no run executes it. */
export const STAMPED_APP_RUN_UNKNOWN_VERSION = "app-run-version-unknown"

/** A pin or `app_runs.input_values` as an override map (`{ nodeId: fields }`), or `null` (none). */
function storedOverrides(raw: unknown): Record<string, Record<string, unknown>> | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null
  const out: Record<string, Record<string, unknown>> = {}
  for (const [nodeId, fields] of Object.entries(raw as Record<string, unknown>)) {
    if (fields && typeof fields === "object" && !Array.isArray(fields)) out[nodeId] = fields as Record<string, unknown>
  }
  return Object.keys(out).length > 0 ? out : null
}

/**
 * The input overrides a continuation runs with: the earlier run's stored ones
 * (its pin; before the pin, an app run's `app_runs.input_values`), with the
 * overrides sent for the continuation over them — per node, per field, the
 * sent side winning (the merge the app runner uses for its two override
 * sources). None stored: only the sent ones apply. Pure; mutates neither map.
 */
export function continuationInputOverrides(
  source: Pick<ContinuationSource, "inputOverrides">,
  explicit: Record<string, Record<string, unknown>> | undefined,
): Record<string, Record<string, unknown>> | undefined {
  return mergeInputOverrides(source.inputOverrides ?? undefined, explicit)
}

/** Why a run may not continue from `source`, or `null` when it may. Pure. */
export function continuationRefusal(source: ContinuationSource | null, run: ContinuationRun): RunContinuationCode | null {
  if (!run.nodeIds || run.nodeIds.length === 0) return CONTINUATION_SUBSET_REQUIRED
  // Someone else's execution reads exactly like a missing one: its id tells
  // the caller nothing.
  if (!source || source.userId !== run.userId) return CONTINUATION_NOT_FOUND
  if (!sameGraphIdentity(source, run)) return CONTINUATION_WORKFLOW_MISMATCH
  if ((source.appVersionId ?? null) !== (run.appVersionId ?? null)) return CONTINUATION_VERSION_MISMATCH
  if (run.mode === "from-failed") return source.status === "failed" ? null : CONTINUATION_NOT_FAILED
  if (source.status !== "completed") return CONTINUATION_NOT_COMPLETED
  return null
}

/**
 * Why a continue-from-failed of `source` may not be seeded from `head`, or
 * `null` when it may (decided 2026-10-18; lib/continue-from-failed-lineage.ts).
 * `head` is the lineage's newest generation, which COMPLETED only part of what
 * was left: the run builds on it — seeded from its states, which hold the
 * earlier generations' too — instead of on `source`. It must be the caller's
 * own run of this workflow and this version of its graph (the ordinary checks,
 * `completed` included), have started, and be a continue-from-failed of
 * `source`'s lineage that did not run all it was left. `source` has passed
 * `continuationRefusal` in the from-failed mode. Pure.
 */
export function continuationHeadRefusal(
  head: ContinuationSource | null,
  source: ContinuationSource,
  run: ContinuationRun,
): RunContinuationCode | null {
  const refusal = continuationRefusal(head, { ...run, mode: "subset" })
  if (refusal) return refusal
  const stamp = head!.continueFromFailed
  // Anything else is no generation the run could build on: it reads as missing.
  if (!head!.startedAt || !stamp || stamp.all || stamp.root !== lineageRootOf(source)) return CONTINUATION_NOT_FOUND
  return null
}

/**
 * Did the run and its source execute the same graph? A saved run: the same
 * workflow, neither side a snapshot. An inline run (no workflow on either
 * side): the same STORED snapshot hash, present on both — two runs with no
 * workflow and no hash share nothing. One of each never matches.
 */
function sameGraphIdentity(source: ContinuationSource, run: ContinuationRun): boolean {
  const sourceHash = source.inlineGraphHash ?? null
  const runHash = run.inlineGraphHash ?? null
  if (source.workflowId !== null || run.workflowId !== null) {
    return source.workflowId === run.workflowId && sourceHash === null && runHash === null
  }
  return sourceHash !== null && sourceHash === runHash
}

/**
 * The nodes a continue-from-failed run executes: every one the failed run did
 * not complete, in the order given (graph order kept). Pure.
 */
export function fromFailedRunSet(nodeIds: readonly string[], source: Pick<ContinuationSource, "nodeStates">): string[] {
  return nodeIds.filter((id) => source.nodeStates?.[id]?.status !== "completed")
}

/**
 * A saved workflow's continue-from-failed run set (decided 2026-10-17): the
 * nodes of `nodeIds` the failed run did not complete (`fromFailedRunSet`),
 * closed over what they need — every node upstream of one of them that the
 * run did not complete either, reached through such nodes only (a completed
 * node hands on its seed, so nothing above it is needed). Without the closure
 * a narrow `nodeIds` would run a node on an upstream that never produced
 * anything, and complete without redoing the failure. Wires as the
 * orchestrator reads them (a Teleport pair bypassed). In `order`. Pure.
 */
export function fromFailedClosedRunSet(
  order: readonly string[],
  nodeIds: readonly string[],
  graph: {
    readonly nodes: ReadonlyArray<{ readonly id?: string; readonly type?: string | null; readonly data?: unknown }>
    readonly edges: ReadonlyArray<WalkEdge>
  },
  source: Pick<ContinuationSource, "nodeStates">,
): string[] {
  const remaining = fromFailedRunSet(nodeIds, source)
  const completed = (id: string) => source.nodeStates?.[id]?.status === "completed"
  // Only wires out of a node that did not complete lead further up.
  const open = bypassTeleports(graph.nodes, graph.edges).filter((e) => !completed(e.source))
  const run = new Set(remaining)
  for (const id of remaining) for (const up of ancestorsOf(id, open)) if (!completed(up)) run.add(up)
  return order.filter((id) => run.has(id))
}

/** An Edit Plan's seed: the plan the earlier run made (as planned), with the review applied. */
function editPlanSeedOutput(output: NodeOutput | undefined, data: Readonly<Record<string, unknown>>): NodeOutput | undefined {
  if (!output || output.json === undefined) return output
  const planned = output.plannedJson ?? output.json
  const resolved = resolveEditPlanOutput(planned, data.editedEdl)
  const { listResults: _rows, plannedJson: _planned, ...rest } = output
  return {
    ...rest,
    json: resolved.json,
    ...(resolved.listResults ? { listResults: [...resolved.listResults] } : {}),
    // The resolver hands the plan back unchanged when no review applies.
    ...(resolved.json !== planned ? { plannedJson: planned } : {}),
  }
}

/**
 * Does this node's seed keep the earlier state's saved-data provenance? Only
 * where that state had it, and — for a node whose data IS its value (a source
 * or parameter node) or an Edit Plan — only where this run's data of the node
 * is taken to be what that run read: a continuation of an app run (an
 * immutable snapshot with its stored overrides re-applied) whose own
 * overrides change nothing of the node. Naming the node is not changing it:
 * the app runner sends its full input map on every run, so an entry that
 * only repeats the stored values keeps the provenance; one that changes a
 * stored field, or sets a field the stored ones do not hold, drops it.
 */
function keepsSavedDataProvenance(
  node: SimpleNode,
  state: NodeExecutionState,
  source: ContinuationSource,
  explicit: Readonly<Record<string, Record<string, unknown>>> | undefined,
): boolean {
  if (state.fromSavedData !== true) return false
  if (!(isSourceNode(node.type) || PARAMETER_NODE_TYPES.has(node.type) || node.type === "edit-plan")) return true
  if (source.appVersionId === null) return false
  const own = explicit?.[node.id]
  if (!own) return true
  const stored = source.inputOverrides?.[node.id]
  return Object.entries(own).every(
    ([field, value]) => stored !== undefined && Object.hasOwn(stored, field) && isDeepStrictEqual(value, stored[field]),
  )
}

/**
 * The state of every node the run does NOT execute, built from the earlier
 * execution's `node_states`. A node it completed hands on its output; any
 * other node hands on nothing (seeded `skipped`), except a node no run gives
 * a state of its own (a source or parameter node, a Group / Collect
 * container) when the earlier run holds none for it: that one keeps the
 * ordinary handling. Pure.
 */
export function continuationSeeds(
  nodes: readonly SimpleNode[],
  source: ContinuationSource,
  runNodeIds: ReadonlySet<string>,
  /** The overrides SENT with the continuation (not the stored ones). */
  explicitOverrides?: Readonly<Record<string, Record<string, unknown>>>,
): Map<string, NodeExecutionState> {
  const prior = source.nodeStates ?? {}
  const completedAt = new Date().toISOString()
  const seeds = new Map<string, NodeExecutionState>()
  for (const node of nodes) {
    if (runNodeIds.has(node.id)) continue
    const state = prior[node.id]
    if (state?.status === "completed") {
      const output =
        node.type === "edit-plan"
          ? editPlanSeedOutput(state.output, (node.data ?? {}) as Record<string, unknown>)
          : state.output
      seeds.set(node.id, {
        status: "completed",
        nodeType: node.type,
        ...(output !== undefined ? { output } : {}),
        completedAt,
        ...(keepsSavedDataProvenance(node, state, source, explicitOverrides) ? { fromSavedData: true as const } : {}),
        seededFromExecution: source.id,
      })
      continue
    }
    // A node no run gives a state of its own — a source or parameter node
    // (its config is its value), a Group / Collect container (its output is
    // its members') — keeps the ordinary handling when the earlier run holds
    // none for it.
    if (!state && (isSourceNode(node.type) || PARAMETER_NODE_TYPES.has(node.type) || isSkipNode(node.type))) continue
    // The attempt that failed — in this execution, or carried on its own seed
    // from an earlier generation — rides on: a continuation built on THIS
    // seed's execution then resumes it, never starts it fresh.
    const failedAttempt = failedAttemptJobIdOf(state)
    seeds.set(node.id, {
      status: "skipped",
      nodeType: node.type,
      completedAt,
      seededFromExecution: source.id,
      ...(failedAttempt ? { failedAttemptJobId: failedAttempt } : {}),
    })
  }
  return seeds
}

/**
 * How the stop rule reads a render the continuation does not run (or a
 * use-case node, whose take is stamped the same way): by its
 * SEED — what the earlier execution rendered, stamped with its quality
 * ("proxy" is a Preview) — never by the workflow's saved results. A render
 * with no seed (one the run executes is never read) falls back to the
 * ordinary saved reader.
 */
export function continuationRenderStamps(
  nodes: readonly SimpleNode[],
  seeds: ReadonlyMap<string, NodeExecutionState>,
): SavedRenderStampReader {
  // The rule hands the reader the render's `data` object; key the seed on it.
  const byData = new WeakMap<object, NodeOutput | null>()
  for (const node of nodes) {
    if (!isPreviewHoldingType(node.type)) continue
    const seed = seeds.get(node.id)
    if (!seed || !node.data || typeof node.data !== "object") continue
    byData.set(node.data, seed.status === "completed" ? (seed.output ?? null) : null)
  }
  const stampOf = (quality: unknown): SavedRenderQualityStamp => (typeof quality === "string" ? { quality } : {})
  return {
    output(data) {
      if (!byData.has(data)) return SAVED_RENDER_STAMPS.output(data)
      const output = byData.get(data)
      return output ? stampOf(output.quality) : undefined
    },
    batch(data) {
      if (!byData.has(data)) return SAVED_RENDER_STAMPS.batch(data)
      const rows = byData.get(data)?.listResults
      if (!rows || rows.length === 0) return undefined
      const stamps = byData.get(data)?.listResultStamps
      return rows.map((url, i) => (url ? stampOf(stamps?.[i]?.quality) : null))
    },
  }
}

/** Each refusal's HTTP status at a route that answers synchronously. */
export const CONTINUATION_REFUSAL_STATUS: Readonly<Record<RunContinuationCode, number>> = {
  [CONTINUATION_SUBSET_REQUIRED]: 400,
  [CONTINUATION_NOT_FOUND]: 404,
  [CONTINUATION_WORKFLOW_MISMATCH]: 400,
  [CONTINUATION_VERSION_MISMATCH]: 400,
  [CONTINUATION_NOT_COMPLETED]: 409,
  [CONTINUATION_NOT_FAILED]: 409,
  [CONTINUATION_SUPERSEDED]: 409,
  [CONTINUATION_PREVIEW_PENDING]: 409,
}

/** Each refusal's message (en). Clients branch on the code. */
export const CONTINUATION_REFUSAL_MESSAGE: Readonly<Record<RunContinuationCode, string>> = {
  [CONTINUATION_SUBSET_REQUIRED]:
    "A continued run names the nodes it runs (nodeIds); every other node hands on the earlier execution's output.",
  [CONTINUATION_NOT_FOUND]: "The execution to continue from was not found.",
  [CONTINUATION_WORKFLOW_MISMATCH]: "The execution to continue from ran another workflow.",
  [CONTINUATION_VERSION_MISMATCH]:
    "The execution to continue from ran another version of this workflow (a published app version, or the live workflow).",
  [CONTINUATION_NOT_COMPLETED]: "The execution to continue from has not completed.",
  [CONTINUATION_NOT_FAILED]: "Only a run that failed can be continued from where it stopped.",
  [CONTINUATION_SUPERSEDED]: "A later continuation of this run failed: continue that one.",
  [CONTINUATION_PREVIEW_PENDING]:
    "A later continuation of this run stopped at a Preview review: finish it first (the run named in next, continuing that execution).",
}
