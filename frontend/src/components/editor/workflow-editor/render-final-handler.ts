/**
 * Render final and Update preview (Track A6.1, TA17–TA19, decided 2026-10-04):
 * one run of the review's render set — `renderFinalRunSet`: the render, what
 * follows it, and (in multicam) Camera Switch before it — with the render's
 * quality overridden for THIS run only. Render final overrides it to `final`,
 * Update preview to `proxy`; the node keeps its own setting, so the toolbar
 * Run always previews and Render final always renders the final.
 *
 * It is a run from here with a few more duties, all before any node is touched:
 *
 *  1. Apply EDL's rule on what the render would send (TA1 a);
 *  2. a newer run the canvas does not show (TA3 c): the final would otherwise
 *     bill an older plan (newer-run-check.ts, the review inspector's check too).
 *     It waits 15 s at most, with every render's run buttons disabled (the
 *     lock below drops any other click meanwhile) and the clicked one busy
 *     (`renderCheck`), then goes ahead with a warning (decided 2026-10-07).
 *     A newer run that answers
 *     later still stops the run up to its submission (`runWorkflow`), never
 *     after;
 *  3. Render final only: nothing changed since the last final (TA15 a), which
 *     asks first rather than refuses;
 *  4. the run's confirm, priced on the overridden graph — never the canvas,
 *     where the render still reads Preview (it would gate the tail and quote
 *     less than the run bills). It itemises the run per node, names what is
 *     kept as is, (Update preview) what waits for this Render final and what
 *     waits for another Preview render's own (U1).
 *
 * Then the SAVE, which must succeed: the server runs from the saved workflow,
 * so an unsaved review would render the unedited plan.
 *
 * A guard test (`preview-gate-sites.test.ts`) holds this file to the stop rule:
 * its set is built from the overridden graph and taken through
 * `previewRunnable`.
 */
import { PREVIEW_RENDER_NODE_TYPES, withRunOverrides } from "@nodaro/shared"
import { toast } from "sonner"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { getJobStatus, runWorkflow, WorkflowAlreadyRunningError, withDedupRaceRetry } from "@/lib/api"
import { generateIdempotencyKey } from "@/lib/idempotency-key"
import { tx } from "@/lib/i18n"
import { NO_EDL } from "@/lib/edl-validity"
import { runtimePreviewStopRule } from "@/lib/runtime-config"
import type { ExecutionContext } from "./types"
import { collapseExpandedClones } from "./execution-graph"
import { rejectAllManualEdits } from "./execute-node"
import { ensureVideoLinksBeforeRun } from "./video-link-run-gate"
import { previewRunnable } from "./preview-gate"
import { liveExecutable } from "./run-from-here-set"
import { renderFinalRunSet, renderRunOverrides } from "./render-final-set"
import { finalIsUnchanged, renderRuleVerdict } from "./render-final-checks"
import { NEWER_RUN_UNCHECKED, refuseForNewerRun, startNewerRunCheck, type NewerRunCheck } from "./newer-run-check"
import {
  attachToRunningExecution,
  clearConnectedListRows,
  confirmRunOrAbort,
  hasActiveWorkflowStream,
  refuseWhileReadOnly,
  resetNodeAccumulation,
  streamBackendExecution,
  warnUnderMinRows,
} from "./run-handlers"

export type RenderRunKind = "final" | "proxy"

let _renderFinalLock = false

/** How many of the rule's issues the toast spells out. */
const ISSUES_SHOWN = 3

function ruleRefusalText(issues: readonly string[]): string {
  if (issues.length === 1 && issues[0] === NO_EDL) return tx("renderFinal.noEdl")
  const shown = issues.slice(0, ISSUES_SHOWN).join("; ")
  return tx("renderFinal.ruleRefusal", { issues: issues.length > ISSUES_SHOWN ? `${shown}; …` : shown })
}

/** The click's newer-run check has answered "newer" by now (in time or late): refuse. */
function refusedLate(check: NewerRunCheck): boolean {
  const late = check.answer()
  if (!late) return false
  refuseForNewerRun(late)
  return true
}

/** A save that came back refused (`SaveResult`), as opposed to one that did not say. */
const saveFailed = (result: unknown): boolean =>
  typeof result === "object" && result !== null && (result as { success?: unknown }).success === false

