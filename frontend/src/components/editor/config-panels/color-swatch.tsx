"use client"

import { cn } from "@/lib/utils"
import type { SwatchValue } from "./color-swatches"

/**
 * Tiny coloured circle used as visual hint next to color-dimension entries
 * (hair-color, skin-tone, eye-color). Uses `background` rather than
 * `background-color` so gradient swatches (salt-and-pepper, dyed, hazel)
 * render correctly.
 */
export function ColorSwatch({
  value,
  className,
}: {
  readonly value: SwatchValue
  readonly className?: string
}) {
  const bg = "solid" in value ? value.solid : value.gradient
  return (
    <span
      aria-hidden
      className={cn(
        "inline-block rounded-full border border-black/20 dark:border-white/20 shadow-inner shrink-0",
        className,
      )}
      style={{ background: bg }}
    />
  )
}
