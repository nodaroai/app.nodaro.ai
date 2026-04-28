"use client"

import { memo } from "react"
import type { NodeProps } from "@xyflow/react"
import { Frame } from "lucide-react"
import {
  FRAMING_CATEGORY_LABELS,
  FRAMING_CATEGORY_ORDER,
  FRAMING_FIELD_BY_CATEGORY,
  getFraming,
  getFramingLabel,
  type FramingCategory,
} from "@nodaro/shared"
import { ParameterNodeShell } from "./parameter-node-shell"
import { FramingPreview } from "@/components/editor/config-panels/framing-preview"
import type { FramingData } from "@/types/nodes"

interface EnabledEntry {
  readonly category: FramingCategory
  readonly entryId: string
}

function collectEnabled(data: FramingData): EnabledEntry[] {
  const enabled: EnabledEntry[] = []
  for (const category of FRAMING_CATEGORY_ORDER) {
    const field = FRAMING_FIELD_BY_CATEGORY[category]
    const id = data[field]
    if (typeof id === "string" && id.length > 0) {
      enabled.push({ category, entryId: id })
    }
  }
  return enabled
}

function FramingNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as FramingData
  const enabled = collectEnabled(nodeData)
  const maxItemsPerRow = Math.max(1, Math.min(5, nodeData.maxItemsPerRow ?? 2))
  // Cap grid columns to the actual number of enabled entries — a lone
  // selection fills the row instead of sitting at half-width.
  const gridColumns = Math.max(1, Math.min(maxItemsPerRow, enabled.length))

  return (
    <ParameterNodeShell
      id={id}
      label={nodeData.label}
      icon={<Frame />}
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
            const entry = getFraming(entryId)
            return (
              <div key={category} className="flex flex-col gap-1">
                <p className="text-foreground text-sm font-medium">
                  <span className="text-muted-foreground text-[11px] uppercase tracking-wider mr-1">
                    {FRAMING_CATEGORY_LABELS[category]}:
                  </span>
                  {getFramingLabel(entryId)}
                </p>
                <FramingPreview framingId={entryId} className="w-full aspect-[16/9]" />
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
          Select a framing category
        </p>
      )}
    </ParameterNodeShell>
  )
}

export const FramingNode = memo(FramingNodeComponent)
