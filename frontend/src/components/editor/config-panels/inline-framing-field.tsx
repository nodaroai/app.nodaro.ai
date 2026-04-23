"use client"

import { FramingPicker } from "./framing-picker"
import { MappableField } from "./mappable-field"
import type { FieldMappings } from "@/types/nodes"
import type { SourceNodeInfo } from "./types"

interface InlineFramingFieldProps {
  readonly data: {
    shotSize?: string
    angle?: string
    coverage?: string
    composition?: string
    vantage?: string
  }
  readonly onUpdate: (patch: Partial<InlineFramingFieldProps["data"]>) => void
  readonly sources: ReadonlyArray<SourceNodeInfo>
  readonly fieldMappings: FieldMappings
  readonly onMapField: (field: string, sourceNodeId: string | null) => void
}

/**
 * Inline framing hint controls for a consumer (image / video) config panel.
 *
 * The picker is always visible — each of the 5 framing dimensions has its own
 * checkbox + selection inside the picker, so "framing enabled" is an implicit
 * function of presence-of-value across the per-category fields.
 */
export function InlineFramingField({
  data,
  onUpdate,
  sources,
  fieldMappings,
  onMapField,
}: InlineFramingFieldProps) {
  return (
    <div className="flex flex-col gap-2">
      <MappableField
        field="shotSize"
        label="Framing"
        sources={sources}
        fieldMappings={fieldMappings}
        onMapField={onMapField}
      >
        <FramingPicker
          value={{
            shotSize: data.shotSize,
            angle: data.angle,
            coverage: data.coverage,
            composition: data.composition,
            vantage: data.vantage,
          }}
          onChange={(patch) => onUpdate(patch)}
        />
      </MappableField>
    </div>
  )
}
