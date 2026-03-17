"use client"

import { Wand2 } from "lucide-react"
import { cn } from "@/lib/utils"

interface AspectRatioOption {
  readonly value: string
  readonly label: string
}

interface AspectRatioSelectorProps {
  readonly options: readonly AspectRatioOption[]
  readonly value: string
  readonly onValueChange: (value: string) => void
  readonly className?: string
}

/** Parse W:H ratio from value or label. Returns null for non-ratio values like "Auto". */
function parseRatio(value: string, label: string): { w: number; h: number } | null {
  const fromValue = value.match(/^(\d+):(\d+)$/)
  if (fromValue) return { w: +fromValue[1], h: +fromValue[2] }
  const fromLabel = label.match(/(\d+):(\d+)/)
  if (fromLabel) return { w: +fromLabel[1], h: +fromLabel[2] }
  return null
}

/** SVG icon showing a proportional rectangle for the given aspect ratio */
function RatioIcon({ value, label }: { value: string; label: string }) {
  const ratio = parseRatio(value, label)
  if (!ratio) return <Wand2 className="w-4 h-4 shrink-0" />

  const { w, h } = ratio
  const vw = 24, vh = 18
  const scale = Math.min(vw / w, vh / h) * 0.78
  const rw = w * scale, rh = h * scale
  const x = (vw - rw) / 2, y = (vh - rh) / 2

  return (
    <svg width="24" height="18" viewBox={`0 0 ${vw} ${vh}`} className="shrink-0" aria-hidden="true">
      <rect x={x} y={y} width={rw} height={rh} rx={2} fill="none" stroke="currentColor" strokeWidth={1.5} />
    </svg>
  )
}

/** Short display text: "16:9" from value, or first word of label for non-ratio values */
function displayText(value: string, label: string): string {
  if (value.includes(":")) return value
  return label.split(" ")[0] || value
}

export function AspectRatioSelector({ options, value, onValueChange, className }: AspectRatioSelectorProps) {
  const cols = options.length <= 2 ? "grid-cols-2" : "grid-cols-3"
  return (
    <div role="radiogroup" aria-label="Aspect Ratio" className={cn("grid gap-1.5", cols, className)}>
      {options.map((opt) => {
        const selected = opt.value === value
        return (
          <button
            key={opt.value}
            type="button"
            role="radio"
            aria-checked={selected}
            onClick={() => onValueChange(opt.value)}
            title={opt.label !== opt.value ? opt.label : undefined}
            className={cn(
              "flex items-center justify-center gap-1 px-1.5 py-2 rounded-lg text-[11px] font-medium border transition-colors cursor-pointer",
              selected
                ? "border-[#ff0073] bg-[#ff0073]/10 text-white"
                : "border-gray-200 dark:border-[#2D2D2D] bg-gray-50 dark:bg-[#161616] text-gray-600 dark:text-[#94A3B8] hover:border-gray-300 dark:hover:border-[#3D3D3D] hover:text-gray-800 dark:hover:text-[#E2E8F0]",
            )}
          >
            <RatioIcon value={opt.value} label={opt.label} />
            <span>{displayText(opt.value, opt.label)}</span>
          </button>
        )
      })}
    </div>
  )
}
