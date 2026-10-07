"use client"

/**
 * "Review cut" on a render's node face (A3-5; R17 a, R18 a): opens the Tighten
 * inspector at this render.
 *
 * Unlike Render final and Update preview (`RenderReviewBar`), which belong to a
 * Preview on show, this is there for ANY render with an Edit Plan cut behind it:
 * a Preview, a Final, a render set to Final with the stop rule off, a render
 * that has not run. The review is the same edit either way, and Render final
 * works without a Preview. It prices nothing, so it is cheap to leave on every
 * render card: the selector is one boolean.
 *
 * Absent where the review cannot open: no Edit Plan Tighten cut behind the
 * render (a clip set's review is the Clip Pack inspector's), or no inspector
 * host mounted (`useReviewHostMounted`).
 */
import { ScanSearch } from "lucide-react"
import { openReview, useReviewHostMounted } from "@/hooks/use-review-open-store"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { reviewEntryOf } from "@/lib/edl-review/review-entry"
import { useT } from "@/lib/i18n"
import { cn } from "@/lib/utils"

/** Can the render be reviewed? A boolean, so a drag or a run's tick re-renders nothing. */
export function useCanReviewCut(renderId: string): boolean {
  const hosted = useReviewHostMounted()
  const hasCut = useWorkflowStore((s) => reviewEntryOf(renderId, s.nodes, s.edges) !== null)
  return hosted && hasCut
}

export function ReviewCutButton({ renderId, className }: { readonly renderId: string; readonly className?: string }) {
  const t = useT()
  if (!useCanReviewCut(renderId)) return null
  return (
    <button
      type="button"
      className={cn(
        "nodrag nopan inline-flex w-full min-w-0 items-center justify-center gap-1 rounded-md border border-border bg-background px-2 py-1 text-[11px] font-medium transition-colors hover:bg-accent",
        className,
      )}
      onClick={() => openReview(renderId)}
    >
      <ScanSearch className="h-3 w-3 shrink-0" aria-hidden />
      <span className="truncate">{t("edlReview.reviewCut")}</span>
    </button>
  )
}
