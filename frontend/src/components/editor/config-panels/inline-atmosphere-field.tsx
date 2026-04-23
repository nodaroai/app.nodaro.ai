"use client"

import { useId } from "react"
import { AtmospherePicker } from "./atmosphere-picker"
import { MappableField } from "./mappable-field"
import type { FieldMappings } from "@/types/nodes"
import type { SourceNodeInfo } from "./types"

interface InlineAtmosphereFieldProps {
  readonly data: {
    atmosphere?: string
    atmosphereEnabled?: boolean
  }
  readonly onUpdate: (patch: Partial<InlineAtmosphereFieldProps["data"]>) => void
  readonly sources: ReadonlyArray<SourceNodeInfo>
  readonly fieldMappings: FieldMappings
  readonly onMapField: (field: string, sourceNodeId: string | null) => void
}

export function InlineAtmosphereField({
  data,
  onUpdate,
  sources,
  fieldMappings,
  onMapField,
}: InlineAtmosphereFieldProps) {
  const id = useId()
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 px-1">
        <input
          type="checkbox"
          id={id}
          checked={!!data.atmosphereEnabled}
          onChange={(e) =>
            onUpdate({
              atmosphereEnabled: e.target.checked,
              ...(!e.target.checked ? { atmosphere: undefined } : {}),
            })
          }
          className="rounded border-muted-foreground/40"
        />
        <label htmlFor={id} className="text-xs">
          Atmosphere hint (injected into prompt)
        </label>
      </div>
      {data.atmosphereEnabled && (
        <MappableField
          field="atmosphere"
          label="Atmosphere"
          sources={sources}
          fieldMappings={fieldMappings}
          onMapField={onMapField}
        >
          <AtmospherePicker
            value={data.atmosphere || "clear"}
            onValueChange={(v) => onUpdate({ atmosphere: v })}
          />
        </MappableField>
      )}
    </div>
  )
}
