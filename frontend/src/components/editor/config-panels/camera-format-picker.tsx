"use client"

import { memo, useMemo, useState } from "react"
import { Search } from "lucide-react"
import { CAMERA_FORMATS } from "@nodaro/shared"
import { Input } from "@/components/ui/input"
import { FitText } from "@/components/ui/fit-text"
import { cn } from "@/lib/utils"
import { CameraFormatPreview } from "./camera-format-preview"
import { useLocalizedCatalog } from "@/hooks/use-localized-entry"

interface CameraFormatPickerProps {
  readonly value: string
  readonly onValueChange: (cameraFormatId: string) => void
  readonly className?: string
}

export const CameraFormatPicker = memo(function CameraFormatPicker({
  value,
  onValueChange,
  className,
}: CameraFormatPickerProps) {
  const [query, setQuery] = useState("")
  const { resolveLabel, resolveDescription, matches } = useLocalizedCatalog("camera-format")

  const filtered = useMemo(() => {
    return CAMERA_FORMATS.filter((f) => matches(f.id, f.label, f.description, query))
  }, [query, matches])

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
        <Input
          aria-label="Search camera / film"
          placeholder="Search camera / film"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="pl-8 h-8 text-xs"
        />
      </div>

      {filtered.length === 0 && (
        <div className="text-xs text-muted-foreground text-center py-4">
          No formats match "{query}"
        </div>
      )}

      <div role="radiogroup" aria-label="Camera / Film" className="grid grid-cols-3 gap-1.5">
        {filtered.map((format) => {
          const selected = format.id === value
          const label = resolveLabel(format.id, format.label)
          const description = resolveDescription(format.id, format.description)
          return (
            <button
              key={format.id}
              type="button"
              role="radio"
              aria-checked={selected}
              title={description}
              onClick={() => onValueChange(format.id)}
              className={cn(
                "group flex flex-col gap-1 p-1 rounded-lg border text-left transition-colors cursor-pointer overflow-hidden",
                selected
                  ? "border-[#ff0073] bg-[#ff0073]/10 ring-1 ring-[#ff0073]/60"
                  : "border-gray-200 dark:border-[#2D2D2D] bg-gray-50 dark:bg-[#161616] hover:border-gray-300 dark:hover:border-[#3D3D3D]",
              )}
            >
              <CameraFormatPreview cameraFormatId={format.id} className="w-full aspect-square" />
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
