"use client"

import { memo, useId, useMemo, useState } from "react"
import { Search } from "lucide-react"
import {
  STYLINGS,
  STYLING_DIMENSION_ORDER,
  STYLING_DIMENSION_LABELS,
  STYLING_FIELD_BY_DIMENSION,
  type Styling,
  type StylingDimension,
  type StylingValue,
} from "@nodaro-shared/styling"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { HairCutBrowser } from "./hair-cut-browser"
import { EyewearIcon, HeadwearIcon } from "./small-silhouette-icons"

interface StylingPickerProps {
  readonly value: StylingValue
  readonly onChange: (patch: Partial<StylingValue>) => void
  readonly className?: string
}

export const StylingPicker = memo(function StylingPicker({
  value,
  onChange,
  className,
}: StylingPickerProps) {
  const [query, setQuery] = useState("")

  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase()
    const byDimension = new Map<StylingDimension, Styling[]>()
    for (const styling of STYLINGS) {
      if (q && !styling.label.toLowerCase().includes(q) && !styling.description.toLowerCase().includes(q)) {
        continue
      }
      const list = byDimension.get(styling.dimension) ?? []
      list.push(styling)
      byDimension.set(styling.dimension, list)
    }
    return STYLING_DIMENSION_ORDER.map((dim) => ({
      dimension: dim,
      entries: byDimension.get(dim) ?? [],
    }))
  }, [query])

  const anyVisible = grouped.some((g) => g.entries.length > 0)

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
        <Input
          aria-label="Search styling"
          placeholder="Search styling"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="pl-8 h-8 text-xs"
        />
      </div>

      {!anyVisible && query && (
        <div className="text-xs text-muted-foreground text-center py-4">
          No styling matches &quot;{query}&quot;
        </div>
      )}

      {grouped.map(({ dimension, entries }) => {
        const field = STYLING_FIELD_BY_DIMENSION[dimension]
        const current = value[field]
        const checked = current !== undefined && current !== ""
        if (query && entries.length === 0) return null
        return (
          <DimensionSection
            key={dimension}
            dimension={dimension}
            entries={entries}
            field={field}
            checked={checked}
            current={current}
            onToggle={(next) => {
              if (next) {
                const first = STYLINGS.find((s) => s.dimension === dimension)?.id
                if (first) onChange({ [field]: first } as Partial<StylingValue>)
              } else {
                onChange({ [field]: undefined } as Partial<StylingValue>)
              }
            }}
            onPick={(id) => onChange({ [field]: id } as Partial<StylingValue>)}
          />
        )
      })}
    </div>
  )
})

interface DimensionSectionProps {
  readonly dimension: StylingDimension
  readonly entries: ReadonlyArray<Styling>
  readonly field: keyof StylingValue
  readonly checked: boolean
  readonly current: string | undefined
  readonly onToggle: (next: boolean) => void
  readonly onPick: (id: string) => void
}

function DimensionSection({
  dimension,
  entries,
  field,
  checked,
  current,
  onToggle,
  onPick,
}: DimensionSectionProps) {
  const id = useId()
  const label = STYLING_DIMENSION_LABELS[dimension]
  // Hair-cut has 45 entries — use the modal browser so the list doesn't
  // dominate the config panel.
  const useBrowser = dimension === "hair-cut"
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2 px-0.5">
        <input
          type="checkbox"
          id={`${id}-${field}`}
          checked={checked}
          onChange={(e) => onToggle(e.target.checked)}
          className="rounded border-muted-foreground/40"
        />
        <label
          htmlFor={`${id}-${field}`}
          className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground select-none cursor-pointer"
        >
          {label}
        </label>
      </div>
      {useBrowser ? (
        <div className={cn("transition-opacity", !checked && "opacity-40")}>
          <HairCutBrowser
            value={checked ? current : undefined}
            onChange={(id) => {
              if (id) onPick(id)
              else onToggle(false)
            }}
          />
        </div>
      ) : (
        <div
          role="radiogroup"
          aria-label={label}
          className={cn("grid grid-cols-3 gap-1.5 transition-opacity", !checked && "opacity-40")}
        >
          {entries.map((entry) => {
            const selected = checked && entry.id === current
            const eyewearIcon = dimension === "eyewear" ? <EyewearIcon eyewearId={entry.id} className="size-6" /> : null
            const headwearIcon = dimension === "headwear" ? <HeadwearIcon headwearId={entry.id} className="size-6" /> : null
            return (
              <button
                key={entry.id}
                type="button"
                role="radio"
                aria-checked={selected}
                title={checked ? entry.description : `${entry.description} (click to enable ${label})`}
                onClick={() => onPick(entry.id)}
                className={cn(
                  "flex flex-col items-center justify-center gap-1 px-2 py-2 rounded-lg border text-center transition-colors cursor-pointer overflow-hidden",
                  selected
                    ? "border-[#ff0073] bg-[#ff0073]/10 ring-1 ring-[#ff0073]/60"
                    : "border-gray-200 dark:border-[#2D2D2D] bg-gray-50 dark:bg-[#161616] hover:border-gray-300 dark:hover:border-[#3D3D3D]",
                )}
              >
                {eyewearIcon}
                {headwearIcon}
                <span
                  className={cn(
                    "text-[11px] font-medium leading-tight truncate max-w-full",
                    selected ? "text-[#ff0073]" : "text-gray-700 dark:text-[#E2E8F0]",
                  )}
                >
                  {entry.label}
                </span>
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
