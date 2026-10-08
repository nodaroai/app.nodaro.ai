"use client"

/**
 * The context menu's render entries, on a render and on the Edit Plan behind it:
 * Review cut, or Review clips for a clip set (A3-5, A4-2; R17 a), Render final and Update preview (A6.1). A plan that
 * feeds several renders asks which: one entry per render, named, one render per
 * click (TA2 item 4, decided 2026-10-04).
 *
 * The review entry is there only where an inspector is mounted and the plan is
 * a Tighten cut or a clip set; Render final needs
 * the editor's run action; Update preview exists only with the stop rule on
 * (decided 2026-10-06).
 */
import { useMemo } from "react"
import { Film, RefreshCw, ScanSearch } from "lucide-react"
import { isRenderNodeType } from "@nodaro/shared"
import { openReview, useReviewHostMounted } from "@/hooks/use-review-open-store"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { reviewKindOf } from "@/lib/edl-review/review-entry"
import { renderRunRefusalKey } from "@/lib/render-review-adapter"
import { useT, type TFunction } from "@/lib/i18n"
import { runtimePreviewStopRule } from "@/lib/runtime-config"
import { rendersOfPlan } from "./workflow-editor/render-final-set"

const ITEM = "flex items-center gap-2 w-full px-3 py-1.5 text-sm hover:bg-accent text-start cursor-pointer disabled:opacity-50"

interface Props {
  readonly nodeId: string
  readonly nodeType: string | undefined
  readonly isRunning: boolean
  readonly onClose: () => void
}

/** "Review cut" / "Review clips", named after the render when the plan feeds several. */
function reviewLabel(kind: "edl" | "clips", name: string | null, t: TFunction): string {
  if (kind === "clips") return name ? t("edlReview.reviewClipsFor", { name }) : t("edlReview.reviewClips")
  return name ? t("edlReview.reviewCutFor", { name }) : t("edlReview.reviewCut")
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
    const refusalOf = (id: string) => renderRunRefusalKey(nodes.find((n) => n.id === id))
    if (isRenderNodeType(nodeType)) return [{ id: nodeId, name: "", refusal: refusalOf(nodeId) }]
    if (nodeType !== "edit-plan") return []
    return rendersOfPlan(nodeId, nodes, edges).map((n) => ({
      id: n.id,
      name: ((n.data as { label?: string }).label ?? "") || n.type || "",
      refusal: refusalOf(n.id),
    }))
  }, [nodeId, nodeType, nodes, edges])
  const reviewable = useMemo(
    () => (hosted ? renders.flatMap((r) => {
      const kind = reviewKindOf(r.id, nodes, edges)
      return kind ? [{ ...r, kind }] : []
    }) : []),
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
          {reviewLabel(render.kind, renders.length > 1 && render.name ? render.name : null, t)}
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
            // A render that cannot run at all (Speaker View until it is priced) says why.
            disabled={isRunning || !!render.refusal}
            title={render.refusal ? t(render.refusal) : undefined}
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
              disabled={isRunning || !!render.refusal}
              title={render.refusal ? t(render.refusal) : undefined}
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
