"use client"

import { memo, useMemo, useState } from "react"
import { Search } from "lucide-react"
import { STYLES } from "@nodaro-shared/style"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { StylePreview } from "./style-preview"

interface StylePickerProps {
  readonly value: string
  readonly onValueChange: (styleId: string) => void
  readonly className?: string
}

export const StylePicker = memo(function StylePicker({
  value,
  onValueChange,
  className,
}: StylePickerProps) {
  const [query, setQuery] = useState("")

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase()
    if (!q) return STYLES
    return STYLES.filter(
      (s) => s.label.toLowerCase().includes(q) || s.description.toLowerCase().includes(q),
    )
  }, [query])

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
        <Input
          aria-label="Search style"
          placeholder="Search style"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="pl-8 h-8 text-xs"
        />
      </div>

      {filtered.length === 0 && (
        <div className="text-xs text-muted-foreground text-center py-4">
          No style matches &quot;{query}&quot;
        </div>
      )}

      <div role="radiogroup" aria-label="Style" className="grid grid-cols-3 gap-1.5">
        {filtered.map((style) => {
          const selected = style.id === value
          return (
            <button
              key={style.id}
              type="button"
              role="radio"
              aria-checked={selected}
              title={style.description}
              onClick={() => onValueChange(style.id)}
              className={cn(
                "group flex flex-col gap-1 p-1 rounded-lg border text-left transition-colors cursor-pointer overflow-hidden",
                selected
                  ? "border-[#ff0073] bg-[#ff0073]/10 ring-1 ring-[#ff0073]/60"
                  : "border-gray-200 dark:border-[#2D2D2D] bg-gray-50 dark:bg-[#161616] hover:border-gray-300 dark:hover:border-[#3D3D3D]",
              )}
            >
              <StylePreview styleId={style.id} className="w-full aspect-square" />
              <span
                className={cn(
                  "text-[10.5px] font-medium leading-tight px-1 pb-0.5 text-center truncate",
                  selected ? "text-white" : "text-gray-700 dark:text-[#E2E8F0]",
                )}
              >
                {style.label}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
})
