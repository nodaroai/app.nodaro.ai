"use client"

import { memo, useMemo, useState } from "react"
import { Search } from "lucide-react"
import { POST_PROCESS_EFFECTS } from "@nodaro/shared"
import { Input } from "@/components/ui/input"
import { FitText } from "@/components/ui/fit-text"
import { cn } from "@/lib/utils"
import { useLocalizedCatalog } from "@/hooks/use-localized-entry"
import { MultiPickBadge, useMultiPick } from "./multi-pick-ui"

interface PostProcessEffectsPickerProps {
  readonly value: string | ReadonlyArray<string> | undefined
  readonly onValueChange: (value: string | ReadonlyArray<string> | undefined) => void
  readonly className?: string
  readonly maxSelected?: number
}

export const PostProcessEffectsPicker = memo(function PostProcessEffectsPicker({
  value,
  onValueChange,
  className,
  maxSelected = 1,
}: PostProcessEffectsPickerProps) {
  const [query, setQuery] = useState("")
  const { resolveLabel, resolveDescription, matches } = useLocalizedCatalog("post-process-effects")
  const { selectedIds, isMulti, handlePick, activateMulti, demoteToSingle } =
    useMultiPick(value, onValueChange, maxSelected)

  const filtered = useMemo(() => {
    return POST_PROCESS_EFFECTS.filter((p) => matches(p.id, p.label, p.description, query))
  }, [query, matches])

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
        <Input
          aria-label="Search post-process effect"
          placeholder="Search vignette, grain, halation, …"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="pl-8 h-8 text-xs"
        />
      </div>

      {filtered.length === 0 && (
        <div className="text-xs text-muted-foreground text-center py-4">
          No post-process effect matches &quot;{query}&quot;
        </div>
      )}

      <div role={maxSelected > 1 ? "group" : "radiogroup"} aria-label="Post-Process Effect" className="grid grid-cols-2 gap-1.5">
        {filtered.map((entry) => {
          const selectedIdx = selectedIds.indexOf(entry.id)
          const selected = selectedIdx >= 0
          const label = resolveLabel(entry.id, entry.label)
          const description = resolveDescription(entry.id, entry.description)
          return (
            <div key={entry.id} className="relative">
              <button
                type="button"
                role={maxSelected > 1 ? "checkbox" : "radio"}
                aria-checked={selected}
                title={description}
                onClick={() => handlePick(entry.id)}
                className={cn(
                  "w-full group flex flex-col items-start gap-0.5 p-2 rounded-lg border text-left transition-colors cursor-pointer overflow-hidden",
                  selected
                    ? "border-[#ff0073] bg-[#ff0073]/10 ring-1 ring-[#ff0073]/60"
                    : "border-gray-200 dark:border-[#2D2D2D] bg-gray-50 dark:bg-[#161616] hover:border-gray-300 dark:hover:border-[#3D3D3D]",
                )}
              >
                <FitText
                  text={label}
                  className={cn(
                    "text-[11.5px] font-semibold leading-tight w-full",
                    selected ? "text-white" : "text-gray-700 dark:text-[#E2E8F0]",
                  )}
                />
                <span className="text-[10px] leading-snug text-muted-foreground line-clamp-2">
                  {description}
                </span>
              </button>
              {selected && (
                <MultiPickBadge
                  mode={isMulti ? "multi" : "single"}
                  index={selectedIdx}
                  maxSelected={maxSelected}
                  onActivate={() => activateMulti(entry.id)}
                  onDemote={() => demoteToSingle(entry.id)}
                />
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
})
