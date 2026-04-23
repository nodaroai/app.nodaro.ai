"use client"

import { memo } from "react"
import type { NodeProps } from "@xyflow/react"
import { Clock } from "lucide-react"
import {
  TEMPORAL_CATEGORY_LABELS,
  TEMPORAL_CATEGORY_ORDER,
  TEMPORAL_FIELD_BY_CATEGORY,
  getTemporal,
  getTemporalLabel,
  type TemporalCategory,
} from "@nodaro-shared/temporal"
import { ParameterNodeShell } from "./parameter-node-shell"
import { TemporalPreview } from "@/components/editor/config-panels/temporal-preview"
import type { TemporalData } from "@/types/nodes"

interface EnabledEntry {
  readonly category: TemporalCategory
  readonly entryId: string
}

function collectEnabled(data: TemporalData): EnabledEntry[] {
  const enabled: EnabledEntry[] = []
  for (const category of TEMPORAL_CATEGORY_ORDER) {
    const field = TEMPORAL_FIELD_BY_CATEGORY[category]
    const id = data[field]
    if (typeof id === "string" && id.length > 0) {
      enabled.push({ category, entryId: id })
    }
  }
  return enabled
}

function TemporalNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as TemporalData
  const enabled = collectEnabled(nodeData)
  const maxItemsPerRow = Math.max(1, Math.min(4, nodeData.maxItemsPerRow ?? 2))
  const gridColumns = Math.max(1, Math.min(maxItemsPerRow, enabled.length))

  return (
    <ParameterNodeShell
      id={id}
      label={nodeData.label}
      icon={<Clock />}
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
            rowGap: "1.25rem",
          }}
        >
          {enabled.map(({ category, entryId }) => {
            const entry = getTemporal(entryId)
            return (
              <div key={category} className="flex flex-col gap-1">
                <p className="text-foreground text-sm font-medium">
                  <span className="text-muted-foreground text-[11px] uppercase tracking-wider mr-1">
                    {TEMPORAL_CATEGORY_LABELS[category]}:
                  </span>
                  {getTemporalLabel(entryId)}
                </p>
                <TemporalPreview temporalId={entryId} className="w-full aspect-[16/9]" />
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
          Select a temporal category
        </p>
      )}
    </ParameterNodeShell>
  )
}

export const TemporalNode = memo(TemporalNodeComponent)
