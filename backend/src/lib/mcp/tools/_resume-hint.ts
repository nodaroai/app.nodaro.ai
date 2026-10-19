/**
 * The one-line hint a machine client gets when a run of a SAVED workflow it
 * reads has failed (decided 2026-10-17): it can be continued from where it
 * stopped — `run_workflow` with `continue_from_execution_id` and
 * `from_failed: true` runs only the nodes that did not complete, and hands on
 * (never re-runs or re-bills) what did.
 *
 * Only for a run `run_workflow` can continue: one of a saved workflow (a
 * use-case node's inner run has no workflow, and continues through
 * `continue_use_case`) that is not an app run's — by its trigger or by its
 * app-run / Render final stamp (`/run` runs the live workflow, so a published
 * version's execution is refused there) — of a workflow
 * `run_workflow` reaches — asked by the very rule it asks
 * (`loadMcpWorkflow`), without ever creating the "mcp" project to answer.
 *
 * And only toward the run the continuation would go to — asked by the run
 * route's own lineage rule (`supersedingRunOf`): when a later continuation
 * failed, the hint names that one; when a later continuation COMPLETED all this
 * run left, the work is done and the hint names where its results are, never a
 * continuation (which would run and bill it again). When a later continuation
 * completed only PART of what was left, this run is still the one to name: the
 * route builds the continuation on that later one — unless it completed by
 * stopping at a Preview review, where a continuation would only stop there
 * again (the route answers `continuation_preview_pending`): the hint then
 * names the run that finishes it instead (`previewPendingHint`) — that run's
 * Render final (`render_final`) for a single held render, otherwise the one
 * run the route works out (lib/continuation-held-final.ts), as the
 * `run_workflow` call that sends it (`node_ids` and `inputs`). A failed lookup
 * reads as no hint: the read it rides on never fails for it.
 *
 * A failed APP run gets the hint for the app's own Retry instead
 * (`appRunRetryHint`, `retry_app_run` — POST /v1/app/:slug/runs/:runId/resume),
 * which continues it on the version it ran with the inputs it applied.
 */
import type { McpSession } from "../session.js"
import { supabase } from "../../supabase.js"
import { loadMcpWorkflow } from "./_workflow-access.js"
import { serverStamps } from "../../trigger-data-stamps.js"
import { continuationPointOf } from "../../continue-from-failed-lineage.js"
import { heldFinalRun, type HeldFinalRun } from "../../continuation-held-final.js"

/**
 * What an agent is told when the newest continuation of a run stopped at a
 * Preview review: one held render → its `render_final`; anything else (two or
 * more renders, a held review-on use-case node) → the one run that finishes
 * them together, `next` (`null`: it could not be named). `render_final` takes
 * one render, and with two Previews feeding the same node either one alone is
 * held again; a use-case node has no `render_final`, and its own continue
 * (`continue_use_case`) renders its final result without the nodes after it.
 * That run is named as the `run_workflow` call that sends it as is
 * (`runWorkflowCallFor`).
 */
export function previewPendingHint(
  workflowId: string,
  at: string,
  renderNodeIds: readonly string[],
  reviewNodeIds: readonly string[],
  next: HeldFinalRun | null | undefined,
): string {
  if (renderNodeIds.length === 1 && reviewNodeIds.length === 0) {
    const render = renderNodeIds[0]!
    return (
      `A later continuation of this run (${at}) stopped at its Preview review of the render "${render}": continuing would stop there again. ` +
      `Once the user has reviewed the preview, render its final: render_final({ workflow_id: "${workflowId}", render_node_id: "${render}", ` +
      `execution_id: "${at}" }) (it quotes the price first). A continuation after that builds on the final.`
    )
  }
  const quoted = (ids: readonly string[]) => ids.map((id) => `"${id}"`).join(", ")
  const held = [
    ...(renderNodeIds.length > 0 ? [`the renders ${quoted(renderNodeIds)}`] : []),
    ...(reviewNodeIds.length > 0 ? [`the review of ${quoted(reviewNodeIds)}`] : []),
  ].join(" and ")
  const head = `A later continuation of this run (${at}) stopped at its Preview review of ${held}: continuing would stop there again. `
  const why = `render_final takes one render (and two Previews feeding one node cannot be finished one at a time), and a use-case node has none.`
  // A held use-case node: that run calls its continue route at Final; the
  // agent's own continue_use_case first would leave the chain held.
  const alone =
    reviewNodeIds.length > 0
      ? ` For ${quoted(reviewNodeIds)} that run calls its continue route (render-final, no fee) inside the workflow, so the nodes after it run too; ` +
        `continue_use_case on its own first renders its final result but leaves this chain held, and the same final is then refused render_final_already_rendered.`
      : ""
  if (!next) return head + `Once the user has reviewed it, it is finished by one run continuing ${at} — ${why}${alone}`
  return (
    head +
    `Once the user has reviewed it, finish it in one run continuing that execution: ${runWorkflowCallFor(workflowId, next)} ` +
    `(each render at Final, each use-case node continuing the run that made its Preview, then every node after them; ` +
    `${why})${alone} A continuation after that builds on it.`
  )
}

