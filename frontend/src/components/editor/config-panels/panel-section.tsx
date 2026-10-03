// frontend/src/components/editor/config-panels/panel-section.tsx
"use client"

import { useState, type ReactNode } from "react"
import { ChevronDown, ChevronRight } from "lucide-react"
import { Label } from "@/components/ui/label"
import { Slider } from "@/components/ui/slider"
import { useAppDir } from "@/lib/locale-store"
import { cn } from "@/lib/utils"
import type { OverlayAnchor } from "@nodaro/shared"

/** The 3×3 anchor picker's cells, laid out like the frame. */
export const ANCHOR_GRID: ReadonlyArray<ReadonlyArray<OverlayAnchor>> = [
  ["top-left", "top", "top-right"],
  ["left", "center", "right"],
  ["bottom-left", "bottom", "bottom-right"],
]

/** " ≈ 240px" beside a percentage, when the total it is a percentage of is known. */
export function pctPx(pct: number, total: number | undefined): string {
  return total ? ` ≈ ${Math.round((pct / 100) * total)}px` : ""
}

/** A labelled slider with its value (and an optional unit / pixel hint) on the right. */
export function PctSlider({
  id, label, value, min, max, step = 1, onChange, hint,
}: {
  id: string; label: string; value: number; min: number; max: number; step?: number
  onChange: (v: number) => void; hint?: string
}) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <Label htmlFor={id} className="text-xs">{label}</Label>
        <span className="text-[10px] tabular-nums text-muted-foreground">{value}{hint ?? ""}</span>
      </div>
      <Slider id={id} value={[value]} min={min} max={max} step={step} onValueChange={([v]) => onChange(v)} />
    </div>
  )
}

/**
 * A foldable group of controls inside a config panel card. Open ones read
 * top-down; a folded one shows a one-line summary, so a panel can hold many
 * layers without becoming a wall of controls. Shared by the Image Overlay and
 * Video Overlay layer editors.
 */
export function Section({ title, summary, defaultOpen = true, children }: { title: string; summary?: string; defaultOpen?: boolean; children: ReactNode }) {
  const [open, setOpen] = useState(defaultOpen)
  const isRtl = useAppDir() === "rtl"
  return (
    <section className="rounded-md border border-border/60">
      <button
        type="button"
        className="w-full flex items-center gap-1.5 px-2 py-1.5 text-start"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
      >
        {open ? <ChevronDown className="w-3 h-3 text-muted-foreground" aria-hidden /> : <ChevronRight className={cn("w-3 h-3 text-muted-foreground", isRtl && "rotate-180")} aria-hidden />}
        <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{title}</span>
        {!open && summary && <span className="ms-auto text-[10px] text-muted-foreground truncate">{summary}</span>}
      </button>
      {open && <div className="px-2 pb-2 space-y-2">{children}</div>}
    </section>
  )
}

/** The 3×3 anchor picker as a radiogroup (the anchor-grid precedent). */
export function AnchorGrid({ value, label, onChange }: { value: OverlayAnchor; label: string; onChange: (a: OverlayAnchor) => void }) {
  return (
    <div className="grid grid-cols-3 gap-1 w-24 mt-1" role="radiogroup" aria-label={label}>
      {ANCHOR_GRID.flat().map((a) => (
        <button
          key={a}
          type="button"
          role="radio"
          aria-checked={value === a}
          aria-label={a}
          title={a}
          className={`h-6 rounded border ${value === a ? "bg-[#ff0073] border-[#ff0073]" : "bg-muted/40 border-border/60 hover:bg-muted"}`}
          onClick={() => onChange(a)}
        />
      ))}
    </div>
  )
}
