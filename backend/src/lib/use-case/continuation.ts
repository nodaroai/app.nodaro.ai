/**
 * What a continued use-case run executes (decided 2026-10-13), worked out
 * from the run being continued — its wrapper job, the snapshot its inner
 * execution stored, and that execution's states. Reads only; nothing is
 * written, held or enqueued here.
 *
 *  - from-failed: every step the failed run did not complete. A review-on
 *    run's first part resumes only up to its render (what follows runs once,
 *    in Render final); a Render final's chain resumes everything it had left.
 *    Its fee is the run's own fee again — the failed run's was refunded — and
 *    none for a Render final's chain, which never had one.
 *    A first run and its continue-from-faileds are one lineage, each naming
 *    the original (`_chainOf`); every final of a preview run, and each
 *    continue-from-failed of one, names that run (`_finalOf`). Only the
 *    newest generation of either is continued.
 *  - render-final: after a review-on run held its preview, the render at
 *    Final and every step after it, with the reviewer's edit on the plan. No
 *    fee. One at a time: refused while another final of the same run is
 *    under way (a from-failed of a final counts as that final). A completed
 *    final does not block another (decided 2026-10-13): a re-final after a
 *    further edit renders the final steps again, still with no fee — but the
 *    very edit a completed final already rendered is refused
 *    (`render_final_already_rendered`, naming it). A clip set's final whose
 *    review dropped every clip is refused (`use_case_nothing_kept`): there is
 *    nothing to render.
 *
 * The graph is the earlier run's stored snapshot, verbatim: its stored hash is
 * the run's identity, so a rebuilt graph would be refused as another one.
 * Someone else's run, a wrapper that is not a use-case run, a run of another
 * use-case type (continued through another type's route), or a snapshot that
 * is gone all read as not found.
 */
import {
  initialRunNodeIds,
  renderFinalRunSet,
  renderRunOverrides,
  usecaseRenderNodeId,
  usecaseResultKind,
  usecaseRunPlan,
  usecaseRunType,
  usecaseDescriptor,
  type StoredInlineGraph,
  type UseCaseNodeType,
} from "@nodaro/render-rules"
import {
  CONTINUATION_NOT_COMPLETED,
  CONTINUATION_NOT_FAILED,
  CONTINUATION_SETTLING,
  CONTINUATION_SUBSET_REQUIRED,
  CONTINUATION_SUPERSEDED,
  PREVIEW_RENDER_NODE_TYPES,
  RENDER_FINAL_ALREADY_RENDERED,
  RENDER_FINAL_ALREADY_RENDERED_MESSAGE,
  USE_CASE_NOTHING_KEPT,
  USE_CASE_NOTHING_KEPT_MESSAGE,
} from "@nodaro/shared/nodes"
import {
  editPlanBasis,
  resolveEditPlanOutput,
} from "@nodaro/shared/edl"
import { supabase } from "../supabase.js"
import { findExecutionIdForWrapper, loadInlineGraph } from "../execution-inline-graph.js"
import { stateHoldsPreview } from "../app-run-states.js"
import { RENDER_FINAL_ALREADY_RUNNING, RENDER_FINAL_NOT_PREVIEW } from "../render-final-codes.js"
import { IN_FLIGHT_JOB_STATUSES } from "../job-status.js"
import type { ContinueClaimKey } from "./continue-claim.js"
import {
  CONTINUATION_REFUSAL_MESSAGE,
  CONTINUATION_REFUSAL_STATUS,
  continuationRefusal,
  fromFailedRunSet,
  loadContinuationSource,
  type ContinuationSource,
} from "../../services/workflow-engine/run-continuation.js"

export type UseCaseContinueMode = "from-failed" | "render-final"

