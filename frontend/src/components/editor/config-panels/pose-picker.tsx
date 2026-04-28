"use client"

import { memo, useMemo, useState } from "react"
import { Search } from "lucide-react"
import {
  POSES,
  POSE_CATEGORY_LABELS,
  POSE_CATEGORY_ORDER,
  type Pose,
  type PoseCategory,
} from "@nodaro/shared"
import { Input } from "@/components/ui/input"
import { FitText } from "@/components/ui/fit-text"
import { cn } from "@/lib/utils"
import { useLocalizedCatalog } from "@/hooks/use-localized-entry"

interface PosePickerProps {
  readonly value: string
  readonly onValueChange: (poseId: string) => void
  readonly className?: string
}

/**
 * Single-select pose picker: user picks ONE pose / action from the
 * 27-entry catalog, grouped by category (Standing / Seated / Movement /
 * Action / Resting). Search filters across label + description.
 */
export const PosePicker = memo(function PosePicker({
  value,
  onValueChange,
  className,
}: PosePickerProps) {
  const [query, setQuery] = useState("")
  const { resolveLabel, resolveDescription, matches } = useLocalizedCatalog("pose")

  const grouped = useMemo(() => {
    const byCategory = new Map<PoseCategory, Pose[]>()
    for (const pose of POSES) {
      if (!matches(pose.id, pose.label, pose.description, query)) {
        continue
      }
      const list = byCategory.get(pose.category) ?? []
      list.push(pose)
      byCategory.set(pose.category, list)
    }
    return POSE_CATEGORY_ORDER.map((cat) => ({
      category: cat,
      poses: byCategory.get(cat) ?? [],
    }))
  }, [query, matches])

  const anyVisible = grouped.some((g) => g.poses.length > 0)

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
        <Input
          aria-label="Search pose"
          placeholder="Search pose"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="pl-8 h-8 text-xs"
        />
      </div>

      {!anyVisible && query && (
        <div className="text-xs text-muted-foreground text-center py-4">
          No pose matches &quot;{query}&quot;
        </div>
      )}

      {grouped.map(({ category, poses }) => {
        if (poses.length === 0) return null
        return (
          <div key={category} className="flex flex-col gap-1.5">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground px-0.5">
              {POSE_CATEGORY_LABELS[category]}
            </div>
            <div role="radiogroup" aria-label={POSE_CATEGORY_LABELS[category]} className="grid grid-cols-3 gap-1.5">
              {poses.map((pose) => {
                const selected = pose.id === value
                const label = resolveLabel(pose.id, pose.label)
                const description = resolveDescription(pose.id, pose.description)
                return (
                  <button
                    key={pose.id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    title={description}
                    onClick={() => onValueChange(pose.id)}
                    className={cn(
                      "flex flex-col items-center justify-center gap-0.5 px-2 py-2 rounded-lg border text-center transition-colors cursor-pointer overflow-hidden",
                      selected
                        ? "border-[#ff0073] bg-[#ff0073]/10 ring-1 ring-[#ff0073]/60"
                        : "border-gray-200 dark:border-[#2D2D2D] bg-gray-50 dark:bg-[#161616] hover:border-gray-300 dark:hover:border-[#3D3D3D]",
                    )}
                  >
                    <FitText
                      text={label}
                      className={cn(
                        "text-[11px] font-medium leading-tight max-w-full",
                        selected ? "text-[#ff0073]" : "text-gray-700 dark:text-[#E2E8F0]",
                      )}
                    />
                  </button>
                )
              })}
            </div>
          </div>
        )
      })}
    </div>
  )
})
