"use client"

import { memo, useId, useMemo, useState } from "react"
import { Search } from "lucide-react"
import {
  EXPOSURE_SETTINGS,
  EXPOSURE_CATEGORY_ORDER,
  EXPOSURE_CATEGORY_LABELS,
  EXPOSURE_FIELD_BY_CATEGORY,
  type ExposureSettings,
  type ExposureCategory,
  type ExposureValue,
} from "@nodaro/shared"
import { Input } from "@/components/ui/input"
import { FitText } from "@/components/ui/fit-text"
import { cn } from "@/lib/utils"
import { useLocalizedCatalog } from "@/hooks/use-localized-entry"

interface ExposureSettingsPickerProps {
  readonly value: ExposureValue
  readonly onChange: (patch: Partial<ExposureValue>) => void
  readonly className?: string
}

/**
 * Multi-category exposure picker: each of the 3 exposure dimensions
 * (aperture, shutter speed, ISO) is an independent checkbox section.
 * User can enable any combination of categories and pick one entry per
 * enabled category — mirrors the photographic-triangle workflow where a
 * shot's character is a combination of all three dial settings.
 */
export const ExposureSettingsPicker = memo(function ExposureSettingsPicker({
  value,
  onChange,
  className,
}: ExposureSettingsPickerProps) {
  const [query, setQuery] = useState("")
  const { resolveLabel, resolveDescription, matches } = useLocalizedCatalog("exposure-settings")

  const grouped = useMemo(() => {
    const byCategory = new Map<ExposureCategory, ExposureSettings[]>()
    for (const exposure of EXPOSURE_SETTINGS) {
      if (!matches(exposure.id, exposure.label, exposure.description, query)) {
        continue
      }
      const list = byCategory.get(exposure.category) ?? []
      list.push(exposure)
      byCategory.set(exposure.category, list)
    }
    return EXPOSURE_CATEGORY_ORDER.map((cat) => ({
      category: cat,
      exposures: byCategory.get(cat) ?? [],
    }))
  }, [query, matches])

  const anyVisible = grouped.some((g) => g.exposures.length > 0)

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
        <Input
          aria-label="Search exposure"
          placeholder="Search aperture, shutter, ISO"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="pl-8 h-8 text-xs"
        />
      </div>

      {!anyVisible && query && (
        <div className="text-xs text-muted-foreground text-center py-4">
          No exposure entry matches &quot;{query}&quot;
        </div>
      )}

      {grouped.map(({ category, exposures }) => {
        const field = EXPOSURE_FIELD_BY_CATEGORY[category]
        const current = value[field]
        const checked = current !== undefined && current !== ""
        if (query && exposures.length === 0) return null
        return (
          <CategorySection
            key={category}
            category={category}
            exposures={exposures}
            field={field}
            checked={checked}
            current={current}
            resolveLabel={resolveLabel}
            resolveDescription={resolveDescription}
            onToggle={(next) => {
              if (next) {
                const first = EXPOSURE_SETTINGS.find((e) => e.category === category)?.id
                if (first) onChange({ [field]: first })
              } else {
                onChange({ [field]: undefined })
              }
            }}
            onPick={(id) => onChange({ [field]: id })}
          />
        )
      })}
    </div>
  )
})

interface CategorySectionProps {
  readonly category: ExposureCategory
  readonly exposures: ReadonlyArray<ExposureSettings>
  readonly field: "aperture" | "shutterSpeed" | "isoValue"
  readonly checked: boolean
  readonly current: string | undefined
  readonly resolveLabel: (id: string, englishLabel: string) => string
  readonly resolveDescription: (id: string, englishDescription: string) => string
  readonly onToggle: (next: boolean) => void
  readonly onPick: (id: string) => void
}

function CategorySection({
  category,
  exposures,
  field,
  checked,
  current,
  resolveLabel,
  resolveDescription,
  onToggle,
  onPick,
}: CategorySectionProps) {
  const id = useId()
  const label = EXPOSURE_CATEGORY_LABELS[category]
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center gap-2 px-0.5">
        <input
          type="checkbox"
          id={`${id}-${field}`}
          checked={checked}
          onChange={(e) => onToggle(e.target.checked)}
          className="rounded border-muted-foreground/40"
        />
        <label
          htmlFor={`${id}-${field}`}
          className="text-[10px] uppercase tracking-wider font-semibold text-muted-foreground select-none cursor-pointer"
        >
          {label}
        </label>
      </div>
      <div role="radiogroup" aria-label={label} className={cn("grid grid-cols-3 gap-1.5 transition-opacity", !checked && "opacity-40")}>
        {exposures.map((exposure) => {
          const selected = checked && exposure.id === current
          const entryLabel = resolveLabel(exposure.id, exposure.label)
          const entryDescription = resolveDescription(exposure.id, exposure.description)
          return (
            <button
              key={exposure.id}
              type="button"
              role="radio"
              aria-checked={selected}
              title={checked ? entryDescription : `${entryDescription} (click to enable ${label})`}
              onClick={() => onPick(exposure.id)}
              className={cn(
                "w-full flex flex-col items-center justify-center gap-1 px-2 py-2 rounded-lg border text-center transition-colors cursor-pointer",
                selected
                  ? "border-[#ff0073] bg-[#ff0073]/10 ring-1 ring-[#ff0073]/60"
                  : "border-gray-200 dark:border-[#2D2D2D] bg-gray-50 dark:bg-[#161616] hover:border-gray-300 dark:hover:border-[#3D3D3D]",
              )}
            >
              <FitText
                text={entryLabel}
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
}
