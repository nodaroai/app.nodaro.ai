"use client"

import { memo } from "react"
import type { NodeProps } from "@xyflow/react"
import { Gem } from "lucide-react"
import {
  STYLING_DIMENSION_LABELS,
  STYLING_DIMENSION_ORDER,
  STYLING_FIELD_BY_DIMENSION,
  getStyling,
  getStylingLabel,
  type StylingDimension,
} from "@nodaro/shared"
import { ParameterNodeShell } from "./parameter-node-shell"
import { getStylingEntryIcon } from "./person-styling-icon"
import type { StylingData } from "@/types/nodes"

interface EnabledEntry {
  readonly dimension: StylingDimension
  readonly entryId: string
}

function collectEnabled(data: StylingData): EnabledEntry[] {
  const enabled: EnabledEntry[] = []
  for (const dimension of STYLING_DIMENSION_ORDER) {
    const field = STYLING_FIELD_BY_DIMENSION[dimension]
    const id = data[field]
    if (typeof id === "string" && id.length > 0) {
      enabled.push({ dimension, entryId: id })
    }
  }
  return enabled
}

function StylingNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as StylingData
  const enabled = collectEnabled(nodeData)
  const maxItemsPerRow = Math.max(1, Math.min(4, nodeData.maxItemsPerRow ?? 2))
  const gridColumns = Math.max(1, Math.min(maxItemsPerRow, enabled.length))

  return (
    <ParameterNodeShell
      id={id}
      label={nodeData.label}
      icon={<Gem />}
      handleId="out"
      selected={selected}
      fluidWidth
    >
      {enabled.length > 0 ? (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(${gridColumns}, minmax(0, 1fr))`,
            columnGap: "0.75rem",
            rowGap: "0.75rem",
          }}
        >
          {enabled.map(({ dimension, entryId }) => {
            const entry = getStyling(entryId)
            const icon = getStylingEntryIcon(dimension, entryId)
            return (
              <div key={dimension} className="flex flex-col gap-0.5 min-w-0">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                    <p className="text-muted-foreground text-[10px] uppercase tracking-wider truncate">
                      {STYLING_DIMENSION_LABELS[dimension]}
                    </p>
                    <p className="text-foreground text-sm font-medium leading-tight truncate">
                      {getStylingLabel(entryId)}
                    </p>
                  </div>
                  {icon && (
                    <div className="shrink-0 flex items-center justify-center">
                      {icon}
                    </div>
                  )}
                </div>
                {entry?.description && (
                  <p className="text-muted-foreground text-[10.5px] leading-snug">
                    {entry.description}
                  </p>
                )}
              </div>
            )
          })}
        </div>
      ) : (
        <p className="text-muted-foreground text-sm italic">
          Pick a styling dimension to begin
        </p>
      )}
    </ParameterNodeShell>
  )
}

export const StylingNode = memo(StylingNodeComponent)
