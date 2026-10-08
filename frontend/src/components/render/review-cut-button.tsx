"use client"

/**
 * "Review cut" (or "Review clips", for a clip set: A4-2) on a render's node
 * face (A3-5; R17 a, R18 a): opens the review inspector at this render — the
 * cut review for a Tighten EDL, the Clip Pack inspector for a clip set.
 *
 * Unlike Render final and Update preview (`RenderReviewBar`), which belong to a
 * Preview on show, this is there for ANY render with an Edit Plan cut behind it:
 * a Preview, a Final, a render set to Final with the stop rule off, a render
 * that has not run. The review is the same edit either way, and Render final
 * works without a Preview. It prices nothing, so it is cheap to leave on every
 * render card: the selector is one boolean.
 *
 * Absent where the review cannot open: no Edit Plan cut or clip set behind the
 * render, or no inspector host mounted (`useReviewHostMounted`).
 */
import { ScanSearch } from "lucide-react"
import { openReview, useReviewHostMounted } from "@/hooks/use-review-open-store"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { reviewKindOf, type ReviewKind } from "@/lib/edl-review/review-entry"
import { useT } from "@/lib/i18n"
import { cn } from "@/lib/utils"

/** Which review the render opens, or null where none can. A string, so a drag or a run's tick re-renders nothing. */
export function useReviewKind(renderId: string): ReviewKind | null {
  const hosted = useReviewHostMounted()
  const kind = useWorkflowStore((s) => reviewKindOf(renderId, s.nodes, s.edges))
  return hosted ? kind : null
}

export function ReviewCutButton({ renderId, className }: { readonly renderId: string; readonly className?: string }) {
  const t = useT()
  const kind = useReviewKind(renderId)
  if (!kind) return null
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
      <span className="truncate">{t(kind === "clips" ? "edlReview.reviewClips" : "edlReview.reviewCut")}</span>
    </button>
  )
}
