"use client"

import { memo, useMemo, useState } from "react"
import { Search } from "lucide-react"
import { POST_PROCESS_EFFECTS } from "@nodaro-shared/post-process-effects"
import { pickIds, togglePick } from "@nodaro-shared/multi-pick"
import { Input } from "@/components/ui/input"
import { FitText } from "@/components/ui/fit-text"
import { cn } from "@/lib/utils"
import { useLocalizedCatalog } from "@/hooks/use-localized-entry"

interface PostProcessEffectsPickerProps {
  readonly value: string | ReadonlyArray<string>
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
  const selectedIds = useMemo(() => pickIds(value), [value])

  const handlePick = (id: string) => {
    if (maxSelected <= 1) {
      onValueChange(selectedIds[0] === id ? undefined : id)
      return
    }
    const next = togglePick(selectedIds, id, maxSelected)
    if (next.length === 0) onValueChange(undefined)
    else if (next.length === 1) onValueChange(next[0])
    else onValueChange(next)
  }

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
            <button
              key={entry.id}
              type="button"
              role={maxSelected > 1 ? "checkbox" : "radio"}
              aria-checked={selected}
              title={description}
              onClick={() => handlePick(entry.id)}
              className={cn(
                "relative group flex flex-col items-start gap-0.5 p-2 rounded-lg border text-left transition-colors cursor-pointer overflow-hidden",
                selected
                  ? "border-[#ff0073] bg-[#ff0073]/10 ring-1 ring-[#ff0073]/60"
                  : "border-gray-200 dark:border-[#2D2D2D] bg-gray-50 dark:bg-[#161616] hover:border-gray-300 dark:hover:border-[#3D3D3D]",
              )}
            >
              {maxSelected > 1 && selected && (
                <span
                  className="absolute top-1 right-1 size-4 rounded-full bg-[#ff0073] text-white text-[9px] font-semibold flex items-center justify-center pointer-events-none"
                  aria-hidden="true"
                >
                  {selectedIdx + 1}
                </span>
              )}
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
          )
        })}
      </div>
    </div>
  )
})
