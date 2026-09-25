"use client"

import { useT } from "@/lib/i18n"
import { memo } from "react"
import type { NodeProps } from "@xyflow/react"
import { Gem } from "lucide-react"
import { STYLING_DIMENSION_LABELS, getStyling, getStylingLabel } from "@nodaro/prompts"
import { ParameterNodeShell } from "./parameter-node-shell"
import { getStylingEntryIcon } from "./person-styling-icon"
import { CharacterPickRow } from "./character-pick-row"
import { stylingCardPicks } from "./character-card-picks"
import { usePickerJsonConsumer } from "./use-picker-json-consumer"
import { PICKER_CONSUMER_INPUT_HANDLES, PickerJsonHandleIcon, PickerUpdateButton } from "./picker-json-handle"
import type { StylingData } from "@/types/nodes"

function StylingNodeComponent({ id, data, selected }: NodeProps) {
  const t = useT()
  const nodeData = data as StylingData
  const enabled = stylingCardPicks(nodeData)
  const maxItemsPerRow = Math.max(1, Math.min(4, nodeData.maxItemsPerRow ?? 2))
  const gridColumns = Math.max(1, Math.min(maxItemsPerRow, enabled.length))

  const { isConnected, hasPending, apply } = usePickerJsonConsumer("styling", id, nodeData)

  return (
    <ParameterNodeShell
      id={id}
      label={nodeData.label}
      icon={<Gem />}
      handleId="out"
      selected={selected}
      fluidWidth
      inputHandles={PICKER_CONSUMER_INPUT_HANDLES}
      extraHandleIcons={<PickerJsonHandleIcon nodeId={id} nodeType="styling" />}
      headerSlot={isConnected && !nodeData.autoApplyInjected ? <PickerUpdateButton hasPending={hasPending} onApply={apply} /> : null}
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
          {enabled.map(({ dimension, entryIds: [entryId, ...extraIds] }) => (
            <CharacterPickRow
              key={dimension}
              family="styling"
              id={entryId}
              setLabel={STYLING_DIMENSION_LABELS[dimension]}
              value={getStylingLabel(entryId)}
              extras={extraIds.map((extraId) => getStylingLabel(extraId))}
              description={extraIds.length === 0 ? getStyling(entryId)?.description : undefined}
              fallback={getStylingEntryIcon(dimension, entryId)}
            />
          ))}
        </div>
      ) : (
        <p className="text-muted-foreground text-sm italic">
          {t("node.pickAStylingDimensionTo")}
        </p>
      )}
    </ParameterNodeShell>
  )
}

export const StylingNode = memo(StylingNodeComponent)
