"use client"

import { memo, useMemo, useState } from "react"
import { Search } from "lucide-react"
import { ATMOSPHERES } from "@nodaro-shared/atmosphere"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { AtmospherePreview } from "./atmosphere-preview"
import { useLocalizedCatalog } from "@/hooks/use-localized-entry"

interface AtmospherePickerProps {
  readonly value: string
  readonly onValueChange: (atmosphereId: string) => void
  readonly className?: string
}

export const AtmospherePicker = memo(function AtmospherePicker({
  value,
  onValueChange,
  className,
}: AtmospherePickerProps) {
  const [query, setQuery] = useState("")
  const { resolveLabel, resolveDescription, matches } = useLocalizedCatalog("atmosphere")

  const filtered = useMemo(() => {
    return ATMOSPHERES.filter((a) => matches(a.id, a.label, a.description, query))
  }, [query, matches])

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
        <Input
          aria-label="Search atmosphere"
          placeholder="Search atmosphere"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="pl-8 h-8 text-xs"
        />
      </div>

      {filtered.length === 0 && (
        <div className="text-xs text-muted-foreground text-center py-4">
          No atmosphere matches "{query}"
        </div>
      )}

      <div role="radiogroup" aria-label="Atmosphere" className="grid grid-cols-3 gap-1.5">
        {filtered.map((atmosphere) => {
          const selected = atmosphere.id === value
          const label = resolveLabel(atmosphere.id, atmosphere.label)
          const description = resolveDescription(atmosphere.id, atmosphere.description)
          return (
            <button
              key={atmosphere.id}
              type="button"
              role="radio"
              aria-checked={selected}
              title={description}
              onClick={() => onValueChange(atmosphere.id)}
              className={cn(
                "group flex flex-col gap-1 p-1 rounded-lg border text-left transition-colors cursor-pointer overflow-hidden",
                selected
                  ? "border-[#ff0073] bg-[#ff0073]/10 ring-1 ring-[#ff0073]/60"
                  : "border-gray-200 dark:border-[#2D2D2D] bg-gray-50 dark:bg-[#161616] hover:border-gray-300 dark:hover:border-[#3D3D3D]",
              )}
            >
              <AtmospherePreview atmosphereId={atmosphere.id} className="w-full aspect-square" />
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
