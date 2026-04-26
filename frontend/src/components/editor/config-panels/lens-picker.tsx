"use client"

import { memo, useMemo, useState } from "react"
import { Search } from "lucide-react"
import { LENSES } from "@nodaro-shared/lens"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { LensPreview } from "./lens-preview"
import { useLocalizedCatalog } from "@/hooks/use-localized-entry"

interface LensPickerProps {
  readonly value: string
  readonly onValueChange: (lensId: string) => void
  readonly className?: string
}

export const LensPicker = memo(function LensPicker({
  value,
  onValueChange,
  className,
}: LensPickerProps) {
  const [query, setQuery] = useState("")
  const { resolveLabel, resolveDescription, matches } = useLocalizedCatalog("lens")

  const filtered = useMemo(() => {
    return LENSES.filter((l) => matches(l.id, l.label, l.description, query))
  }, [query, matches])

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
        <Input
          aria-label="Search lenses"
          placeholder="Search lenses"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="pl-8 h-8 text-xs"
        />
      </div>

      {filtered.length === 0 && (
        <div className="text-xs text-muted-foreground text-center py-4">
          No lenses match "{query}"
        </div>
      )}

      <div role="radiogroup" aria-label="Lens" className="grid grid-cols-3 gap-1.5">
        {filtered.map((lens) => {
          const selected = lens.id === value
          const label = resolveLabel(lens.id, lens.label)
          const description = resolveDescription(lens.id, lens.description)
          return (
            <button
              key={lens.id}
              type="button"
              role="radio"
              aria-checked={selected}
              title={description}
              onClick={() => onValueChange(lens.id)}
              className={cn(
                "group flex flex-col gap-1 p-1 rounded-lg border text-left transition-colors cursor-pointer overflow-hidden",
                selected
                  ? "border-[#ff0073] bg-[#ff0073]/10 ring-1 ring-[#ff0073]/60"
                  : "border-gray-200 dark:border-[#2D2D2D] bg-gray-50 dark:bg-[#161616] hover:border-gray-300 dark:hover:border-[#3D3D3D]",
              )}
            >
              <LensPreview lensId={lens.id} variant="hybrid" className="w-full aspect-square" />
              <span
                className={cn(
                  "text-[10.5px] font-medium leading-tight px-1 pb-0.5 text-center truncate",
                  selected ? "text-white" : "text-gray-700 dark:text-[#E2E8F0]",
                )}
              >
                {label}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
})
