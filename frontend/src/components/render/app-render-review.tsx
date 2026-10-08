"use client"

/**
 * Render final in the app runner (A6.3, decided 2026-10-04): an app run that
 * stopped at a Preview render offers its final on the render's output card,
 * on the Run tab, in Presentation and on mobile — the same `OutputCard`, under
 * this provider. The final runs as a continuation OUTSIDE the app run: charged
 * to the runner, with no creator markup.
 *
 * - `RENDER_REVIEW_TYPES` — the output cards that can carry a review: every
 *   render node (`@nodaro/shared` render registry), never a hand-kept list.
 * - `AppRenderReviewProvider` — mounted by the app runner's pages around the
 *   presentation view and the mobile shell. It reads the run on show and
 *   answers, per node: a render whose take is a Preview (Render final), one
 *   whose final is rendering, one showing its final (⇄ Show preview), or a
 *   node that WAITED for the final — whose card never falls back to the
 *   creator's snapshot output.
 * - Outside the provider (the editor's presentation tab, a present link)
 *   nothing changes. With the preview stop rule off for the deployment
 *   (`PREVIEW_STOP_RULE_ENABLED`), a render whose take is a Preview still
 *   offers Render final, as in the editor (decided 2026-10-06): no run stopped
 *   at it, so no card waits, and the final re-renders it at Final.
 */
import { createContext, useCallback, useContext, useMemo, useState, type ReactNode } from "react"
import { Pause } from "lucide-react"
import { PREVIEW_RENDER_NODE_TYPES, withRunOverrides } from "@nodaro/shared"
import { renderFinalRunSet } from "@nodaro/render-rules"
import { usePresentationStore } from "@/hooks/use-presentation-store"
import { useAppRunnerStore, type RunFinal } from "@/hooks/use-app-runner-store"
import { useRunSetCredits } from "@/hooks/use-run-from-here-credits"
import { liveExecutable } from "@/components/editor/workflow-editor/run-from-here-set"
import { runPreviewGate } from "@/components/editor/workflow-editor/preview-gate"
import { getAppExecutionStatus, type AppRunFinalExecution } from "@/lib/api"
import { hasCredits } from "@/lib/edition"
import { creditUnits } from "@/lib/credit-units"
import { useT } from "@/lib/i18n"
import { renderRunRefusalKey } from "@/lib/render-review-adapter"
import { RenderReviewBarView } from "./render-review-bar"
import type { WorkflowEdge, WorkflowNode } from "@/types/nodes"

/** The output cards that can carry a review: every render node. */
export const RENDER_REVIEW_TYPES: ReadonlySet<string> = PREVIEW_RENDER_NODE_TYPES

type RunState = { readonly status?: string; readonly output?: Readonly<Record<string, unknown>> }

/** One card's review, as the provider answers it. */
export type AppRenderReview =
  | { readonly kind: "gated" }
  | { readonly kind: "preview"; readonly renderId: string }
  | { readonly kind: "rendering"; readonly pct: number | null }
  | { readonly kind: "failed"; readonly renderId: string; readonly reason: string }
  | { readonly kind: "final"; readonly showingPreview: boolean; readonly previewUrl: string | null; readonly togglePreview: () => void }

interface AppRenderReviewValue {
  /** The run on show. */
  readonly runId: string | null
  /** Nodes that waited for Render final in the run on show. */
  readonly gatedNodeIds: ReadonlySet<string>
  readonly reviewOf: (nodeId: string, nodeType: string | undefined) => AppRenderReview | null
  /** What the run on show executes, for a final's price: its outputs over the snapshot. */
  readonly graph: readonly WorkflowNode[]
  readonly edges: readonly WorkflowEdge[]
  readonly renderFinal: (renderId: string) => void
}

const AppRenderReviewContext = createContext<AppRenderReviewValue | null>(null)

/**
 * The review of one output card, or `null` (no provider, or nothing to
 * review). `runId` names the run the card shows when a surface lists several
 * (the chat thread); a card of any run but the one on show carries no review.
 */
export function useAppRenderReview(nodeId: string, nodeType: string | undefined, runId?: string): AppRenderReview | null {
  const ctx = useContext(AppRenderReviewContext)
  if (!ctx || (runId !== undefined && runId !== ctx.runId)) return null
  return ctx.reviewOf(nodeId, nodeType)
}

/** The nodes that waited for Render final in the run on show (`null` outside the app runner). */
export function useAppRunGatedIds(): ReadonlySet<string> | null {
  return useContext(AppRenderReviewContext)?.gatedNodeIds ?? null
}

const URL_KEYS = ["videoUrl", "audioUrl", "url"] as const
const urlOf = (output: Readonly<Record<string, unknown>> | undefined): string | null => {
  for (const key of URL_KEYS) if (typeof output?.[key] === "string" && output[key]) return output[key] as string
  return null
}

