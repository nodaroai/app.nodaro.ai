"use client"

import { memo, useMemo, useState } from "react"
import { Search } from "lucide-react"
import {
  VEHICLES,
  VEHICLE_SUBCATEGORY_LABELS,
  VEHICLE_SUBCATEGORY_ORDER,
  type Vehicle,
  type VehicleSubcategory,
} from "@nodaro-shared/vehicles"
import { Input } from "@/components/ui/input"
import { cn } from "@/lib/utils"
import { useLocalizedCatalog } from "@/hooks/use-localized-entry"
import { VEHICLE_ICON_FOR } from "@/lib/parameter-picker-icons-vehicles"

interface VehiclePickerProps {
  readonly value: string
  readonly onValueChange: (vehicleId: string, vehicle: Vehicle) => void
  readonly className?: string
}

/**
 * Single-select vehicle picker. Vehicles are grouped by sub-category
 * (classic, everyday, performance, motorcycles, bicycles, trucks, transit,
 * aircraft, watercraft, military, construction, sci-fi). Search filters
 * across label + description.
 *
 * Selecting a vehicle calls `onValueChange(id, vehicle)` so the caller can
 * auto-fill dependent fields (objectName, description) from the catalog.
 */
export const VehiclePicker = memo(function VehiclePicker({
  value,
  onValueChange,
  className,
}: VehiclePickerProps) {
  const [query, setQuery] = useState("")
  const { resolveLabel, resolveDescription, matches } = useLocalizedCatalog("vehicles")

  const grouped = useMemo(() => {
    const byCategory = new Map<VehicleSubcategory, Vehicle[]>()
    for (const vehicle of VEHICLES) {
      if (!matches(vehicle.id, vehicle.label, vehicle.description, query)) {
        continue
      }
      const list = byCategory.get(vehicle.subcategory) ?? []
      list.push(vehicle)
      byCategory.set(vehicle.subcategory, list)
    }
    return VEHICLE_SUBCATEGORY_ORDER.map((cat) => ({
      subcategory: cat,
      vehicles: byCategory.get(cat) ?? [],
    }))
  }, [query, matches])

  const anyVisible = grouped.some((g) => g.vehicles.length > 0)

  return (
    <div className={cn("flex flex-col gap-3", className)}>
      <div className="relative">
        <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 size-3.5 text-muted-foreground pointer-events-none" />
        <Input
          aria-label="Search vehicle"
          placeholder="Search vehicle"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="pl-8 h-8 text-xs"
        />
      </div>

      {!anyVisible && query && (
        <div className="text-xs text-muted-foreground text-center py-4">
          No vehicle matches &quot;{query}&quot;
        </div>
      )}

      {grouped.map(({ subcategory, vehicles }) => {
        if (vehicles.length === 0) return null
        return (
          <div key={subcategory} className="flex flex-col gap-1.5">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground px-0.5">
              {VEHICLE_SUBCATEGORY_LABELS[subcategory]}
            </div>
            <div
              role="radiogroup"
              aria-label={VEHICLE_SUBCATEGORY_LABELS[subcategory]}
              className="grid grid-cols-3 gap-1.5"
            >
              {vehicles.map((vehicle) => {
                const selected = vehicle.id === value
                const label = resolveLabel(vehicle.id, vehicle.label)
                const description = resolveDescription(vehicle.id, vehicle.description)
                return (
                  <button
                    key={vehicle.id}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    title={description}
                    onClick={() => onValueChange(vehicle.id, vehicle)}
                    className={cn(
                      "group flex flex-col items-center gap-1 p-1.5 rounded-lg border text-left transition-colors cursor-pointer overflow-hidden",
                      selected
                        ? "border-[#ff0073] bg-[#ff0073]/10 ring-1 ring-[#ff0073]/60"
                        : "border-gray-200 dark:border-[#2D2D2D] bg-gray-50 dark:bg-[#161616] hover:border-gray-300 dark:hover:border-[#3D3D3D]",
                    )}
                  >
                    <span className="text-2xl leading-none select-none" aria-hidden="true">
                      {VEHICLE_ICON_FOR(vehicle.id)}
                    </span>
                    <span
                      className={cn(
                        "text-[10.5px] font-medium leading-tight px-0.5 pb-0.5 text-center line-clamp-2",
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
      })}
    </div>
  )
})
