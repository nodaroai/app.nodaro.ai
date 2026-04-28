"use client"

import { memo, useMemo, useState } from "react"
import { Search } from "lucide-react"
import { STYLES } from "@nodaro/shared"
import { Input } from "@/components/ui/input"
import { FitText } from "@/components/ui/fit-text"
import { cn } from "@/lib/utils"
import { StylePreview } from "./style-preview"
import { useLocalizedCatalog } from "@/hooks/use-localized-entry"

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
  const { resolveLabel, resolveDescription, matches } = useLocalizedCatalog("style")

  const filtered = useMemo(() => {
    return STYLES.filter((s) => matches(s.id, s.label, s.description, query))
  }, [query, matches])

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
          const label = resolveLabel(style.id, style.label)
          const description = resolveDescription(style.id, style.description)
          return (
            <button
              key={style.id}
              type="button"
              role="radio"
              aria-checked={selected}
              title={description}
              onClick={() => onValueChange(style.id)}
              className={cn(
                "group flex flex-col gap-1 p-1 rounded-lg border text-left transition-colors cursor-pointer overflow-hidden",
                selected
                  ? "border-[#ff0073] bg-[#ff0073]/10 ring-1 ring-[#ff0073]/60"
                  : "border-gray-200 dark:border-[#2D2D2D] bg-gray-50 dark:bg-[#161616] hover:border-gray-300 dark:hover:border-[#3D3D3D]",
              )}
            >
              <StylePreview styleId={style.id} className="w-full aspect-square" />
              <FitText
                text={label}
                className={cn(
                  "text-[10.5px] font-medium leading-tight px-1 pb-0.5 text-center",
                  selected ? "text-white" : "text-gray-700 dark:text-[#E2E8F0]",
                )}
              />
            </button>
          )
        })}
      </div>
    </div>
  )
})
