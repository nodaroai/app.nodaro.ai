"use client"

import { memo } from "react"
import type { NodeProps } from "@xyflow/react"
import { Aperture } from "lucide-react"
import {
  EXPOSURE_CATEGORY_LABELS,
  EXPOSURE_CATEGORY_ORDER,
  EXPOSURE_FIELD_BY_CATEGORY,
  getExposure,
  getExposureLabel,
  type ExposureCategory,
} from "@nodaro-shared/exposure-settings"
import { ParameterNodeShell } from "./parameter-node-shell"
import type { ExposureSettingsData } from "@/types/nodes"

interface EnabledEntry {
  readonly category: ExposureCategory
  readonly entryId: string
}

function collectEnabled(data: ExposureSettingsData): EnabledEntry[] {
  const enabled: EnabledEntry[] = []
  for (const category of EXPOSURE_CATEGORY_ORDER) {
    const field = EXPOSURE_FIELD_BY_CATEGORY[category]
    const id = data[field]
    if (typeof id === "string" && id.length > 0) {
      enabled.push({ category, entryId: id })
    }
  }
  return enabled
}

function ExposureSettingsNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as ExposureSettingsData
  const enabled = collectEnabled(nodeData)
  const maxItemsPerRow = Math.max(1, Math.min(3, nodeData.maxItemsPerRow ?? 2))
  const gridColumns = Math.max(1, Math.min(maxItemsPerRow, enabled.length))

  return (
    <ParameterNodeShell
      id={id}
      label={nodeData.label}
      icon={<Aperture />}
      handleId="out"
      selected={selected}
      fluidWidth
    >
      {enabled.length > 0 ? (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(${gridColumns}, minmax(0, 1fr))`,
            columnGap: "0.5rem",
            rowGap: "0.75rem",
          }}
        >
          {enabled.map(({ category, entryId }) => {
            const entry = getExposure(entryId)
            return (
              <div key={category} className="flex flex-col gap-0.5">
                <span className="text-muted-foreground text-[10px] uppercase tracking-wider">
                  {EXPOSURE_CATEGORY_LABELS[category]}
                </span>
                <p className="text-foreground text-sm font-medium">
                  {getExposureLabel(entryId)}
                </p>
                {entry?.description && (
                  <p className="text-muted-foreground text-[11px] leading-snug">
                    {entry.description}
                  </p>
                )}
              </div>
            )
          })}
        </div>
      ) : (
        <p className="text-muted-foreground text-sm italic">
          Pick aperture, shutter, or ISO
        </p>
      )}
    </ParameterNodeShell>
  )
}

export const ExposureSettingsNode = memo(ExposureSettingsNodeComponent)
