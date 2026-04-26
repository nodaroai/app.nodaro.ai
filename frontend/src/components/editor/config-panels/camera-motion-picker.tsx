"use client"

import { memo, useMemo, useState } from "react"
import { Search } from "lucide-react"
import {
  CAMERA_MOTIONS,
  CAMERA_MOTION_CATEGORY_ORDER,
  CAMERA_MOTION_CATEGORY_LABELS,
  type CameraMotion,
  type CameraMotionCategory,
} from "@nodaro-shared/camera-motions"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { CameraMotionPreview } from "./camera-motion-preview"
import { useLocalizedCatalog } from "@/hooks/use-localized-entry"

interface CameraMotionPickerProps {
  readonly value: string
  readonly onValueChange: (motionId: string) => void
  readonly className?: string
}

/** Grid picker that displays every camera motion with an animated preview. */
export const CameraMotionPicker = memo(function CameraMotionPicker({
  value,
  onValueChange,
  className,
}: CameraMotionPickerProps) {
  const [query, setQuery] = useState("")
  const { resolveLabel, resolveDescription, matches } = useLocalizedCatalog("camera-motions")

  const grouped = useMemo(() => {
    const byCategory = new Map<CameraMotionCategory, CameraMotion[]>()
    for (const motion of CAMERA_MOTIONS) {
      if (!matches(motion.id, motion.label, motion.description, query)) {
        continue
      }
      const list = byCategory.get(motion.category) ?? []
      list.push(motion)
      byCategory.set(motion.category, list)
    }
    return CAMERA_MOTION_CATEGORY_ORDER
      .map((cat) => ({ category: cat, motions: byCategory.get(cat) ?? [] }))
      .filter((section) => section.motions.length > 0)
  }, [query, matches])

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
        <Input
          aria-label="Search camera motions"
          placeholder="Search camera motions"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="pl-8 h-8 text-xs"
        />
      </div>

      {grouped.length === 0 && (
        <div className="text-xs text-muted-foreground text-center py-4">
          No motions match "{query}"
        </div>
      )}

      {grouped.map(({ category, motions }) => (
        <div key={category} className="flex flex-col gap-1.5">
          <div className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground px-0.5">
            {CAMERA_MOTION_CATEGORY_LABELS[category]}
          </div>
          <div role="radiogroup" aria-label={CAMERA_MOTION_CATEGORY_LABELS[category]} className="grid grid-cols-3 gap-1.5">
            {motions.map((motion) => {
              const selected = motion.id === value
              const label = resolveLabel(motion.id, motion.label)
              const description = resolveDescription(motion.id, motion.description)
              return (
                <button
                  key={motion.id}
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  title={description}
                  onClick={() => onValueChange(motion.id)}
                  className={cn(
                    "group flex flex-col gap-1 p-1 rounded-lg border text-left transition-colors cursor-pointer overflow-hidden",
                    selected
                      ? "border-[#ff0073] bg-[#ff0073]/10 ring-1 ring-[#ff0073]/60"
                      : "border-gray-200 dark:border-[#2D2D2D] bg-gray-50 dark:bg-[#161616] hover:border-gray-300 dark:hover:border-[#3D3D3D]",
                  )}
                >
                  <CameraMotionPreview motionId={motion.id} className="w-full aspect-square" />
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
      ))}
    </div>
  )
})
