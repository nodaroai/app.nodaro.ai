/**
 * The run a Render final of a use-case node continues (decided 2026-10-13):
 * the run that made the TAKE ON SHOW, only while that take is a Preview its
 * own run made (its result names that run's wrapper) and the node is neither
 * running nor failed (a failed node offers Continue instead — never both).
 * The continuation carries that run's settings (`useCaseSettings`, kept on the
 * take): a Render final renders with the PREVIEW's settings, whatever the node
 * says now. Pure, and below the UI: the editor's Render final
 * (use-case-render-final-set.ts), the node's bar and the review's footer read
 * it, so none of them can disagree.
 */
import { isUseCaseNodeType, usecaseDescriptor, type UseCaseNodeType, type UseCaseRenderFinalTarget } from "@nodaro/render-rules"
import { editPlanOutputOf } from "@/lib/edit-plan-saved-output"
import { usecaseRunSettings, usecaseTakeOnShow } from "@/lib/use-case-run-result"
import { isValidUuid } from "@/lib/uuid"

type TargetNode = { readonly type?: string | null; readonly data?: unknown }

/** A node status in which a run of the node is under way: Render final waits for it. */
const BUSY: ReadonlySet<string> = new Set(["running", "pending", "stopping"])

/** The Preview on show's own run (a real wrapper job, never a synthetic `exec-…` id) and its settings. */
function previewTakeRun(node: TargetNode | undefined): UseCaseRenderFinalTarget | undefined {
  if (!node || !isUseCaseNodeType(node.type ?? undefined)) return undefined
  const data = (node.data ?? {}) as Readonly<Record<string, unknown>>
  // A failed node offers Continue instead — never both.
  if (data.executionStatus === "failed") return undefined
  const take = usecaseTakeOnShow(data)
  if (take?.quality !== "proxy" || typeof take.jobId !== "string" || !isValidUuid(take.jobId)) return undefined
  const settings = usecaseRunSettings(data)
  return { jobId: take.jobId, ...(settings ? { settings } : {}) }
}

/** Render final is offered on `node` (it may still wait for a run under way: the bar shows it busy). */
export function usecaseRenderFinalOffered(node: TargetNode | undefined): boolean {
  return previewTakeRun(node) !== undefined
}

/**
 * The run a Render final of `node` continues NOW: the wrapper of the take on
 * show when that take is a Preview, with the settings that run was built from.
 * Undefined when there is none to continue, or while a run of the node is under way.
 */
export function usecaseRenderFinalTarget(node: TargetNode | undefined): UseCaseRenderFinalTarget | undefined {
  if (BUSY.has(String((node?.data as { executionStatus?: unknown } | undefined)?.executionStatus ?? ""))) return undefined
  return previewTakeRun(node)
}

/**
 * A clip set whose saved review keeps no clip: its Render final has nothing
 * to render (the server refuses it, `use_case_nothing_kept`, before anything
 * is held). The node's bar shows Render final disabled with
 * `renderFinal.keepOneClip`, and the handler starts nothing.
 */
export function usecaseKeepsNothing(node: TargetNode | undefined): boolean {
  if (!node || !isUseCaseNodeType(node.type ?? undefined)) return false
  if (usecaseDescriptor(node.type as UseCaseNodeType).resultKind !== "clips") return false
  const kept = editPlanOutputOf((node.data ?? {}) as Readonly<Record<string, unknown>>)?.json
  return Array.isArray(kept) && kept.length === 0
}

/** Why a use-case node's Render final cannot go ahead now, as an i18n key; undefined when it can. */
export function usecaseRenderFinalRefusalKey(node: TargetNode | undefined): "renderFinal.keepOneClip" | undefined {
  return usecaseKeepsNothing(node) ? "renderFinal.keepOneClip" : undefined
}
