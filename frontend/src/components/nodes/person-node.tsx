"use client"

import { memo } from "react"
import type { NodeProps } from "@xyflow/react"
import { UserRound } from "lucide-react"
import {
  PERSON_DIMENSION_LABELS,
  PERSON_DIMENSION_ORDER,
  PERSON_FIELD_BY_DIMENSION,
  getPerson,
  getPersonLabel,
  type PersonDimension,
} from "@nodaro-shared/person"
import { ParameterNodeShell } from "./parameter-node-shell"
import type { PersonData } from "@/types/nodes"

interface EnabledEntry {
  readonly dimension: PersonDimension
  readonly entryId: string
}

function collectEnabled(data: PersonData): EnabledEntry[] {
  const enabled: EnabledEntry[] = []
  for (const dimension of PERSON_DIMENSION_ORDER) {
    const field = PERSON_FIELD_BY_DIMENSION[dimension]
    const id = data[field]
    if (typeof id === "string" && id.length > 0) {
      enabled.push({ dimension, entryId: id })
    }
  }
  return enabled
}

function PersonNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as PersonData
  const enabled = collectEnabled(nodeData)
  const maxItemsPerRow = Math.max(1, Math.min(4, nodeData.maxItemsPerRow ?? 2))
  const gridColumns = Math.max(1, Math.min(maxItemsPerRow, enabled.length))

  return (
    <ParameterNodeShell
      id={id}
      label={nodeData.label}
      icon={<UserRound />}
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
            const entry = getPerson(entryId)
            return (
              <div key={dimension} className="flex flex-col gap-0.5">
                <p className="text-muted-foreground text-[10px] uppercase tracking-wider">
                  {PERSON_DIMENSION_LABELS[dimension]}
                </p>
                <p className="text-foreground text-sm font-medium leading-tight">
                  {getPersonLabel(entryId)}
                </p>
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
          Pick a Type to begin
        </p>
      )}
    </ParameterNodeShell>
  )
}

export const PersonNode = memo(PersonNodeComponent)