/**
 * The `run_workflow` call that sends `next` exactly as the run route named it:
 * its execution, its nodes and its overrides (`inputs` takes the nested
 * `{ nodeId: { field: value } }` map as is), with no `from_failed`.
 */
export function runWorkflowCallFor(workflowId: string, next: HeldFinalRun): string {
  return (
    `run_workflow({ workflow_id: ${JSON.stringify(workflowId)}, continue_from_execution_id: ${JSON.stringify(next.continueFromExecutionId)}, ` +
    `node_ids: ${JSON.stringify(next.nodeIds)}, inputs: ${JSON.stringify(next.inputOverrides)} })`
  )
}

export async function resumeFailedRunHint(
  execution: {
    readonly id: unknown
    readonly status: unknown
    readonly workflow_id?: unknown
    readonly trigger_type?: unknown
    readonly trigger_data?: unknown
    readonly started_at?: unknown
  },
  session: McpSession,
): Promise<string | null> {
  if (execution.status !== "failed") return null
  const workflowId = execution.workflow_id
  if (typeof workflowId !== "string" || workflowId.length === 0) return null
  if (execution.trigger_type === "use_case") return null
  // An app run's Retry runs as `manual` but is stamped with its run, as is a
  // Render final: both ran a published version, which `/run` refuses. Stamps
  // are read only on a run a stamp-writing lane started (lib/server-started-runs.ts).
  const stamps = serverStamps(execution)
  // A Render final keeps its own path (render_final), never `/run`'s.
  if (stamps.appRenderFinal !== null) return null
  // An app run is continued by the app's own Retry.
  if (execution.trigger_type === "app_run" || stamps.appRun !== null) return appRunRetryHint(String(execution.id), session)
  let point: Awaited<ReturnType<typeof continuationPointOf>>
  type Graph = { nodes: Array<{ id: string; type?: string }>; edges: Array<{ source: string; target: string }> }
  let graph: Graph
  try {
    const reachable = await loadMcpWorkflow(session, workflowId, "view", "id, nodes, edges", { createProject: false })
    if (!reachable.ok) return null
    const { nodes, edges } = reachable.row
    graph = { nodes: Array.isArray(nodes) ? (nodes as Graph["nodes"]) : [], edges: Array.isArray(edges) ? (edges as Graph["edges"]) : [] }
    point = await continuationPointOf(
      {
        id: String(execution.id),
        startedAt: typeof execution.started_at === "string" ? execution.started_at : null,
        continueFromFailed: stamps.continueFromFailed,
      },
      { userId: session.userId, workflowId },
    )
  } catch {
    return null
  }
  if (point.kind === "preview-pending") {
    let next: HeldFinalRun | null = null
    if (!(point.renderNodeIds.length === 1 && point.reviewNodeIds.length === 0)) {
      next = await heldFinalRun({ ...point, nodes: graph.nodes, edges: graph.edges, userId: session.userId }).catch(() => null)
    }
    return previewPendingHint(workflowId, point.at, point.renderNodeIds, point.reviewNodeIds, next)
  }
  const later = point.kind === "superseded" ? point.by : null
  if (later?.status === "completed") {
    return (
      `What this run left was already done by a later continuation that completed: its results are on that run, ` +
      `get_app_run({ execution_id: "${later.executionId}" }). Do not continue this one.`
    )
  }
  if (later?.neverStarted) {
    return (
      `This run never started, so it holds nothing: continue ${later.executionId} instead, run_workflow({ workflow_id: "${workflowId}", ` +
      `continue_from_execution_id: "${later.executionId}", from_failed: true }), which runs only the nodes that did not complete.`
    )
  }
  if (later) {
    return (
      `A later run of this one holds its progress: continue that one, run_workflow({ workflow_id: "${workflowId}", ` +
      `continue_from_execution_id: "${later.executionId}", from_failed: true }), which runs only the nodes that did not complete.`
    )
  }
  return (
    `This run can be continued from where it stopped: run_workflow({ workflow_id: "${workflowId}", ` +
    `continue_from_execution_id: "${String(execution.id)}", from_failed: true }) runs only the nodes that did not complete.`
  )
}

