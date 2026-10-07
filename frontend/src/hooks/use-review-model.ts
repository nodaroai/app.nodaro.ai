/**
 * The review inspector's model of one render (§2.1 of the inspectors design,
 * A3-2): everything it shows that does not depend on the reviewer's K,
 * assembled from the canvas. K itself is `useReviewEdits`'; the gate and the
 * take's freshness, which read the not-yet-written K, are `useReviewChecks`'.
 *
 *  - The plan: the Edit Plan behind the render's `edl` wire (`renderPlanPath`),
 *    its planner's EDL (`generatedJson`, never the resolved one) as `base`, and
 *    whether it can be edited here (`isReviewableBase`; otherwise read-only).
 *  - The seed K: the applied edit's segments, else the plan's own. An edit made
 *    on an earlier plan (`stale`) is ignored, and says so.
 *  - The transcript (R5 a, decided 2026-10-06): the value on the Edit Plan's
 *    `transcript` wire, resolved by the editor's input resolver. None means
 *    Cuts-only mode. Never fetched.
 *  - The render's settings and its wired Sources media, as its badge reads them.
 *  - The take on display (`savedRenderOutput`), and the newest Preview take
 *    when the one on display is not a Preview.
 *  - `locked` (R9 a): the canvas is read-only, or a live run includes the
 *    render or its Edit Plan. Playback and find stay live; edits do not.
 *  - The newer run (TA3 c), asked once per open: `undefined` while the answer
 *    is out, `null` when the canvas shows the newest run.
 *
 * It reads the canvas through `useReviewGraph`: the render and what feeds it,
 * held until a value the review reads changes, so a run's progress ticks and
 * edits beside the render do not rebuild it. The transcript and the sources,
 * the costly reads (each stringifies a long value), also ignore the plan's own
 * `editedEdl`, which the review rewrites as the reviewer edits. Only `locked`
 * reads run state, from the live store.
 */
import { useCallback, useEffect, useMemo, useState } from "react"
import {
  editPlanBasis,
  normalizeEdl,
  normalizeTranscript,
  renderPlanPath,
  renderResultStamp,
  resolveEditPlanOutput,
  savedRenderOutput,
  type Edl,
  type EditPlanEditStatus,
  type RenderGraphEdge,
  type RenderPlanPath,
  type SavedRenderItem,
  type Transcript,
  TRANSIENT_RUNTIME_KEYS,
} from "@nodaro/shared"
import type { ApplyEdlIssue } from "@nodaro/render-rules"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { showsARunInFlight } from "@/hooks/workflow-access-mode"
import { useReviewGraph } from "@/hooks/use-review-graph"
import type { IgnoredKeys } from "@/lib/edl-review/review-graph"
import { applyEdlRenderSettings, resolveApplyEdlRenders } from "@/lib/apply-edl-render-input"
import { isReviewableBase } from "@/lib/edl-review/build-edited"
import { keptSetOf, type KeptSet } from "@/lib/edl-review/kept-set"
import { buildParagraphs, type Paragraph } from "@/lib/edl-review/paragraphs"
import { planIssues, type ReviewRenderContext } from "@/lib/edl-review/restore"
import { transcriptOffsetMs } from "@/lib/edl-review/word-index"
import { resolveNodeInputs } from "@/components/editor/workflow-editor/node-input-resolver"
import { applyNewerRun, newerRunOnServer, type NewerRunPatches } from "@/components/editor/workflow-editor/newer-run-check"
import type { WorkflowEdge, WorkflowNode } from "@/types/nodes"

/** What the Edit Plan behind the render holds. */
export type ReviewPlanKind = "edl" | "clips" | "other" | "none"

