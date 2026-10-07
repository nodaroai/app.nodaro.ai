"use client"

/**
 * The context menu's render entries, on a render and on the Edit Plan behind it:
 * Review cut (A3-5, R17 a), Render final and Update preview (A6.1). A plan that
 * feeds several renders asks which: one entry per render, named, one render per
 * click (TA2 item 4, decided 2026-10-04).
 *
 * Review cut is there only for a Tighten cut and only where an inspector is
 * mounted (a clip set's review is the Clip Pack inspector's); Render final needs
 * the editor's run action; Update preview exists only with the stop rule on
 * (decided 2026-10-06).
 */
import { useMemo } from "react"
import { Film, RefreshCw, ScanSearch } from "lucide-react"
import { isRenderNodeType } from "@nodaro/shared"
import { openReview, useReviewHostMounted } from "@/hooks/use-review-open-store"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { reviewEntryOf } from "@/lib/edl-review/review-entry"
import { useT } from "@/lib/i18n"
import { runtimePreviewStopRule } from "@/lib/runtime-config"
import { rendersOfPlan } from "./workflow-editor/render-final-set"

const ITEM = "flex items-center gap-2 w-full px-3 py-1.5 text-sm hover:bg-accent text-start cursor-pointer disabled:opacity-50"

interface Props {
  readonly nodeId: string
  readonly nodeType: string | undefined
  readonly isRunning: boolean
  readonly onClose: () => void
}

export function RenderMenuItems({ nodeId, nodeType, isRunning, onClose }: Props) {
  const t = useT()
  const nodes = useWorkflowStore((s) => s.nodes)
  const edges = useWorkflowStore((s) => s.edges)
  const renderFinal = useWorkflowStore((s) => s.renderFinal)
  const hosted = useReviewHostMounted()
  // Update preview exists only with the stop rule on (decided 2026-10-06).
  const canUpdatePreview = runtimePreviewStopRule()

  const renders = useMemo(() => {
    if (isRenderNodeType(nodeType)) return [{ id: nodeId, name: "" }]
    if (nodeType !== "edit-plan") return []
    return rendersOfPlan(nodeId, nodes, edges).map((n) => ({
      id: n.id,
      name: ((n.data as { label?: string }).label ?? "") || n.type || "",
    }))
  }, [nodeId, nodeType, nodes, edges])
  const reviewable = useMemo(
    () => (hosted ? renders.filter((r) => reviewEntryOf(r.id, nodes, edges) !== null) : []),
    [hosted, renders, nodes, edges],
  )

  return (
    <>
      {reviewable.map((render) => (
        <button
          key={`review-${render.id}`}
          className={ITEM}
          onClick={() => {
            openReview(render.id)
            onClose()
          }}
        >
          <ScanSearch className="h-3.5 w-3.5" />
          {renders.length > 1 && render.name ? t("edlReview.reviewCutFor", { name: render.name }) : t("edlReview.reviewCut")}
        </button>
      ))}
      {renderFinal && renders.map((render) => (
        <div key={render.id}>
          <button
            className={ITEM}
            onClick={() => {
              void renderFinal(render.id, "final")
              onClose()
            }}
            disabled={isRunning}
          >
            <Film className="h-3.5 w-3.5" />
            {renders.length > 1 && render.name ? t("renderFinal.menuFor", { name: render.name }) : t("renderFinal.action")}
          </button>
          {canUpdatePreview && (
            <button
              className={ITEM}
              onClick={() => {
                void renderFinal(render.id, "proxy")
                onClose()
              }}
              disabled={isRunning}
            >
              <RefreshCw className="h-3.5 w-3.5" />
              {renders.length > 1 && render.name ? t("renderFinal.updatePreviewFor", { name: render.name }) : t("renderFinal.updatePreview")}
            </button>
          )}
        </div>
      ))}
    </>
  )
}