/**
 * The graph a final's price is taken on: the snapshot with each node's output
 * IN THE RUN ON SHOW over its saved results — the plan the run made, not the
 * creator's — so the render is priced for the cut it will render.
 */
export function runEstimateGraph(nodes: readonly WorkflowNode[], states: Readonly<Record<string, RunState | undefined>>): WorkflowNode[] {
  return nodes.map((node) => {
    const output = states[node.id]?.status === "completed" ? states[node.id]?.output : undefined
    if (!output) return node
    const data = { ...(node.data as Record<string, unknown>) }
    if (output.json !== undefined) data.generatedJson = output.json
    if (Array.isArray(output.listResults)) data.__listResults = output.listResults
    return { ...node, data } as WorkflowNode
  })
}

interface AppRenderReviewProviderProps {
  /** The run on show; `null` for the published snapshot (nothing to review). */
  readonly runId: string | null
  /** The run's own execution (the preview), for "Show preview". */
  readonly executionId: string | null
  /** The run's final, as the run list holds it (after a reload). */
  readonly finalExecution?: AppRunFinalExecution | null
  readonly children: ReactNode
}

export function AppRenderReviewProvider({ runId, executionId, finalExecution, children }: AppRenderReviewProviderProps) {
  const nodes = usePresentationStore((s) => s.nodes)
  const edges = usePresentationStore((s) => s.edges)
  const nodeStates = usePresentationStore((s) => s.nodeStates) as Readonly<Record<string, RunState | undefined>>
  const liveFinal = useAppRunnerStore((s) => (runId ? s.runtimes[runId]?.final : undefined))
  const [shownPreview, setShownPreview] = useState<Record<string, string | null>>({})

  const gate = useMemo(() => runPreviewGate(nodes, edges, runId ? nodeStates : {}), [nodes, edges, nodeStates, runId])
  const graph = useMemo(() => runEstimateGraph(nodes, nodeStates), [nodes, nodeStates])
  const final: Pick<RunFinal, "status" | "completedNodes" | "totalNodes" | "errorMessage" | "renderNodeId"> | null = useMemo(() => {
    if (liveFinal) return liveFinal
    if (!finalExecution) return null
    const status = finalExecution.status === "completed" ? "completed" : finalExecution.status === "failed" || finalExecution.status === "cancelled" ? "failed" : "running"
    return {
      status,
      completedNodes: finalExecution.completedNodes ?? 0,
      totalNodes: finalExecution.totalNodes ?? 0,
      errorMessage: finalExecution.errorMessage,
      renderNodeId: null,
    }
  }, [liveFinal, finalExecution])

  const renderFinal = useCallback(
    (renderId: string) => {
      if (runId) void useAppRunnerStore.getState().renderFinal(runId, renderId)
    },
    [runId],
  )

  const togglePreview = useCallback(
    (renderId: string) => {
      if (renderId in shownPreview) {
        setShownPreview((prev) => {
          const next = { ...prev }
          delete next[renderId]
          return next
        })
        return
      }
      if (!executionId) return
      // The run's own execution still holds the preview the final replaced.
      void getAppExecutionStatus(executionId)
        .then((status) => {
          const state = (status.node_states as Record<string, RunState | undefined>)[renderId]
          setShownPreview((prev) => ({ ...prev, [renderId]: urlOf(state?.output) }))
        })
        .catch(() => {})
    },
    [executionId, shownPreview],
  )

  const reviewOf = useCallback(
    (nodeId: string, nodeType: string | undefined): AppRenderReview | null => {
      if (!runId) return null
      if (gate.gatedNodeIds.has(nodeId)) return { kind: "gated" }
      if (!RENDER_REVIEW_TYPES.has(nodeType ?? "")) return null
      const mine = final && (final.renderNodeId === null || final.renderNodeId === nodeId)
      if (gate.previewRenderIds.has(nodeId)) {
        if (mine && (final.status === "starting" || final.status === "running")) {
          return { kind: "rendering", pct: final.totalNodes > 0 ? Math.round((final.completedNodes / final.totalNodes) * 100) : null }
        }
        if (mine && final.status === "failed") return { kind: "failed", renderId: nodeId, reason: final.errorMessage ?? "" }
        return { kind: "preview", renderId: nodeId }
      }
      // Its take on show is the final, and this run asked for one: offer the preview it replaced.
      const take = nodeStates[nodeId]
      if (mine && final.status === "completed" && take?.status === "completed" && take.output?.quality === "final") {
        const showing = nodeId in shownPreview
        return {
          kind: "final",
          showingPreview: showing,
          previewUrl: showing ? (shownPreview[nodeId] ?? null) : null,
          togglePreview: () => togglePreview(nodeId),
        }
      }
      return null
    },
    [runId, gate, final, nodeStates, shownPreview, togglePreview],
  )

  const value = useMemo<AppRenderReviewValue>(
    () => ({ runId, gatedNodeIds: runId ? gate.gatedNodeIds : new Set<string>(), reviewOf, graph, edges, renderFinal }),
    [runId, gate, reviewOf, graph, edges, renderFinal],
  )
  return <AppRenderReviewContext.Provider value={value}>{children}</AppRenderReviewContext.Provider>
}

