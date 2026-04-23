"use client"

import { useId } from "react"
import { CameraFormatPicker } from "./camera-format-picker"
import { MappableField } from "./mappable-field"
import type { FieldMappings } from "@/types/nodes"
import type { SourceNodeInfo } from "./types"

interface InlineCameraFormatFieldProps {
  readonly data: {
    cameraFormat?: string
    cameraFormatEnabled?: boolean
  }
  readonly onUpdate: (patch: Partial<InlineCameraFormatFieldProps["data"]>) => void
  readonly sources: ReadonlyArray<SourceNodeInfo>
  readonly fieldMappings: FieldMappings
  readonly onMapField: (field: string, sourceNodeId: string | null) => void
}

export function InlineCameraFormatField({
  data,
  onUpdate,
  sources,
  fieldMappings,
  onMapField,
}: InlineCameraFormatFieldProps) {
  const id = useId()
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 px-1">
        <input
          type="checkbox"
          id={id}
          checked={!!data.cameraFormatEnabled}
          onChange={(e) =>
            onUpdate({
              cameraFormatEnabled: e.target.checked,
              ...(!e.target.checked ? { cameraFormat: undefined } : {}),
            })
          }
          className="rounded border-muted-foreground/40"
        />
        <label htmlFor={id} className="text-xs">
          Camera / Film hint (injected into prompt)
        </label>
      </div>
      {data.cameraFormatEnabled && (
        <MappableField
          field="cameraFormat"
          label="Camera / Film"
          sources={sources}
          fieldMappings={fieldMappings}
          onMapField={onMapField}
        >
          <CameraFormatPicker
            value={data.cameraFormat || "35mm-film"}
            onValueChange={(v) => onUpdate({ cameraFormat: v })}
          />
        </MappableField>
      )}
    </div>
  )
}