export interface UseCaseContinuation {
  readonly ok: true
  /** The wrapper job's input, as the run being continued stored it. */
  readonly input: Readonly<Record<string, unknown>>
  readonly sourceExecutionId: string
  readonly source: ContinuationSource
  /** The earlier run's snapshot, verbatim. */
  readonly graph: StoredInlineGraph
  /** In graph order. */
  readonly nodeIds: readonly string[]
  /** Render final: the render's Final and the reviewer's plan edit (the earlier run's pin is merged by the run). */
  readonly inputOverrides?: Record<string, Record<string, unknown>>
  /** The fee this run holds (before the edition is asked). */
  readonly feeCredits: number
  /** This run renders the delivery: a Render final, or a run continuing one. */
  readonly finalChain: boolean
  /** A final chain's preview run (its wrapper job): the run whose one Render final this is. */
  readonly finalOf: string | null
  /** A first-run continuation's lineage root: the original run's wrapper job (`_chainOf`). */
  readonly chainOf: string | null
  /** A final chain: the edit it renders, as a key (`renderFinalEditKey`), recorded on its wrapper (`_finalEdit`). */
  readonly finalEdit?: string
  /** The run renders a preview a person reviews (a review-on run's first part). */
  readonly reviewBeforeRender: boolean
  /** Whose wrapper the continuation claims, and under which key (lib/use-case/continue-claim.ts). */
  readonly claim: { readonly rowId: string; readonly key: ContinueClaimKey }
}

export interface UseCaseContinuationRefusal {
  readonly ok: false
  readonly status: number
  readonly code: string
  readonly message: string
  /** already_running: the continuation of this run that is under way or done. */
  readonly jobId?: string
}

const NOT_FOUND: UseCaseContinuationRefusal = { ok: false, status: 404, code: "not_found", message: "That run was not found." }

const refusal = (code: keyof typeof CONTINUATION_REFUSAL_STATUS, message?: string): UseCaseContinuationRefusal => ({
  ok: false,
  status: CONTINUATION_REFUSAL_STATUS[code],
  code,
  message: message ?? CONTINUATION_REFUSAL_MESSAGE[code],
})

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v)

/**
 * A continuation already there — under way or completed — matching `filters`
 * on the wrapper's input (`input_data->><field>`). A failed or cancelled one
 * does not count: the run may be continued again (`failedToo` counts a failed
 * one too). `inFlightOnly` counts only one still under way; `completedOnly`
 * only one that completed. Throws on a read error.
 */
async function existingContinuation(
  userId: string,
  filters: Readonly<Record<string, string>>,
  opts: { readonly failedToo?: boolean; readonly startedOnly?: boolean; readonly inFlightOnly?: boolean; readonly completedOnly?: boolean } = {},
): Promise<{ id: string; status: string } | null> {
  let query = supabase.from("jobs").select("id, status").eq("user_id", userId).eq("provider", "use-case")
  for (const [field, value] of Object.entries(filters)) query = query.eq(`input_data->>${field}`, value)
  // A wrapper whose run never started is no generation. Its run is named on
  // its input (the start's stamp, or the finaliser's back-fill when that
  // stamp failed) or its output (the finaliser's); a wrapper that failed
  // before its run started carries neither.
  if (opts.startedOnly) query = query.or("input_data->>_executionId.not.is.null,output_data->>_executionId.not.is.null")
  const { data, error } = await query
    .in("status", opts.completedOnly ? ["completed"] : [...IN_FLIGHT_JOB_STATUSES, ...(opts.inFlightOnly ? [] : ["completed"]), ...(opts.failedToo ? ["failed"] : [])])
    .order("created_at", { ascending: false })
    .limit(1)
    .maybeSingle()
  if (error) throw new Error(`use-case continue: continuations unreadable: ${error.message}`)
  const row = data as { id?: unknown; status?: unknown } | null
  return row && typeof row.id === "string" ? { id: row.id, status: String(row.status) } : null
}

/** The 409 for a continuation already there, naming it. */
function alreadyThere(existing: { id: string; status: string }, what: "final" | "continue"): UseCaseContinuationRefusal {
  const done = existing.status === "completed"
  const message =
    what === "final"
      ? existing.status === "failed"
        ? "A later Render final of this run failed: continue that one."
        : done ? "This run's Render final has already been rendered." : "A Render final of this run is already in progress."
      : existing.status === "failed"
        ? "A later continuation of this run failed: continue that one."
        : done ? "This run has already been continued, and that run completed." : "This run is already being continued."
  // A newer generation that failed runs nothing: this one is superseded by it.
  const code = existing.status === "failed" ? CONTINUATION_SUPERSEDED : RENDER_FINAL_ALREADY_RUNNING
  return { ok: false, status: 409, code, message, jobId: existing.id }
}