export interface ReviewModel {
  readonly renderId: string
  readonly renderExists: boolean
  readonly path: RenderPlanPath | null
  readonly planId: string | null
  /** The plan as stored (`generatedJson`): what an edit's basis is taken of. */
  readonly plan: unknown
  readonly planKind: ReviewPlanKind
  /** The planner's EDL, normalized; null unless the plan is a Tighten EDL. */
  readonly base: Edl | null
  /** `editPlanBasis` of the stored plan; null with no plan. */
  readonly basis: string | null
  readonly reviewable: boolean
  readonly editStatus: EditPlanEditStatus
  /** K to open with: the applied edit's, else the plan's. Null when not reviewable. */
  readonly seedKept: KeptSet | null
  readonly render: ReviewRenderContext
  /** Null: Cuts-only mode (no transcript on the plan's wire). */
  readonly transcript: Transcript | null
  readonly offsetMs: number
  readonly paragraphs: readonly Paragraph[]
  /** The render rule's findings on the plan as received: its own refusal, never a lock. */
  readonly planProblems: readonly ApplyEdlIssue[]
  readonly take: SavedRenderItem | undefined
  /** The newest Preview take, when the take on display is not one. */
  readonly previewTake: SavedRenderItem | undefined
  /** The render reads the plan through another node (Camera Switch). */
  readonly passesOtherNodes: boolean
  readonly locked: boolean
  /** A newer run's changes; `undefined` while the check is out, `null` when there is none. */
  readonly newerRun: NewerRunPatches | null | undefined
  readonly loadNewerRun: () => void
}

const EMPTY_SOURCES: readonly string[] = []

/** Run state, and on the plan also the review's own edit (`editedEdl`). */
const RUN_STATE_AND_EDIT: ReadonlySet<string> = new Set([...TRANSIENT_RUNTIME_KEYS, "editedEdl"])
const ignoringEditOn = (planId: string | null): IgnoredKeys => (id) =>
  id === planId ? RUN_STATE_AND_EDIT : TRANSIENT_RUNTIME_KEYS

function planKindOf(plan: unknown): ReviewPlanKind {
  if (plan === undefined || plan === null) return "none"
  if (Array.isArray(plan)) return "clips"
  if (typeof plan === "object" && Array.isArray((plan as { segments?: unknown }).segments)) return "edl"
  return "other"
}

function baseOf(plan: unknown): Edl | null {
  if (planKindOf(plan) !== "edl") return null
  try {
    return normalizeEdl(plan)
  } catch {
    return null
  }
}

/** The wired transcript, parsed; null when none (or it holds no words). */
function transcriptOf(text: string | undefined): Transcript | null {
  if (!text) return null
  try {
    const transcript = normalizeTranscript(JSON.parse(text))
    return transcript.words.length > 0 ? transcript : null
  } catch {
    return null
  }
}

/** The newest take stamped Preview, as a saved item. */
function newestPreview(data: Readonly<Record<string, unknown>>): SavedRenderItem | undefined {
  const results = Array.isArray(data.generatedResults) ? (data.generatedResults as Array<Record<string, unknown>>) : []
  const entry = results.find((r) => r?.quality === "proxy" && typeof r.url === "string" && r.url.length > 0)
  if (!entry) return undefined
  const jobId = typeof entry.jobId === "string" && entry.jobId ? entry.jobId : undefined
  const thumbnailUrl = typeof entry.thumbnailUrl === "string" && entry.thumbnailUrl ? entry.thumbnailUrl : undefined
  return {
    url: entry.url as string,
    medium: data.output === "audio" ? "audio" : "video",
    ...(jobId ? { jobId } : {}),
    ...(thumbnailUrl ? { thumbnailUrl } : {}),
    ...renderResultStamp(entry),
  }
}

