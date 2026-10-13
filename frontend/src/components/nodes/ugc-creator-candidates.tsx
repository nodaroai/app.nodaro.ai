"use client"

import { useId } from "react"
import { Button } from "@/components/ui/button"
import { CachedImage } from "@/components/ui/cached-image"
import { useT } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import { pickUgcCreator } from "@/lib/ugc-creator-run"
import { useNodeTextDir } from "./node-text-dir"

/**
 * UGC Creator's options of a draw, side by side, for the person to pick one:
 * after a pause (two or more) or a credits stop (whatever was kept, one
 * included). Each option is labelled by its position ("Option 1", …), never by
 * what made it, and only its image is read. Shown on the node card in place
 * of its single preview, and at the top of the node's panel.
 *
 * It fits the box it is given. The card is a fixed box that clips, so there the
 * picker takes the room the card has left, each image shrinks into its tile and
 * the label and Use this one never shrink: a pick can be made on the card
 * whatever the options' shape. In the panel, whose column grows, the images
 * keep their own size. One option takes the full width.
 */
export function UgcCreatorCandidatesPicker({
  nodeId,
  candidates,
  disabled,
  onPicked,
  announce = true,
}: {
  nodeId: string
  candidates: unknown
  disabled: boolean
  /** The pick was taken: the place it was made in moves focus on (the picker itself goes). */
  onPicked?: () => void
  /** Its prompt is a status region; false where another copy of the picker already says it (the panel beside the card). */
  announce?: boolean
}) {
  const t = useT()
  // The canvas is pinned left to right; the sentence reads in the interface's direction.
  const textDir = useNodeTextDir()
  const idPrefix = useId()
  const list = Array.isArray(candidates) ? candidates : []
  if (list.length === 0) return null
  return (
    <div className="flex min-h-0 flex-1 flex-col gap-1.5" data-testid="ugc-creator-candidates">
      <p role={announce ? "status" : undefined} dir={textDir} className="shrink-0 text-[11px] text-muted-foreground">
        {t("ugc.creator.pickPrompt")}
      </p>
      <div className={cn("grid h-full min-h-0 flex-1 gap-1.5", list.length === 1 ? "grid-cols-1" : "grid-cols-2")} data-testid="ugc-creator-candidates-grid">
        {list.map((c, i) => {
          const label = t("ugc.creator.option", { n: i + 1 })
          const labelId = `${idPrefix}-option-${i}`
          const buttonId = `${idPrefix}-use-${i}`
          const url = typeof (c as { imageUrl?: unknown })?.imageUrl === "string" ? (c as { imageUrl: string }).imageUrl : undefined
          return (
            <div key={i} className="flex min-h-0 flex-col gap-1">
              {url && <CachedImage src={url} alt={label} className="h-full min-h-0 w-full flex-1 rounded object-contain" />}
              <span id={labelId} className="shrink-0 text-[11px]">
                {label}
              </span>
              <Button
                type="button"
                size="sm"
                variant="outline"
                className="nodrag shrink-0"
                id={buttonId}
                // A name of its own: the action, then the option it picks ("Use this one Option 2").
                aria-labelledby={`${buttonId} ${labelId}`}
                disabled={disabled}
                onClick={() => {
                  if (pickUgcCreator(nodeId, i)) onPicked?.()
                }}
              >
                {t("ugc.creator.useThis")}
              </Button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