/**
 * A final chain's one-at-a-time rule (each final-chain wrapper names the
 * preview run it renders, `_finalOf`): a Render final, or a from-failed of
 * one, still under way. A completed one does not block (decided 2026-10-13).
 */
async function finalRefusal(finalOf: string, userId: string): Promise<UseCaseContinuationRefusal | null> {
  const existing = await existingContinuation(userId, { _finalOf: finalOf }, { inFlightOnly: true })
  return existing ? alreadyThere(existing, "final") : null
}

/**
 * The edit a Render final sends, as a key: its key-order-free fingerprint, or
 * "none" without one. Only the edit itself is read (never whether it applies to
 * the plan), so two different edits never share a key — at worst an edit that
 * no longer applies renders once more.
 */
export function renderFinalEditKey(edit: unknown): string {
  return edit === undefined || edit === null ? "none" : editPlanBasis(edit)
}

/**
 * A Render final with the very edit a COMPLETED final of the same preview
 * already rendered (decided 2026-10-13: a stale tab's second click): nothing
 * would change, so it is refused, naming that final. A changed edit renders.
 */
async function alreadyRenderedRefusal(finalOf: string, editKey: string, userId: string): Promise<UseCaseContinuationRefusal | null> {
  const done = await existingContinuation(userId, { _finalOf: finalOf, _finalEdit: editKey }, { completedOnly: true })
  return done ? { ok: false, status: 409, code: RENDER_FINAL_ALREADY_RENDERED, message: RENDER_FINAL_ALREADY_RENDERED_MESSAGE, jobId: done.id } : null
}

interface UseCaseRun {
  readonly row: { readonly status?: unknown }
  /** The wrapper job's input, as the run stored it. */
  readonly stored: Readonly<Record<string, unknown>>
  readonly sourceExecutionId: string
  readonly graph: StoredInlineGraph
  readonly source: ContinuationSource | null
}

/**
 * The run `jobId` names — the user's own wrapper of a run of `nodeType`, its
 * inner execution, the snapshot that execution stored and its states — or
 * null when any of them is missing or not theirs. Throws on a read error.
 */
async function loadUseCaseRun(input: { readonly nodeType: UseCaseNodeType; readonly jobId: string; readonly userId: string }): Promise<UseCaseRun | null> {
  const { data: wrapper, error } = await supabase
    .from("jobs")
    .select("id, user_id, status, provider, job_type, input_data")
    .eq("id", input.jobId)
    .maybeSingle()
  if (error) throw new Error(`use-case continue: run ${input.jobId} unreadable: ${error.message}`)
  const row = wrapper as { user_id?: unknown; status?: unknown; provider?: unknown; job_type?: unknown; input_data?: unknown } | null
  const stored = isRecord(row?.input_data) ? row.input_data : {}
  if (!row || row.user_id !== input.userId || row.provider !== "use-case" || usecaseRunType(stored, row.job_type) !== input.nodeType) return null

  // A wrapper whose stamp never landed still has its run: the run names it.
  const sourceExecutionId =
    typeof stored._executionId === "string" ? stored._executionId : await findExecutionIdForWrapper(input.jobId, input.userId)
  if (!sourceExecutionId) return null
  const graph = await loadInlineGraph(sourceExecutionId)
  if (!graph || graph.nodeType !== input.nodeType) return null
  const source = await loadContinuationSource(sourceExecutionId, {
    withStates: true,
    isRenderNode: (id) => PREVIEW_RENDER_NODE_TYPES.has(graph.nodes.find((n) => n.id === id)?.type ?? ""),
  })
  return { row, stored, sourceExecutionId, graph, source }
}