/** The price of a render's final: the render at Final and the nodes after it, on the run on show. */
function useAppRenderFinalCredits(renderId: string): number {
  const ctx = useContext(AppRenderReviewContext)
  const graph = ctx?.graph ?? []
  const edges = ctx?.edges ?? []
  const run = useMemo(() => {
    const set = renderFinalRunSet(renderId, graph, edges)
    if (!set.has(renderId)) return { executable: [] as WorkflowNode[], nodes: graph as WorkflowNode[] }
    const overridden = withRunOverrides(graph as WorkflowNode[], { [renderId]: { quality: "final" } })
    return { executable: liveExecutable(overridden).filter((n) => set.has(n.id)), nodes: overridden }
  }, [renderId, graph, edges])
  return useRunSetCredits(run.executable, run.nodes, edges as WorkflowEdge[])
}

/**
 * The review under a render's card: Render final (asked twice — it spends),
 * the final rendering, a failure with Render final again, or the final with
 * "Show preview".
 */
export function AppRenderReviewBar({ review }: { readonly review: AppRenderReview }) {
  const t = useT()
  const ctx = useContext(AppRenderReviewContext)
  if (review.kind === "gated" || !ctx) return null
  if (review.kind === "rendering") {
    return (
      <p className="px-1 text-xs text-muted-foreground" role="status">
        {review.pct === null ? t("appReview.renderingStart") : t("appReview.rendering", { pct: review.pct })}
      </p>
    )
  }
  if (review.kind === "final") {
    return (
      <div className="flex items-center gap-2 px-1">
        <span className="inline-flex items-center rounded-full bg-emerald-500/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-emerald-700 dark:text-emerald-400">
          {t("appReview.final")}
        </span>
        <button type="button" className="text-xs text-[#ff0073] hover:underline" onClick={review.togglePreview}>
          {review.showingPreview ? t("appReview.showFinal") : t("appReview.showPreview")}
        </button>
      </div>
    )
  }
  return <AppRenderFinalAction renderId={review.renderId} failure={review.kind === "failed" ? review.reason : null} onRender={ctx.renderFinal} />
}

function AppRenderFinalAction({
  renderId,
  failure,
  onRender,
}: {
  readonly renderId: string
  readonly failure: string | null
  readonly onRender: (renderId: string) => void
}) {
  const t = useT()
  const credits = useAppRenderFinalCredits(renderId)
  // A render that cannot run at all (Speaker View until it is priced) says so instead.
  const refusal = renderRunRefusalKey(useContext(AppRenderReviewContext)?.graph.find((n) => n.id === renderId))
  const [confirming, setConfirming] = useState(false)
  const note = t("appReview.note")
  if (!confirming || refusal) {
    return (
      <div className="flex flex-col gap-1 px-1">
        {failure && <p className="text-xs text-destructive">{t("appReview.failed", { reason: failure })}</p>}
        <RenderReviewBarView
          onRenderFinal={() => setConfirming(true)}
          finalCredits={credits}
          busy={false}
          note={note}
          {...(refusal ? { disabledReason: t(refusal) } : {})}
        />
      </div>
    )
  }
  const price = hasCredits() && credits > 0 ? t("renderFinal.confirmTitleCredits", { credits: creditUnits(credits) }) : t("renderFinal.action")
  return (
    <div className="flex flex-col gap-1 rounded-md border border-[#ff0073]/40 bg-[#ff0073]/5 p-2" role="alertdialog" aria-label={price}>
      <p className="text-xs font-medium text-foreground">{price}</p>
      <p className="text-[10px] leading-snug text-muted-foreground">{note}</p>
      <div className="flex justify-end gap-1.5">
        <button type="button" className="rounded-md border border-border px-2 py-1 text-[11px] hover:bg-accent" onClick={() => setConfirming(false)}>
          {t("common.cancel")}
        </button>
        <button
          type="button"
          className="rounded-md bg-[#ff0073] px-2 py-1 text-[11px] font-medium text-white hover:bg-[#ff0073]/90"
          onClick={() => {
            setConfirming(false)
            onRender(renderId)
          }}
        >
          {t("renderFinal.action")}
        </button>
      </div>
    </div>
  )
}

/** A card whose node waited for Render final: it says so — never the creator's snapshot output. */
export function AppGatedOutputCard({ label }: { readonly label: string }) {
  const t = useT()
  return (
    <div className="flex flex-col gap-2">
      <span className="text-xs font-medium text-foreground">{label}</span>
      <div className="flex items-center justify-center gap-1.5 rounded-lg border border-dashed border-border/60 px-3 py-6 text-center text-xs text-muted-foreground">
        <Pause className="h-3.5 w-3.5 shrink-0" aria-hidden />
        {t("appReview.waits")}
      </div>
    </div>
  )
}
