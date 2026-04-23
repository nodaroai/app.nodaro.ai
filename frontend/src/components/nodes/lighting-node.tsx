"use client"

import { memo } from "react"
import type { NodeProps } from "@xyflow/react"
import { Lightbulb } from "lucide-react"
import {
  LIGHTING_CATEGORY_LABELS,
  LIGHTING_CATEGORY_ORDER,
  LIGHTING_FIELD_BY_CATEGORY,
  getLighting,
  getLightingLabel,
  type LightingCategory,
} from "@nodaro-shared/lighting"
import { ParameterNodeShell } from "./parameter-node-shell"
import { LightingPreview } from "@/components/editor/config-panels/lighting-preview"
import type { LightingData } from "@/types/nodes"

interface EnabledEntry {
  readonly category: LightingCategory
  readonly entryId: string
}

function collectEnabled(data: LightingData): EnabledEntry[] {
  const enabled: EnabledEntry[] = []
  for (const category of LIGHTING_CATEGORY_ORDER) {
    const field = LIGHTING_FIELD_BY_CATEGORY[category]
    const id = data[field]
    if (typeof id === "string" && id.length > 0) {
      enabled.push({ category, entryId: id })
    }
  }
  return enabled
}

function LightingNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as LightingData
  const enabled = collectEnabled(nodeData)
  const maxItemsPerRow = Math.max(1, Math.min(3, nodeData.maxItemsPerRow ?? 1))

  return (
    <ParameterNodeShell
      id={id}
      label={nodeData.label}
      icon={<Lightbulb />}
      handleId="out"
      selected={selected}
      fluidWidth
    >
      {enabled.length > 0 ? (
        <div
          style={{
            display: "grid",
            gridTemplateColumns: `repeat(${maxItemsPerRow}, minmax(0, 1fr))`,
            columnGap: "0.5rem",
            rowGap: "1.25rem",
          }}
        >
          {enabled.map(({ category, entryId }) => {
            const entry = getLighting(entryId)
            return (
              <div key={category} className="flex flex-col gap-1">
                <p className="text-foreground text-sm font-medium">
                  <span className="text-muted-foreground text-[11px] uppercase tracking-wider mr-1">
                    {LIGHTING_CATEGORY_LABELS[category]}:
                  </span>
                  {getLightingLabel(entryId)}
                </p>
                <LightingPreview lightingId={entryId} className="w-full aspect-[16/9]" />
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
          Select a lighting category
        </p>
      )}
    </ParameterNodeShell>
  )
}

export const LightingNode = memo(LightingNodeComponent)
