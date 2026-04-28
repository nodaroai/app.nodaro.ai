"use client"

import { memo, useMemo, useState } from "react"
import { Search } from "lucide-react"
import { ATMOSPHERES } from "@nodaro/shared"
import { Input } from "@/components/ui/input"
import { FitText } from "@/components/ui/fit-text"
import { cn } from "@/lib/utils"
import { AtmospherePreview } from "./atmosphere-preview"
import { useLocalizedCatalog } from "@/hooks/use-localized-entry"
import { MultiPickBadge, useMultiPick } from "./multi-pick-ui"

interface AtmospherePickerProps {
  readonly value: string | ReadonlyArray<string> | undefined
  readonly onValueChange: (value: string | ReadonlyArray<string> | undefined) => void
  readonly className?: string
  readonly maxSelected?: number
}

export const AtmospherePicker = memo(function AtmospherePicker({
  value,
  onValueChange,
  className,
  maxSelected = 1,
}: AtmospherePickerProps) {
  const [query, setQuery] = useState("")
  const { resolveLabel, resolveDescription, matches } = useLocalizedCatalog("atmosphere")
  const { selectedIds, isMulti, handlePick, activateMulti, demoteToSingle } =
    useMultiPick(value, onValueChange, maxSelected)

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

      <div role={maxSelected > 1 ? "group" : "radiogroup"} aria-label="Atmosphere" className="grid grid-cols-3 gap-1.5">
        {filtered.map((atmosphere) => {
          const selectedIdx = selectedIds.indexOf(atmosphere.id)
          const selected = selectedIdx >= 0
          const label = resolveLabel(atmosphere.id, atmosphere.label)
          const description = resolveDescription(atmosphere.id, atmosphere.description)
          return (
            <div key={atmosphere.id} className="relative">
              <button
                type="button"
                role={maxSelected > 1 ? "checkbox" : "radio"}
                aria-checked={selected}
                title={description}
                onClick={() => handlePick(atmosphere.id)}
                className={cn(
                  "w-full group flex flex-col gap-1 p-1 rounded-lg border text-left transition-colors cursor-pointer overflow-hidden",
                  selected
                    ? "border-[#ff0073] bg-[#ff0073]/10 ring-1 ring-[#ff0073]/60"
                    : "border-gray-200 dark:border-[#2D2D2D] bg-gray-50 dark:bg-[#161616] hover:border-gray-300 dark:hover:border-[#3D3D3D]",
                )}
              >
                <AtmospherePreview atmosphereId={atmosphere.id} className="w-full aspect-square" />
                <FitText
                  text={label}
                  className={cn(
                    "text-[10.5px] font-medium leading-tight px-1 pb-0.5 text-center",
                    selected ? "text-white" : "text-gray-700 dark:text-[#E2E8F0]",
                  )}
                />
              </button>
              {selected && (
                <MultiPickBadge
                  mode={isMulti ? "multi" : "single"}
                  index={selectedIdx}
                  maxSelected={maxSelected}
                  onActivate={() => activateMulti(atmosphere.id)}
                  onDemote={() => demoteToSingle(atmosphere.id)}
                />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
})