/**
 * The hint on a failed app run: the app's Retry (`retry_app_run`), which
 * continues it from where it stopped on the version it ran, with the inputs it
 * applied — only the steps it did not complete run and are charged.
 *
 * Only for the run's CURRENT execution: the Retry always continues the
 * execution the run points at (`app_runs.execution_id`), so an execution a
 * later Retry or a start-over moved on from gets no hint. Found by that
 * pointer (the runner's own run, not archived), which also covers executions
 * from before the app-run stamp existed. The slug named is the app's latest
 * version's (a republish renames an older version's slug), and that version is
 * the one the Retry route compares by default (its `latestVersionOf`): when
 * the run ran another, the hint says so, since a plain Retry is refused then
 * (`app_run_version_changed`). A component's run, a version that is
 * gone, or a failed lookup reads as no hint.
 */
export async function appRunRetryHint(executionId: string, session: McpSession): Promise<string | null> {
  try {
    const { data: run } = await supabase
      .from("app_runs") // tenant-scope-ignore: scoped by runner_id
      .select("id, app_id")
      .eq("execution_id", executionId)
      .eq("runner_id", session.userId)
      .is("deleted_at", null)
      .limit(1)
      .maybeSingle()
    const runRow = run as { id?: unknown; app_id?: unknown } | null
    if (typeof runRow?.id !== "string" || typeof runRow.app_id !== "string") return null
    const { data: ranRow } = await supabase
      .from("published_apps")
      .select("workflow_id, slug, version, publish_type")
      .eq("id", runRow.app_id)
      .is("deleted_at", null)
      .maybeSingle()
    const ran = ranRow as { workflow_id?: unknown; slug?: unknown; version?: unknown; publish_type?: unknown } | null
    if (!ran || typeof ran.workflow_id !== "string" || ran.publish_type === "component") return null
    const { data: liveRow } = await supabase
      .from("published_apps")
      .select("slug, version")
      .eq("workflow_id", ran.workflow_id)
      .is("deleted_at", null)
      .order("version", { ascending: false })
      .limit(1)
      .maybeSingle()
    const live = liveRow as { slug?: unknown; version?: unknown } | null
    const slug = typeof live?.slug === "string" ? live.slug : typeof ran.slug === "string" ? ran.slug : null
    if (!slug) return null
    const call = (extra: string) =>
      `retry_app_run({ slug: ${JSON.stringify(slug)}, run_id: ${JSON.stringify(runRow.id)}${extra} })`
    const ranVersion = typeof ran.version === "number" ? ran.version : null
    const liveVersion = typeof live?.version === "number" ? live.version : null
    if (ranVersion !== null && liveVersion !== null && ranVersion !== liveVersion) {
      return (
        `This app run used version ${ranVersion} of the app, which is now on version ${liveVersion}, so a plain Retry is refused. ` +
        `To continue it from where it stopped on version ${ranVersion}: ${call(`, version: ${ranVersion}`)} quotes the steps and the price ` +
        `(the same call with confirm: true, once the user accepts, starts it). To run version ${liveVersion}, start over with run_app.`
      )
    }
    return (
      `This app run can be retried from where it stopped: ${call("")} quotes the steps it runs again and the price; ` +
      `the same call with confirm: true, once the user accepts, starts it (only the steps that did not complete run and are charged). ` +
      `To run with other inputs, start over with run_app.`
    )
  } catch {
    return null
  }
}
