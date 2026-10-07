"use client"

/**
 * "Edited since this preview" under a Preview on a render's node face (A3-5,
 * U1): the Edit Plan's review changed after the Preview on show was cut, so
 * what plays is not the cut Render final would make. The review inspector says
 * the same in its stale-preview banner; both read one rule
 * (`lib/edl-review/face-staleness.ts`).
 *
 * Mount it only under a Preview that is on show: it reads the render's
 * upstream canvas, which a render that shows no Preview has no use for.
 */
import { TriangleAlert } from "lucide-react"
import { useEditedSincePreview } from "@/hooks/use-edited-since-preview"
import { useT } from "@/lib/i18n"

export function EditedSincePreviewNote({ renderId }: { readonly renderId: string }) {
  const t = useT()
  if (!useEditedSincePreview(renderId)) return null
  return (
    <p role="status" className="flex items-center gap-1 text-[10px] leading-snug text-amber-600 dark:text-amber-400">
      <TriangleAlert className="h-3 w-3 shrink-0" aria-hidden />
      <span>{t("edlReview.editedSincePreview")}</span>
    </p>
  )
}
