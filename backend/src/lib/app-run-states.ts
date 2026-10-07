/**
 * What a runner sees of an app run, and what its Render final carries
 * (Render final in the app runner, decided 2026-10-04).
 *
 * An app run is one execution (`app_runs.execution_id`) plus the runner's own
 * edits of its results (`app_runs.node_states`, an overlay: a media edit, a
 * review of an Edit Plan's cut). Its Render final is a SECOND execution
 * (`app_runs.final_execution_id`), a continuation outside the run: every node
 * it does not run is a seed of the execution it continued, so only the nodes
 * it COMPLETED itself replace the states under it — the render's final, and
 * the nodes after it. While the final renders, or after it failed, the preview
 * stays on show (only a final that completed is laid). A later render still at Preview has its own Render final,
 * continuing from the newest final (decided 2026-10-06): the run links the
 * newest, and the view lays the chain over the run, oldest first.
 *
 * Pure: never mutates its arguments.
 */
import { isRenderNodeType } from "@nodaro/shared"
import { appRunFinalStates } from "@nodaro/render-rules"

type LooseState = { status?: unknown; output?: Record<string, unknown>; seededFromExecution?: unknown; [k: string]: unknown }

const isRecord = (v: unknown): v is Record<string, unknown> => typeof v === "object" && v !== null && !Array.isArray(v)

/**
 * The runner's edits over a run's states: per node, the edit's fields over the
 * state's, and its `output` fields over the state's output.
 */
export function mergeNodeStateEdits(execStates: unknown, editedStates: unknown): unknown {
  if (!editedStates) return execStates ?? null
  if (!execStates) return editedStates
  const base = execStates as Record<string, LooseState>
  const edits = editedStates as Record<string, LooseState>
  const merged: Record<string, LooseState> = { ...base }
  for (const [nodeId, editState] of Object.entries(edits)) {
    merged[nodeId] = {
      ...merged[nodeId],
      ...editState,
      output: { ...merged[nodeId]?.output, ...editState?.output },
    }
  }
  return merged
}

/** A final of a run's chain as a view reads it: its execution's status and states. */
export interface AppRunChainFinal {
  readonly id: string
  readonly status: string
  readonly nodeStates: unknown
}

/**
 * The finals of a run's chain (oldest first) whose results a run view lays
 * over the run: those that COMPLETED. A final that failed, was cancelled, or
 * is still rendering is walked past — its render shows the Preview under it,
 * with Render final on it — even where it completed the render before
 * something after it failed (review round 2). The app runner follows a final
 * still rendering itself, laying its results as they land.
 *
 * ONE rule with the Render final route: the next final continues from the
 * newest final laid here (`appRunFinalContinuedExecution`), so the Render final
 * a view offers is the one the route accepts.
 */
export function appRunLaidFinals<F extends AppRunChainFinal>(chain: readonly F[]): F[] {
  return chain.filter((final) => final.status === "completed")
}

/** What a run's next Render final continues: the newest final the view lays, else the run's own execution. */
export function appRunFinalContinuedExecution(chain: readonly AppRunChainFinal[], runExecutionId: string): string {
  return appRunLaidFinals(chain).at(-1)?.id ?? runExecutionId
}

/**
 * The run's states with its finals' results over them, OLDEST first
 * (`appRunFinalChain`: a chain continues from the newest final, decided
 * 2026-10-06) — only the finals that completed (`appRunLaidFinals`) — each by
 * `appRunFinalStates`, the one rule the app runner follows a final by, then
 * the runner's edits over all. A final's state replaces the one under it only
 * when that final completed the node itself, never a seed it handed on: so an
 * earlier final's result stays under a later final that seeded it.
 */
export function appRunViewStates(baseStates: unknown, finalChain: readonly AppRunChainFinal[], editedStates: unknown): unknown {
  let states = baseStates as Record<string, unknown> | null | undefined
  for (const final of appRunLaidFinals(finalChain)) states = appRunFinalStates(states, final.nodeStates)
  return mergeNodeStateEdits(states, editedStates)
}

/** Does a render's state in a run hold a Preview: its take, or a row of its batch, stamped `proxy`? */
export function stateHoldsPreview(state: unknown): boolean {
  if (!isRecord(state) || state.status !== "completed" || !isRecord(state.output)) return false
  const output = state.output
  const rows = Array.isArray(output.listResults) ? output.listResults : []
  const stamps = Array.isArray(output.listResultStamps) ? (output.listResultStamps as unknown[]) : []
  if (rows.length > 0 && stamps.some((s) => isRecord(s) && s.quality === "proxy")) return true
  return output.quality === "proxy"
}

/**
 * A review of an Edit Plan is run-result data (TA14, decided 2026-10-04). In an
 * app run it lives in the run's edits (`node_states[planId].editedEdl`), never
 * in the creator's snapshot; a Render final carries it as an override on the
 * plan, which the continuation's seed applies by its basis
 * (`resolveEditPlanOutput`) — a review of another plan is ignored.
 */
export function reviewEditOverrides(
  nodes: ReadonlyArray<{ readonly id: string; readonly type?: string | null }>,
  editedStates: unknown,
): Record<string, Record<string, unknown>> {
  const out: Record<string, Record<string, unknown>> = {}
  if (!isRecord(editedStates)) return out
  for (const node of nodes) {
    if (node.type !== "edit-plan") continue
    const edit = editedStates[node.id]
    if (isRecord(edit) && edit.editedEdl !== undefined && edit.editedEdl !== null) out[node.id] = { editedEdl: edit.editedEdl }
  }
  return out
}

/** Is this snapshot node a render a Render final can finish? */
export function isAppRenderNode(node: { readonly type?: string | null } | undefined): boolean {
  return !!node && isRenderNodeType(node.type)
}

