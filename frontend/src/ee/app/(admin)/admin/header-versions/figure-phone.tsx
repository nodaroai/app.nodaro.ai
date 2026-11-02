import type { CSSProperties, ReactNode } from "react"
import { cn } from "@/lib/utils"
import { Figure } from "./figure-parts"
import { ACCENT_TEXT } from "./product-icon"
import type { PhoneBand, PhoneFigure } from "./types"

/**
 * "How the header shares a phone screen": a phone, top to bottom — the
 * header, the page, the product's own action bar (amber), the header's bottom
 * bar (the accent) — the heights the header publishes measured on one side,
 * and on the other how far the product lifts the accessibility button. Drawn
 * on a fixed canvas, in pixels of the drawing (not of a phone).
 */

const W = 760
const H = 560
/** The phone's screen, inside its frame. */
const SCREEN = { start: 262, width: 236 }
const HEADER = { top: 40, height: 52 }
const PRODUCT_BAR = { top: 370, height: 64 }
const BOTTOM_BAR = { top: 434, height: 86 }
const A11Y = { centre: 346, size: 32 }

function At({ start, top, width, height, className, children }: { start: number; top: number; width?: number; height?: number; className?: string; children?: ReactNode }) {
  const style: CSSProperties = { insetInlineStart: start, top, width, height }
  return (
    <div className={cn("absolute", className)} style={style}>
      {children}
    </div>
  )
}

/** A measure: a line between two ticks, from `top` to `top + height`. */
function Bracket({ at, top, height, accent }: { at: number; top: number; height: number; accent?: boolean }) {
  const ink = accent ? "bg-primary" : "bg-muted-foreground/70"
  return (
    <At start={at - 6} top={top} width={12} height={height} className="flex flex-col items-center">
      <div className={cn("h-0.5 w-full", ink)} />
      <div className={cn("w-0.5 flex-1", ink)} />
      <div className={cn("h-0.5 w-full", ink)} />
    </At>
  )
}

/** The words beside a measure: the property's name and what it means. */
function MeasureLabel({ start, top, width, end, measure, note }: { start: number; top: number; width: number; end?: boolean; measure?: string; note?: string }) {
  return (
    <At start={start} top={top} width={width} className={cn("text-xs", end && "text-end")}>
      {measure && <div className={cn("font-mono", ACCENT_TEXT)}>{measure}</div>}
      {note && <div className="text-muted-foreground">{note}</div>}
    </At>
  )
}

function Band({ band, top, height, className }: { band: PhoneBand; top: number; height: number; className: string }) {
  return (
    <At start={SCREEN.start} top={top} width={SCREEN.width} height={height} className={cn("flex flex-col items-center justify-center rounded-md border px-2 text-center", className)}>
      <div className="text-[13px]">{band.name}</div>
      {band.detail && <div className="text-xs text-muted-foreground">{band.detail}</div>}
    </At>
  )
}

export function PhoneFigureView({ figure }: { figure: PhoneFigure }) {
  const { header, page, productBar, bottomBar, a11y } = figure
  return (
    <Figure id="phone" heading={figure.heading} caption={figure.caption} minWidth={W}>
      <div className="relative mx-auto" style={{ width: W, height: H }}>
        <At start={250} top={20} width={260} height={520} className="rounded-[30px] border-2 border-foreground/70 bg-background" />
        <Band band={header} top={HEADER.top} height={HEADER.height} className="bg-card" />
        <At start={SCREEN.start} top={230} width={SCREEN.width} className="text-center text-sm text-muted-foreground">
          {page.name}
        </At>
        <Band band={productBar} top={PRODUCT_BAR.top} height={PRODUCT_BAR.height} className="border-amber-600/70 bg-amber-500/15" />
        <Band band={bottomBar} top={BOTTOM_BAR.top} height={BOTTOM_BAR.height} className="border-primary bg-primary/10" />
        <At
          start={470 - A11Y.size / 2}
          top={A11Y.centre - A11Y.size / 2}
          width={A11Y.size}
          height={A11Y.size}
          className="flex items-center justify-center rounded-full bg-blue-600 text-[13px] text-white"
        >
          <span aria-label="Accessibility button">♿︎</span>
        </At>

        {/* What the header publishes, on the start side. */}
        <Bracket at={236} top={HEADER.top} height={HEADER.height} />
        <MeasureLabel start={20} top={HEADER.top + 4} width={206} end measure={header.measure} note={header.note} />
        <Bracket at={236} top={BOTTOM_BAR.top} height={BOTTOM_BAR.height} />
        <MeasureLabel start={20} top={BOTTOM_BAR.top + 18} width={206} end measure={bottomBar.measure} note={bottomBar.note} />
        <Bracket at={200} top={PRODUCT_BAR.top} height={PRODUCT_BAR.height} />
        <MeasureLabel start={20} top={PRODUCT_BAR.top + 14} width={170} end measure={productBar.measure} note={productBar.note} />

        {/* What the product lifts, on the end side. */}
        <Bracket at={526} top={A11Y.centre} height={BOTTOM_BAR.top - A11Y.centre} accent />
        <MeasureLabel start={540} top={A11Y.centre + 14} width={210} measure={a11y.measure} note={a11y.note} />
      </div>
    </Figure>
  )
}