/**
 * A clip set's Render final whose review keeps no clip renders nothing: its
 * refusal, or null (another kind of run, no edit, or an edit that keeps a
 * clip). The edit is judged on the plan as planned, as the run's seed and its
 * quote read it.
 */
function nothingKeptRefusal(graph: StoredInlineGraph, source: ContinuationSource | null, edit: unknown): UseCaseContinuationRefusal | null {
  if (usecaseResultKind(graph.outputMap) !== "clips" || edit === undefined || edit === null) return null
  const kept = resolveEditPlanOutput(usecaseRunPlan(source?.nodeStates?.[graph.outputMap.planNodeId]), edit).json
  return Array.isArray(kept) && kept.length === 0 ? { ok: false, status: 409, code: USE_CASE_NOTHING_KEPT, message: USE_CASE_NOTHING_KEPT_MESSAGE } : null
}

/**
 * The same refusal for a Render final started elsewhere (an app run's, which
 * continues the run `jobId` names through the node): asked before anything is
 * written or held, so a review that kept no clip is refused up front rather
 * than failing the final once it has started. Null when the run is not found
 * (the caller's own checks answer that) or the edit keeps a clip. Only a
 * clip set can keep nothing, so a node of any other result kind is answered
 * from its type alone, before the run is read (no read on a Tighten Episode,
 * Chapters or Trailer Render final).
 */
export async function usecaseNothingKeptRefusal(input: {
  readonly nodeType: UseCaseNodeType
  readonly jobId: string
  readonly userId: string
  readonly editedEdl: unknown
}): Promise<UseCaseContinuationRefusal | null> {
  if (input.editedEdl === undefined || input.editedEdl === null) return null
  if (usecaseDescriptor(input.nodeType).resultKind !== "clips") return null
  const run = await loadUseCaseRun(input)
  return run ? nothingKeptRefusal(run.graph, run.source, input.editedEdl) : null
}

/**
 * Load the run `jobId` names and work out its continuation, or why it cannot
 * be continued. Throws on a read error (never read as "not found").
 */
