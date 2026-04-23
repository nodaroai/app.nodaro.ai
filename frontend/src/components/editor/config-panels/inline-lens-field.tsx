"use client"

import { useId } from "react"
import { LensPicker } from "./lens-picker"
import { MappableField } from "./mappable-field"
import type { FieldMappings } from "@/types/nodes"
import type { SourceNodeInfo } from "./types"

interface InlineLensFieldProps {
  readonly data: {
    lens?: string
    lensEnabled?: boolean
  }
  readonly onUpdate: (patch: Partial<InlineLensFieldProps["data"]>) => void
  readonly sources: ReadonlyArray<SourceNodeInfo>
  readonly fieldMappings: FieldMappings
  readonly onMapField: (field: string, sourceNodeId: string | null) => void
}

export function InlineLensField({
  data,
  onUpdate,
  sources,
  fieldMappings,
  onMapField,
}: InlineLensFieldProps) {
  const id = useId()
  return (
    <div className="flex flex-col gap-2">
      <div className="flex items-center gap-2 px-1">
        <input
          type="checkbox"
          id={id}
          checked={!!data.lensEnabled}
          onChange={(e) =>
            onUpdate({
              lensEnabled: e.target.checked,
              ...(!e.target.checked ? { lens: undefined } : {}),
            })
          }
          className="rounded border-muted-foreground/40"
        />
        <label htmlFor={id} className="text-xs">
          Lens hint (injected into prompt)
        </label>
      </div>
      {data.lensEnabled && (
        <MappableField
          field="lens"
          label="Lens"
          sources={sources}
          fieldMappings={fieldMappings}
          onMapField={onMapField}
        >
          <LensPicker
            value={data.lens || "normal-50mm"}
            onValueChange={(v) => onUpdate({ lens: v })}
          />
        </MappableField>
      )}
    </div>
  )
}