export function useReviewModel(renderId: string): ReviewModel {
  const { nodes, edges } = useReviewGraph(renderId)
  const workflowId = useWorkflowStore((s) => s.workflowId)

  const renderNode = nodes.find((n) => n.id === renderId)
  const path = useMemo(() => renderPlanPath(renderId, nodes, edges as readonly RenderGraphEdge[]), [renderId, nodes, edges])
  const planId = path?.planId ?? null
  const planNode = planId ? nodes.find((n) => n.id === planId) : undefined
  // The transcript and the sources do not change when the review writes its edit.
  const ignoreEdit = useMemo(() => ignoringEditOn(planId), [planId])
  const inputs = useReviewGraph(renderId, ignoreEdit)
  const planData = planNode?.data as Readonly<Record<string, unknown>> | undefined
  const plan = planData?.generatedJson
  const editedEdl = planData?.editedEdl

  const base = useMemo(() => baseOf(plan), [plan])
  const basis = useMemo(() => (plan === undefined ? null : editPlanBasis(plan)), [plan])
  const reviewable = base ? isReviewableBase(base) : false
  const editStatus = useMemo<EditPlanEditStatus>(
    () => (plan === undefined ? "none" : resolveEditPlanOutput(plan, editedEdl).status),
    [plan, editedEdl],
  )
  const seedKept = useMemo(() => {
    if (!base || !reviewable) return null
    const edit = editedEdl as { kind?: unknown; edl?: { segments?: unknown } } | undefined
    if (editStatus === "applied" && edit?.kind === "edl" && Array.isArray(edit.edl?.segments)) {
      return keptSetOf({ ...base, segments: edit.edl.segments as Edl["segments"] })
    }
    return keptSetOf(base)
  }, [base, reviewable, editStatus, editedEdl])

  const renderData = (renderNode?.data ?? {}) as Readonly<Record<string, unknown>>
  const settings = applyEdlRenderSettings(renderData)
  const sourcesKey = useMemo(() => {
    const render = inputs.nodes.find((n) => n.id === renderId)
    if (!render) return "[]"
    const first = resolveApplyEdlRenders(render, inputs.nodes, inputs.edges)[0]
    return JSON.stringify(first?.sources ?? EMPTY_SOURCES)
  }, [renderId, inputs])
  const render = useMemo<ReviewRenderContext>(
    () => ({ output: settings.output, crossfadeMs: settings.crossfadeMs, sources: JSON.parse(sourcesKey) as string[] }),
    [settings.output, settings.crossfadeMs, sourcesKey],
  )

  const transcriptText = useMemo(() => {
    const plan = planId ? inputs.nodes.find((n) => n.id === planId) : undefined
    return plan ? resolveNodeInputs(plan, inputs.nodes as WorkflowNode[], inputs.edges as WorkflowEdge[]).transcript : undefined
  }, [planId, inputs])
  const transcript = useMemo(() => transcriptOf(transcriptText), [transcriptText])
  const offsetMs = base && transcript ? transcriptOffsetMs(base, transcript) : 0
  const paragraphs = useMemo(() => (transcript ? buildParagraphs(transcript) : []), [transcript])
  const planProblems = useMemo(() => (base && reviewable ? planIssues(base, render) : []), [base, reviewable, render])

  const take = useMemo(() => (renderNode ? savedRenderOutput(renderData) : undefined), [renderNode, renderData])
  const previewTake = useMemo(
    () => (take && take.quality !== "proxy" ? newestPreview(renderData) : undefined),
    [take, renderData],
  )

  // Run state: read live, never from the held snapshot.
  const locked = useWorkflowStore(
    (s) => s.isReadOnly || s.nodes.some((n) => (n.id === renderId || n.id === planId) && showsARunInFlight(n)),
  )

  const checkKey = workflowId ? `${workflowId}\u0000${renderId}` : null
  const [newer, setNewer] = useState<{ readonly key: string; readonly patches: NewerRunPatches | null } | null>(null)
  useEffect(() => {
    if (!checkKey || !workflowId) return
    let live = true
    const now = useWorkflowStore.getState()
    void newerRunOnServer(workflowId, now.nodes, now.edges).then((patches) => {
      if (live) setNewer({ key: checkKey, patches })
    })
    return () => {
      live = false
    }
  }, [checkKey, workflowId])
  const newerRun = !checkKey ? null : newer?.key === checkKey ? newer.patches : undefined
  const loadNewerRun = useCallback(() => {
    if (!checkKey || newer?.key !== checkKey || !newer.patches) return
    applyNewerRun(newer.patches)
    setNewer({ key: checkKey, patches: null })
  }, [checkKey, newer])

  return {
    renderId,
    renderExists: !!renderNode,
    path: path ?? null,
    planId,
    plan,
    planKind: planKindOf(plan),
    base,
    basis,
    reviewable,
    editStatus,
    seedKept,
    render,
    transcript,
    offsetMs,
    paragraphs,
    planProblems,
    take,
    previewTake,
    passesOtherNodes: !!path && path.hops.length > 1,
    locked,
    newerRun,
    loadNewerRun,
  }
}