export async function resolveUseCaseContinuation(input: {
  /** The type whose continue route was asked: only a run of that type is continued there. */
  readonly nodeType: UseCaseNodeType
  readonly jobId: string
  readonly userId: string
  readonly mode: UseCaseContinueMode
  readonly editedEdl?: unknown
}): Promise<UseCaseContinuation | UseCaseContinuationRefusal> {
  const run = await loadUseCaseRun(input)
  if (!run) return NOT_FOUND
  const { row, stored, sourceExecutionId, graph, source } = run

  const order = graph.nodes.map((n) => n.id)
  const finalChain = input.mode === "render-final" || stored.mode === "render-final" || stored._finalChain === true
  const identity = { userId: input.userId, workflowId: null, inlineGraphHash: graph.hash }
  // The preview run a final chain renders: this run for a Render final, the
  // one its final named for a from-failed of a final.
  const finalOf =
    input.mode === "render-final"
      ? input.jobId
      : typeof stored._finalOf === "string"
        ? stored._finalOf
        : stored.mode === "render-final" && typeof stored.sourceJobId === "string"
          ? stored.sourceJobId
          : null
  // A first-run lineage: the original run, then each continue-from-failed of
  // it, each of the one before. Every generation names the original (`_chainOf`).
  const chainOf = finalChain ? null : typeof stored._chainOf === "string" ? stored._chainOf : input.jobId
  const base = { ok: true as const, input: stored, sourceExecutionId, graph, finalChain, finalOf, chainOf }

  if (input.mode === "from-failed") {
    // A review-on run's first part resumes only up to its render.
    const scope = (finalChain ? null : initialRunNodeIds(graph)) ?? order
    const refused = continuationRefusal(source, { ...identity, nodeIds: scope, mode: "from-failed" })
    if (refused) return refusal(refused)
    // The inner run failed; its wrapper is flipped (and its fee refunded) by
    // the finaliser just after. Until it is, a new hold would sit beside the
    // old one (never a double charge — the old one is refunded — but a tight
    // balance could be refused), so the caller tries again in a moment.
    if (row.status !== "failed") {
      return IN_FLIGHT_JOB_STATUSES.includes(row.status as never)
        ? { ok: false, status: 409, code: CONTINUATION_SETTLING, message: "That run is still being settled. Try again in a moment." }
        : refusal(CONTINUATION_NOT_FAILED)
    }
    const nodeIds = fromFailedRunSet(scope, source!)
    if (nodeIds.length === 0) {
      return refusal(CONTINUATION_SUBSET_REQUIRED, "Every step of that run completed: there is nothing left to continue.")
    }
    // Only the newest generation of a lineage continues: a continue of an
    // older one (a stale page) while a newer one is under way, completed or
    // failed is refused, naming the newest — the one to continue. Cancelled
    // generations and wrappers whose run never started do not count.
    if (chainOf) {
      const newest = await existingContinuation(input.userId, { _chainOf: chainOf }, { failedToo: true, startedOnly: true })
      if (newest && newest.id !== input.jobId) return alreadyThere(newest, "continue")
    }
    // One delivery per preview run, and the same newest-generation rule over
    // every final of it (a fresh Render final after failed ones starts the
    // newest; an older failed final is not continued past it).
    if (finalChain && finalOf) {
      const newest = await existingContinuation(input.userId, { _finalOf: finalOf }, { failedToo: true, startedOnly: true })
      if (newest && newest.id !== input.jobId) return alreadyThere(newest, "final")
    }
    return {
      ...base,
      source: source!,
      nodeIds,
      feeCredits: !finalChain && typeof stored._feeCredits === "number" ? stored._feeCredits : 0,
      reviewBeforeRender: !finalChain && graph.settings.reviewBeforeRender === true,
      // A from-failed of a final renders that final's edit: it counts as it.
      ...(finalChain && typeof stored._finalEdit === "string" ? { finalEdit: stored._finalEdit } : {}),
      // Claimed on the lineage's root (a first run's) or the preview run (a final's).
      claim: finalChain && finalOf ? { rowId: finalOf, key: "_finalClaim" } : { rowId: chainOf ?? input.jobId, key: "_continuedBy" },
    }
  }

  const renderId = usecaseRenderNodeId(graph.outputMap)
  // A run that renders nothing (Chapters) has no Render final.
  if (!renderId) {
    return { ok: false, status: 409, code: RENDER_FINAL_NOT_PREVIEW, message: "This run has no preview to render final." }
  }
  const runSet = renderFinalRunSet(renderId, graph.nodes, graph.edges)
  const nodeIds = order.filter((id) => runSet.has(id))
  const refused = continuationRefusal(source, { ...identity, nodeIds })
  if (refused) return refusal(refused)
  if (row.status !== "completed") return refusal(CONTINUATION_NOT_COMPLETED)
  if (!stateHoldsPreview(source!.nodeStates?.[renderId])) {
    return {
      ok: false,
      status: 409,
      code: RENDER_FINAL_NOT_PREVIEW,
      message: "Render final follows a run that stopped at its preview; this run's render is not a preview.",
    }
  }
  const final = await finalRefusal(input.jobId, input.userId)
  if (final) return final
  const edit = input.editedEdl
  // A clip set whose review kept no clip renders nothing: refused before
  // anything is held or written.
  const nothingKept = nothingKeptRefusal(graph, source, edit)
  if (nothingKept) return nothingKept
  const finalEdit = renderFinalEditKey(edit)
  const rendered = await alreadyRenderedRefusal(input.jobId, finalEdit, input.userId)
  if (rendered) return rendered
  return {
    ...base,
    finalEdit,
    source: source!,
    nodeIds,
    inputOverrides: {
      ...renderRunOverrides(renderId, "final", runSet),
      ...(edit !== undefined && edit !== null ? { [graph.outputMap.planNodeId]: { editedEdl: edit } } : {}),
    },
    feeCredits: 0,
    reviewBeforeRender: false,
    claim: { rowId: input.jobId, key: "_finalClaim" },
  }
}
