"use client"

import { LightingPicker } from "./lighting-picker"
import { MappableField } from "./mappable-field"
import type { FieldMappings } from "@/types/nodes"
import type { SourceNodeInfo } from "./types"

interface InlineLightingFieldProps {
  readonly data: {
    timeOfDay?: string
    lightingStyle?: string
    lightingDirection?: string
  }
  readonly onUpdate: (patch: Partial<InlineLightingFieldProps["data"]>) => void
  readonly sources: ReadonlyArray<SourceNodeInfo>
  readonly fieldMappings: FieldMappings
  readonly onMapField: (field: string, sourceNodeId: string | null) => void
}

/**
 * Inline lighting hint controls for a consumer (image / video) config panel.
 *
 * The picker is always visible — each of the 3 lighting dimensions has its own
 * checkbox + selection inside the picker, so "lighting enabled" is an implicit
 * function of presence-of-value across the per-category fields.
 */
export function InlineLightingField({
  data,
  onUpdate,
  sources,
  fieldMappings,
  onMapField,
}: InlineLightingFieldProps) {
  return (
    <div className="flex flex-col gap-2">
      <MappableField
        field="timeOfDay"
        label="Lighting"
        sources={sources}
        fieldMappings={fieldMappings}
        onMapField={onMapField}
      >
        <LightingPicker
          value={{
            timeOfDay: data.timeOfDay,
            lightingStyle: data.lightingStyle,
            lightingDirection: data.lightingDirection,
          }}
          onChange={(patch) => onUpdate(patch)}
        />
      </MappableField>
    </div>
  )
}
