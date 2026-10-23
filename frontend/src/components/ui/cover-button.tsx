import type { MouseEvent } from "react"
import { cn } from "@/lib/utils"

/**
 * The keyboard and screen-reader control of a card that a mouse opens by
 * clicking anywhere on it, when the card also holds buttons of its own
 * (download, favourite, remove …) and so cannot itself be a button (a control
 * inside a control is lost to a screen reader, WCAG 4.1.2).
 *
 * Render it as the LAST child of the clickable card (which must be
 * `position: relative`). It covers the card to draw its focus ring over it,
 * but takes no pointer events, so the mouse keeps reaching the card and its
 * buttons exactly as before; Enter or Space on it run `onActivate` once (its
 * click does not bubble to the card's own handler). The guard test accepts a
 * clickable element whose children include a CoverButton.
 */
export function CoverButton({
  label,
  onActivate,
  className,
}: {
  readonly label: string
  readonly onActivate: () => void
  readonly className?: string
}) {
  return (
    <button
      type="button"
      aria-label={label}
      onClick={(event: MouseEvent<HTMLButtonElement>) => {
        event.stopPropagation()
        onActivate()
      }}
      className={cn(
        "pointer-events-none absolute inset-0 z-[5] rounded-[inherit] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-[#ff0073]",
        className,
      )}
    />
  )
}
