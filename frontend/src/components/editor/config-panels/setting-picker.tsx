"use client"

import { memo, useMemo, useState } from "react"
import { Search } from "lucide-react"
import {
  SETTINGS,
  SETTING_CATEGORY_LABELS,
  type Setting,
  type SettingCategory,
} from "@nodaro-shared/setting"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { SettingPreview } from "./setting-preview"

interface SettingPickerProps {
  readonly value: string
  readonly onValueChange: (settingId: string) => void
  readonly className?: string
}

const CATEGORY_ORDER: ReadonlyArray<SettingCategory> = [
  "indoor",
  "urban",
  "nature",
  "fantastical",
]

/**
 * Single-select setting picker: user picks ONE environment from the 28-entry
 * catalog, grouped by category (Indoor / Urban / Nature / Fantastical).
 * Search filters across label + description.
 */
export const SettingPicker = memo(function SettingPicker({
  value,
  onValueChange,
  className,
}: SettingPickerProps) {
  const [query, setQuery] = useState("")

  const grouped = useMemo(() => {
    const q = query.trim().toLowerCase()
    const byCategory = new Map<SettingCategory, Setting[]>()
    for (const setting of SETTINGS) {
      if (q && !setting.label.toLowerCase().includes(q) && !setting.description.toLowerCase().includes(q)) {
        continue
      }
      const list = byCategory.get(setting.category) ?? []
      list.push(setting)
      byCategory.set(setting.category, list)
    }
    return CATEGORY_ORDER.map((cat) => ({
      category: cat,
      settings: byCategory.get(cat) ?? [],
    }))
  }, [query])

  const anyVisible = grouped.some((g) => g.settings.length > 0)

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
        <Input
          aria-label="Search setting"
          placeholder="Search setting"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="pl-8 h-8 text-xs"
        />
      </div>

      {!anyVisible && query && (
        <div className="text-xs text-muted-foreground text-center py-4">
          No setting matches &quot;{query}&quot;
        </div>
      )}

      {grouped.map(({ category, settings }) => {
        if (settings.length === 0) return null
        return (
          <div key={category} className="flex flex-col gap-1.5">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground px-0.5">
              {SETTING_CATEGORY_LABELS[category]}
            </div>
            <div role="radiogroup" aria-label={SETTING_CATEGORY_LABELS[category]} className="grid grid-cols-3 gap-1.5">
              {settings.map((setting) => {
                const selected = setting.id === value
                return (
                  <button
                    key={setting.id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    title={setting.description}
                    onClick={() => onValueChange(setting.id)}
                    className={cn(
                      "group flex flex-col gap-1 p-1 rounded-lg border text-left transition-colors cursor-pointer overflow-hidden",
                      selected
                        ? "border-[#ff0073] bg-[#ff0073]/10 ring-1 ring-[#ff0073]/60"
                        : "border-gray-200 dark:border-[#2D2D2D] bg-gray-50 dark:bg-[#161616] hover:border-gray-300 dark:hover:border-[#3D3D3D]",
                    )}
                  >
                    <SettingPreview settingId={setting.id} className="w-full aspect-square" />
                    <span
                      className={cn(
                        "text-[10.5px] font-medium leading-tight px-1 pb-0.5 text-center truncate",
                        selected ? "text-white" : "text-gray-700 dark:text-[#E2E8F0]",
                      )}
                    >
                      {setting.label}
                    </span>
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
