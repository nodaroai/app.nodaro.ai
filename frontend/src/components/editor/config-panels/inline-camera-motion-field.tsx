"use client"

import { useId } from "react"
import { CameraMotionPicker } from "./camera-motion-picker"
import { MappableField } from "./mappable-field"
import type { FieldMappings } from "@/types/nodes"
import type { SourceNodeInfo } from "./types"

interface InlineCameraMotionFieldProps {
  readonly data: {
    cameraMotion?: string
    cameraMotionEnabled?: boolean
  }
  readonly onUpdate: (patch: Partial<InlineCameraMotionFieldProps["data"]>) => void
  readonly sources: ReadonlyArray<SourceNodeInfo>
  readonly fieldMappings: FieldMappings
  readonly onMapField: (field: string, sourceNodeId: string | null) => void
}

export function InlineCameraMotionField({
  data,
  onUpdate,
  sources,
  fieldMappings,
  onMapField,
}: InlineCameraMotionFieldProps) {
  const id = useId()
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 px-1">
        <input
          type="checkbox"
          id={id}
          checked={!!data.cameraMotionEnabled}
          onChange={(e) =>
            onUpdate({
              cameraMotionEnabled: e.target.checked,
              ...(!e.target.checked ? { cameraMotion: undefined } : {}),
            })
          }
          className="rounded border-muted-foreground/40"
        />
        <label htmlFor={id} className="text-xs">
          Camera motion hint (injected into prompt)
        </label>
      </div>
      {data.cameraMotionEnabled && (
        <MappableField
          field="cameraMotion"
          label="Camera Motion"
          sources={sources}
          fieldMappings={fieldMappings}
          onMapField={onMapField}
        >
          <CameraMotionPicker
            value={data.cameraMotion || "static"}
            onValueChange={(v) => onUpdate({ cameraMotion: v })}
          />
        </MappableField>
      )}
    </div>
  )
}
