import { useState } from "react"
import { MODEL_MAKERS } from "@nodaro/shared/model-catalog"
import { cn } from "@/lib/utils"
import { modelMakerIdFor } from "@/lib/model-search"
import { useMakerLogoUrls } from "@/hooks/use-maker-logos"

/**
 * The mark of the company that made a model, for a picker row or trigger:
 * the image this instance publishes for that maker, or the maker's initial
 * when it publishes none (or the image fails to load). Nothing for a model
 * the catalog does not know. Decorative — the row's label already names the
 * model — so it is hidden from screen readers and named in a tooltip.
 *
 * The published marks are drawn for a dark surface (single-color marks are
 * white), so on the light theme the mark sits on a small dark chip.
 */
export function MakerMark({ modelId, className }: { modelId: string; className?: string }) {
  const makerId = modelMakerIdFor(modelId)
  const url = useMakerLogoUrls().get(makerId ?? "")
  const [failed, setFailed] = useState<string | null>(null)
  if (!makerId) return null
  const name = MODEL_MAKERS[makerId].name
  const showImage = url !== undefined && failed !== url

  return (
    <span
      title={name}
      aria-hidden
      className={cn(
        "inline-flex size-4 shrink-0 items-center justify-center rounded-[4px] bg-neutral-900",
        showImage ? "dark:bg-transparent" : "text-[11px] font-semibold leading-none text-white dark:bg-muted dark:text-muted-foreground",
        className,
      )}
    >
      {showImage ? (
        <img src={url} alt="" className="size-3 object-contain" loading="lazy" onError={() => setFailed(url)} />
      ) : (
        name.charAt(0)
      )}
    </span>
  )
}
