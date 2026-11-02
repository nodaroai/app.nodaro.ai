import type { CSSProperties, ReactNode } from "react"
import { cn } from "@/lib/utils"

/**
 * The drawing grammar the map's figures share, in theme tokens so the contrast
 * modes reach it: a plain box, a strong box (the accent), a dashed gate, and
 * the wires between them. A figure keeps its drawing at any width — past the
 * screen's edge it scrolls sideways, never folds into a list.
 */

export const BOX = "rounded-lg border bg-card"
export const BOX_STRONG = "rounded-lg border-2 border-primary bg-primary/10"
export const GATE = "rounded-lg border border-dashed border-amber-600/70 bg-amber-500/10 dark:border-amber-400/60"

/** A wire down, ending in an arrow head unless `bare`; `accent` draws it in the brand colour. */
export function WireDown({ height = 20, accent, bare, className, style }: { height?: number; accent?: boolean; bare?: boolean; className?: string; style?: CSSProperties }) {
  return (
    <div aria-hidden className={cn("flex flex-col items-center", className)} style={style}>
      <div className={cn("w-0.5", accent ? "bg-primary" : "bg-muted-foreground/60")} style={{ height }} />
      {!bare && (
        <svg width="10" height="6" viewBox="0 0 10 6" className={accent ? "fill-primary" : "fill-muted-foreground/80"}>
          <path d="M0 0 L5 6 L10 0 z" />
        </svg>
      )}
    </div>
  )
}

/** The bar a wire splits along, from the first of `count` columns' centre to the last's (columns `gap` px apart). */
export function Bus({ count, gap, accent }: { count: number; gap: number; accent?: boolean }) {
  if (count < 2) return null
  const inset = `calc((100% - ${(count - 1) * gap}px) / ${2 * count})`
  return <div aria-hidden className={cn("h-0.5", accent ? "bg-primary" : "bg-muted-foreground/60")} style={{ marginInline: inset }} />
}

/** `count` equal columns `gap` px apart, as the bus above them measures. */
export function Columns({ count, gap, children, className }: { count: number; gap: number; children: ReactNode; className?: string }) {
  return (
    <div className={cn("grid", className)} style={{ gridTemplateColumns: `repeat(${count}, minmax(0, 1fr))`, gap }}>
      {children}
    </div>
  )
}

/** One of the map's figures: its heading, the drawing on its canvas (scrolling past `minWidth`), and its caption. */
export function Figure({ id, heading, caption, minWidth, children }: { id: string; heading?: string; caption?: string; minWidth: number; children: ReactNode }) {
  return (
    <figure aria-labelledby={heading ? `figure-${id}` : undefined} className="space-y-2.5">
      {heading && (
        <h3 id={`figure-${id}`} className="text-[15px] font-bold">
          {heading}
        </h3>
      )}
      <div className="overflow-x-auto rounded-xl border bg-background/60 p-4">
        <div style={{ minWidth }}>{children}</div>
      </div>
      {caption && <figcaption className="max-w-[78ch] text-[13px] leading-relaxed text-muted-foreground">{caption}</figcaption>}
    </figure>
  )
}
