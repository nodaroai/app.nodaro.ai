"use client"

import { useLayoutEffect, useRef, type ReactNode } from "react"
import { cn } from "@/lib/utils"

/**
 * Single-line label that shrinks its own font-size when the text would
 * overflow its container, down to a minimum (default 8px). When the text
 * still doesn't fit at min size, the browser handles overflow normally
 * (we add `truncate` so a clean ellipsis appears as the last-resort fallback).
 *
 * Replaces the bare `<span className="... truncate">{label}</span>` pattern in
 * picker tiles where ellipsis was hiding meaningful text. Especially helpful
 * for translated labels that are longer than the English source.
 *
 * Listens to ResizeObserver on the parent so re-fits when the picker grid
 * reflows (e.g. the user resizes the config panel).
 */
export function FitText({
  text,
  className,
  minFontSize = 8,
}: {
  readonly text: ReactNode
  readonly className?: string
  /** Floor for shrinking, in px. Below this we let `truncate` ellipsize. */
  readonly minFontSize?: number
}) {
  const ref = useRef<HTMLSpanElement>(null)
  const textKey = typeof text === "string" ? text : ""

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return

    let rafId: number | null = null

    const fit = () => {
      // Reset to inherited size before measuring so we always start fresh.
      el.style.fontSize = ""
      const baseSize = parseFloat(getComputedStyle(el).fontSize)
      if (!Number.isFinite(baseSize) || baseSize <= 0) return
      el.style.fontSize = `${baseSize}px`
      if (el.scrollWidth <= el.clientWidth + 0.5) return
      // Binary search: converges in O(log n) instead of O(n) linear steps.
      let lo = minFontSize
      let hi = baseSize
      while (hi - lo > 0.5) {
        const mid = (lo + hi) / 2
        el.style.fontSize = `${mid}px`
        if (el.scrollWidth <= el.clientWidth + 0.5) {
          lo = mid
        } else {
          hi = mid
        }
      }
      el.style.fontSize = `${lo}px`
    }

    const scheduleFit = () => {
      if (rafId !== null) return
      rafId = requestAnimationFrame(() => {
        rafId = null
        fit()
      })
    }

    scheduleFit()

    // Re-fit on container resize. Observe the closest sized ancestor (parent
    // tile / chip), since that's what bounds the label's clientWidth.
    const parent = el.parentElement
    if (!parent || typeof ResizeObserver === "undefined") return
    const ro = new ResizeObserver(scheduleFit)
    ro.observe(parent)
    return () => {
      ro.disconnect()
      if (rafId !== null) {
        cancelAnimationFrame(rafId)
        rafId = null
      }
    }
  }, [textKey, minFontSize])

  return (
    <span
      ref={ref}
      className={cn("inline-block max-w-full whitespace-nowrap overflow-hidden text-ellipsis", className)}
    >
      {text}
    </span>
  )
}
