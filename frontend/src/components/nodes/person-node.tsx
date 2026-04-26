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
import { pickIds } from "@nodaro-shared/multi-pick"
import { ParameterNodeShell } from "./parameter-node-shell"
import { getPersonEntryIcon } from "./person-styling-icon"
import type { PersonData } from "@/types/nodes"

interface EnabledEntry {
  readonly dimension: PersonDimension
  /** First / primary id — drives the icon and (for single-pick dims) the label. */
  readonly entryId: string
  /** All picked ids in order. Length 1 for single-pick dims. */
  readonly entryIds: ReadonlyArray<string>
}

function collectEnabled(data: PersonData): EnabledEntry[] {
  const enabled: EnabledEntry[] = []
  for (const dimension of PERSON_DIMENSION_ORDER) {
    const field = PERSON_FIELD_BY_DIMENSION[dimension]
    const ids = pickIds(data[field])
    if (ids.length === 0) continue
    enabled.push({ dimension, entryId: ids[0], entryIds: ids })
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
          {enabled.map(({ dimension, entryId, entryIds }) => {
            const entry = getPerson(entryId)
            const icon = getPersonEntryIcon(dimension, entryId)
            // Multi-pick (ethnicity, hair-color, eye-color, distinctive-
            // features): primary label on the main line, additional picks
            // stacked underneath with a "+ " prefix so the chip stays narrow.
            const extraIds = entryIds.slice(1)
            return (
              <div key={dimension} className="flex flex-col gap-0.5 min-w-0">
                {/* Top row holds the dim label + entry name; the icon sits on
                    the right and vertically centers against those two lines.
                    The description (if any) breaks below at full width. */}
                <div className="flex items-center gap-2 min-w-0">
                  <div className="flex flex-col gap-0.5 min-w-0 flex-1">
                    <p className="text-muted-foreground text-[10px] uppercase tracking-wider truncate">
                      {PERSON_DIMENSION_LABELS[dimension]}
                    </p>
                    <p className="text-foreground text-sm font-medium leading-tight truncate">
                      {getPersonLabel(entryId)}
                    </p>
                    {extraIds.map((extraId) => (
                      <p
                        key={extraId}
                        className="text-foreground/80 text-xs leading-tight truncate"
                      >
                        <span className="text-muted-foreground">+ </span>
                        {getPersonLabel(extraId)}
                      </p>
                    ))}
                  </div>
                  {icon && (
                    <div className="shrink-0 flex items-center justify-center">
                      {icon}
                    </div>
                  )}
                </div>
                {entry?.description && entryIds.length === 1 && (
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
