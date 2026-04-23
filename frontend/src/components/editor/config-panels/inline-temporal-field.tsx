"use client"

import { TemporalPicker } from "./temporal-picker"
import { MappableField } from "./mappable-field"
import type { FieldMappings } from "@/types/nodes"
import type { SourceNodeInfo } from "./types"

interface InlineTemporalFieldProps {
  readonly data: {
    temporalSpeed?: string
    temporalFreeze?: string
    temporalDirection?: string
    temporalShutter?: string
  }
  readonly onUpdate: (patch: Partial<InlineTemporalFieldProps["data"]>) => void
  readonly sources: ReadonlyArray<SourceNodeInfo>
  readonly fieldMappings: FieldMappings
  readonly onMapField: (field: string, sourceNodeId: string | null) => void
}

/**
 * Inline temporal hint controls for a video consumer config panel.
 *
 * The picker is always visible — each of the 4 temporal dimensions has its own
 * checkbox + selection inside the picker, so "temporal enabled" is an implicit
 * function of presence-of-value across the per-category fields.
 */
export function InlineTemporalField({
  data,
  onUpdate,
  sources,
  fieldMappings,
  onMapField,
}: InlineTemporalFieldProps) {
  return (
    <div className="flex flex-col gap-2">
      <MappableField
        field="temporalSpeed"
        label="Temporal"
        sources={sources}
        fieldMappings={fieldMappings}
        onMapField={onMapField}
      >
        <TemporalPicker
          value={{
            temporalSpeed: data.temporalSpeed,
            temporalFreeze: data.temporalFreeze,
            temporalDirection: data.temporalDirection,
            temporalShutter: data.temporalShutter,
          }}
          onChange={(patch) => onUpdate(patch)}
        />
      </MappableField>
    </div>
  )
}
