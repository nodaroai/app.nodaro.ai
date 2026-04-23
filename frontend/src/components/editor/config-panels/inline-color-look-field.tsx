"use client"

import { useId } from "react"
import { ColorLookPicker } from "./color-look-picker"
import { MappableField } from "./mappable-field"
import type { FieldMappings } from "@/types/nodes"
import type { SourceNodeInfo } from "./types"

interface InlineColorLookFieldProps {
  readonly data: {
    colorLook?: string
    colorLookEnabled?: boolean
  }
  readonly onUpdate: (patch: Partial<InlineColorLookFieldProps["data"]>) => void
  readonly sources: ReadonlyArray<SourceNodeInfo>
  readonly fieldMappings: FieldMappings
  readonly onMapField: (field: string, sourceNodeId: string | null) => void
}

export function InlineColorLookField({
  data,
  onUpdate,
  sources,
  fieldMappings,
  onMapField,
}: InlineColorLookFieldProps) {
  const id = useId()
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 px-1">
        <input
          type="checkbox"
          id={id}
          checked={!!data.colorLookEnabled}
          onChange={(e) =>
            onUpdate({
              colorLookEnabled: e.target.checked,
              ...(!e.target.checked ? { colorLook: undefined } : {}),
            })
          }
          className="rounded border-muted-foreground/40"
        />
        <label htmlFor={id} className="text-xs">
          Color / Look hint (injected into prompt)
        </label>
      </div>
      {data.colorLookEnabled && (
        <MappableField
          field="colorLook"
          label="Color / Look"
          sources={sources}
          fieldMappings={fieldMappings}
          onMapField={onMapField}
        >
          <ColorLookPicker
            value={data.colorLook || "warm"}
            onValueChange={(v) => onUpdate({ colorLook: v })}
          />
        </MappableField>
      )}
    </div>
  )
}
