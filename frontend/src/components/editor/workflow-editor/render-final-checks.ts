/**
 * What Render final checks before it saves and bills (spec §6 item 12). Three
 * pure-as-possible checks, each answering one question:
 *
 *  - `renderRuleVerdict` (TA1 a): will Apply EDL's own rule refuse what this
 *    render would send? The same verdict the render's badge shows, with the
 *    EDL the canvas holds NOW (an Edit Plan's review applied). In multicam the
 *    render reads Camera Switch's SAVED, pre-edit EDL, because the real final
 *    re-runs Camera Switch: this check can only judge what is saved, and a
 *    plan the re-run switch turns into something the rule refuses is found by
 *    the run, not here.
 *  - `newerRunPatches` (TA3 c): did a run end that this canvas does not show?
 *    It asks the reopen lane's own question (`restoreEndedEditorRun`) of the
 *    newest ended editor run, so "newer" means exactly what reopening loads —
 *    a node that only passed saved data through, one cleared since, one a later
 *    single-node run settled and one already showing the run all stay as they
 *    are — and reports what loading would change on the render's EDL path.
 *  - `finalIsUnchanged` (TA15 a): would this Render final send what the last
 *    final was made from? No plan hash is stamped; the final take's job is
 *    fetched and its stored effective EDL is compared with the one the render
 *    would send now. Anything unknowable (no final take, no stored EDL, a
 *    failed fetch, a render behind Camera Switch) answers "changed": it fails
 *    open, so the person is never asked a question the editor cannot answer.
 */
import { buildEffectiveEdl } from "@nodaro/render-rules"
import { editPlanBasis, renderPlanClipKey, renderPlanPath, type RenderGraphEdge } from "@nodaro/shared"
import type { GeneratedResult, WorkflowEdge, WorkflowNode } from "@/types/nodes"
import { applyEdlRendersValidity, NO_EDL } from "@/lib/edl-validity"
import { applyEdlRenderSettings, resolveApplyEdlRenders } from "@/lib/apply-edl-render-input"
import { edlPathIds, type ListedRun } from "./newer-run-review"
import { extractNodeOutputAsList } from "./node-input-resolver"

// ── TA1 (a): Apply EDL's rule ───────────────────────────────────────────────

export type RenderRuleVerdict = { readonly ok: true } | { readonly ok: false; readonly issues: readonly string[] }

/** The render rule's verdict on every render a run of this node makes now. */
export function renderRuleVerdict(
  renderId: string,
  nodes: readonly WorkflowNode[],
  edges: readonly WorkflowEdge[],
): RenderRuleVerdict {
  const node = nodes.find((n) => n.id === renderId)
  if (!node) return { ok: false, issues: [NO_EDL] }
  const renders = resolveApplyEdlRenders(node, nodes, edges)
  const verdict = applyEdlRendersValidity(renders, applyEdlRenderSettings(node.data as Record<string, unknown>))
  // Nothing to judge is nothing to render: the run itself refuses a render with no EDL.
  if (!verdict) return { ok: false, issues: [NO_EDL] }
  return verdict.ok ? { ok: true } : { ok: false, issues: verdict.issues }
}

// ── TA3 (c): a newer run ────────────────────────────────────────────────────

/** The reopen lane's landing of an ended run, injected so this stays a pure module. */
export type RestoreEndedRun = (
  nodes: WorkflowNode[],
  edges: readonly WorkflowEdge[],
  run: ListedRun,
  rows: readonly ListedRun[],
) => WorkflowNode[]

/**
 * The nodes on the render's EDL path whose data loading the newest ended
 * editor run would change, as `{ nodeId: newData }`; empty when the canvas
 * shows that run (or there is none). The run is chosen as the reopen lane
 * chooses it: the newest orchestrated (`manual`) row.
 */
export function newerRunPatches(
  nodes: readonly WorkflowNode[],
  edges: readonly WorkflowEdge[],
  rows: readonly ListedRun[],
  restore: RestoreEndedRun,
): Record<string, WorkflowNode["data"]> {
  const run = rows.find((r) => r.triggerType === "manual")
  if (!run || Object.keys(run.nodeStates ?? {}).length === 0) return {}
  const after = new Map(restore([...nodes], edges, run, rows).map((n) => [n.id, n]))
  const path = edlPathIds(nodes, edges)
  const patches: Record<string, WorkflowNode["data"]> = {}
  for (const node of nodes) {
    if (!path.has(node.id)) continue
    const next = after.get(node.id)
    if (next && JSON.stringify(next.data) !== JSON.stringify(node.data)) patches[node.id] = next.data
  }
  return patches
}

// ── TA15 (a): nothing changed since the last final ──────────────────────────

/** What a finished apply-edl job stored of its request (`GET /v1/jobs/:id`). */
export interface FinalJob {
  readonly input_data?: Readonly<Record<string, unknown>> | null
}

const isBlank = (v: unknown): boolean => v === undefined || v === null || (typeof v === "string" && !v.trim())

/** The key-order-free fingerprint of a value (the shared canonical hash). */
const same = (a: unknown, b: unknown): boolean => editPlanBasis(a) === editPlanBasis(b)

/**
 * Does every render this Render final would make send exactly what its last
 * final was made from? The last final of a render is the newest take that is
 * stamped final — for a clip set, the newest stamped final of the same plan
 * clip (`clipKey`).
 */
export async function finalIsUnchanged(
  renderId: string,
  nodes: readonly WorkflowNode[],
  edges: readonly WorkflowEdge[],
  getJob: (jobId: string) => Promise<FinalJob>,
): Promise<boolean> {
  try {
    const node = nodes.find((n) => n.id === renderId)
    if (!node) return false
    const path = renderPlanPath(renderId, nodes, edges as readonly RenderGraphEdge[])
    // Behind Camera Switch the real final re-runs the switch: what the canvas
    // holds is its pre-edit EDL, which says nothing about this final.
    if (path && path.hops.length > 1) return false
    const data = node.data as Record<string, unknown>
    const settings = applyEdlRenderSettings(data)
    const takes = (Array.isArray(data.generatedResults) ? data.generatedResults : []) as readonly GeneratedResult[]
    const renders = resolveApplyEdlRenders(node, nodes, edges)
    if (renders.length === 0) return false
    for (const render of renders) {
      if (isBlank(render.edl)) return false
      const clipKey = renderPlanClipKey(
        renderId,
        nodes,
        edges as readonly RenderGraphEdge[],
        (planNode) => extractNodeOutputAsList(planNode as WorkflowNode, "edl"),
        render.row,
      )
      const last = takes.find(
        (t) => t.quality === "final" && !!t.jobId && (clipKey === undefined || t.clipKey === clipKey),
      )
      if (!last) return false
      const stored = (await getJob(last.jobId)).input_data
      if (!stored || stored.edl === undefined || stored.edl === null) return false
      const raw = typeof render.edl === "string" ? JSON.parse(render.edl) : render.edl
      const effective = buildEffectiveEdl(raw, { crossfadeMs: settings.crossfadeMs, sourceOverrides: render.sources })
      if (!same(stored.edl, effective)) return false
      if ((stored.output === "audio" ? "audio" : "video") !== settings.output) return false
    }
    return true
  } catch {
    return false
  }
}