export async function handleRenderFinal(
  renderId: string,
  kind: RenderRunKind,
  ctx: ExecutionContext,
  projectId: string | undefined,
  save: (pid: string) => Promise<unknown>,
  setIsRunning: (v: boolean) => void,
  onExecutionStarted?: (id: string) => void,
  onExecutionEnded?: () => void,
): Promise<void> {
  if (_renderFinalLock) return
  // Update preview is the stop rule's own partner: with the rollout flag off
  // (decided 2026-10-06) it is hidden everywhere, and a call that reaches
  // here anyway would run a Preview AND the tail that consumes it. Render
  // final stays: with the flag off it re-renders at Final.
  if (kind === "proxy" && !runtimePreviewStopRule()) return
  if (hasActiveWorkflowStream()) {
    toast.info(tx("renderFinal.inProgress"))
    return
  }
  _renderFinalLock = true
  try {
    let check: NewerRunCheck
    const st = useWorkflowStore.getState()
    const render = st.nodes.find((n) => n.id === renderId)
    if (!render || !PREVIEW_RENDER_NODE_TYPES.has(render.type ?? "")) return
    const workflowId = st.workflowId
    if (!workflowId) {
      toast.error(tx("run.saveBeforeRunning"))
      return
    }

    // The run as it will be: the render at the overridden quality. EVERY check
    // and price below reads this graph, not the canvas.
    {
      const runSet = renderFinalRunSet(renderId, st.nodes, st.edges)
      const overridden = withRunOverrides(st.nodes, renderRunOverrides(renderId, kind, runSet))
      const exec = liveExecutable(overridden).filter((n) => runSet.has(n.id))

      const verdict = renderRuleVerdict(renderId, st.nodes, st.edges)
      if (!verdict.ok) {
        toast.error(ruleRefusalText(verdict.issues))
        return
      }
      check = startNewerRunCheck(workflowId, st.nodes, st.edges)
      st.setRenderCheck({ renderId, kind })
      let newer: Awaited<NewerRunCheck["withinLimit"]>
      try {
        newer = await check.withinLimit
      } finally {
        useWorkflowStore.getState().setRenderCheck(null)
      }
      if (newer === NEWER_RUN_UNCHECKED) toast.warning(tx("renderFinal.newerUnchecked"))
      else if (newer) {
        refuseForNewerRun(newer)
        return
      }
      if (kind === "final" && ctx.askConfirm) {
        // The canvas may have moved while the listing was out: ask about what it holds now.
        const now = useWorkflowStore.getState()
        if (await finalIsUnchanged(renderId, now.nodes, now.edges, getJobStatus)) {
          const proceed = await ctx.askConfirm({
            title: tx("renderFinal.unchangedTitle"),
            body: tx("renderFinal.unchangedBody"),
            confirmLabel: tx("renderFinal.unchangedConfirm"),
          })
          if (!proceed) return
        }
      }
      if (!(await confirmRunOrAbort(ctx, exec, overridden, st.edges, kind === "final" ? "render-final" : "update-preview", kind === "final", false, renderId))) return
      if (!(await ensureVideoLinksBeforeRun(exec.map((n) => n.id), setIsRunning))) return
    }
    // A newer run that answered late, while the confirms were open.
    if (refusedLate(check)) return
    if (refuseWhileReadOnly()) return
    rejectAllManualEdits()
    const { nodes, edges } = collapseExpandedClones()
    if (!nodes.some((n) => n.id === renderId)) return
    clearConnectedListRows(nodes)

    const runSet = renderFinalRunSet(renderId, nodes, edges)
    const overrides = renderRunOverrides(renderId, kind, runSet)
    const overridden = withRunOverrides(nodes, overrides)
    warnUnderMinRows(nodes.filter((n) => runSet.has(n.id)))
    // The stop rule's closure never runs: never reset, flipped or counted. For
    // Render final the render reads Final, so nothing is gated.
    const runnableIds = new Set(
      previewRunnable(liveExecutable(overridden).filter((n) => runSet.has(n.id)), overridden, edges).map((n) => n.id),
    )
    if (runnableIds.size === 0) {
      toast.error(tx("run.noExecutableDownstream"))
      return
    }
    const executableNodes = nodes.filter((n) => runnableIds.has(n.id))
    const executableIds = executableNodes.map((n) => n.id)

    const wasDirty = useWorkflowStore.getState().isDirty
    // Without a project there is nowhere to save an unsaved review to.
    if (wasDirty && !projectId) {
      toast.error(tx("renderFinal.saveFailed"))
      return
    }

    const undoReset = resetNodeAccumulation(executableNodes, { preserveHistory: true })
    const { markNodesStatus } = useWorkflowStore.getState()
    markNodesStatus(executableIds, "pending")
    setIsRunning(true)

    // The save MUST succeed: the server renders from the saved workflow, so a
    // review that is not saved is a final of the unedited plan.
    if (wasDirty && projectId) {
      let saved: unknown
      try {
        saved = await save(projectId)
      } catch {
        saved = { success: false }
      }
      if (saveFailed(saved)) {
        // Nothing ran: the render's Preview batch (and every cleared list
        // state) goes back, or the next autosave would persist the loss.
        undoReset()
        setIsRunning(false)
        markNodesStatus(executableIds, undefined)
        toast.error(tx("renderFinal.saveFailed"))
        return
      }
    }

    // The last point a late answer counts: the run is not submitted yet.
    if (refusedLate(check)) {
      undoReset()
      setIsRunning(false)
      markNodesStatus(executableIds, undefined)
      return
    }

    toast.info(tx(kind === "final" ? "renderFinal.toastFinal" : "renderFinal.toastPreview"), {
      description: tx("run.nodesToRun", { count: executableNodes.length }),
    })

    try {
      const idempotencyKey = generateIdempotencyKey()
      const result = await withDedupRaceRetry(() =>
        runWorkflow(workflowId, [...runSet], idempotencyKey, { inputOverrides: overrides }),
      )
      onExecutionStarted?.(result.executionId)
      streamBackendExecution(result.executionId, ctx, setIsRunning, onExecutionEnded)
    } catch (err: unknown) {
      if (err instanceof WorkflowAlreadyRunningError) {
        toast.info(tx("renderFinal.inProgress"))
        onExecutionStarted?.(err.executionId)
        void attachToRunningExecution(err.executionId, ctx, setIsRunning, onExecutionEnded, () => markNodesStatus(executableIds, undefined))
        return
      }
      setIsRunning(false)
      markNodesStatus(executableIds, undefined)
      toast.error(tx("run.failedToStartExecution"), {
        description: err instanceof Error ? err.message : tx("run.unknownError"),
      })
    }
  } finally {
    _renderFinalLock = false
  }
}
