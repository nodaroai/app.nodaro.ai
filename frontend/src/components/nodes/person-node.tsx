"use client"
import { characterArtShape, useCatalogPacksVersion } from "@/lib/picker-ui"

import { useT } from "@/lib/i18n"
import { memo } from "react"
import { type NodeProps } from "@xyflow/react"
import { UserRound } from "lucide-react"
import { PERSON_DIMENSION_LABELS, getPerson, getPersonLabel } from "@nodaro/prompts"
import { ParameterNodeShell } from "./parameter-node-shell"
import { getPersonEntryIcon } from "./person-styling-icon"
import { CharacterPickRow } from "./character-pick-row"
import { personCardPicks } from "./character-card-picks"
import { usePickerJsonConsumer } from "./use-picker-json-consumer"
import { PICKER_JSON_INPUT_HANDLES, PickerJsonHandleIcon, PickerUpdateButton } from "./picker-json-handle"
import type { PersonData } from "@/types/nodes"

function PersonNodeComponent({ id, data, selected }: NodeProps) {
  const t = useT()
  useCatalogPacksVersion()
  const nodeData = data as PersonData
  // What the prompt uses: for a minor, adult-only picks (and their photos) are left out.
  const enabled = personCardPicks(nodeData)
  const maxItemsPerRow = Math.max(1, Math.min(4, nodeData.maxItemsPerRow ?? 2))
  const gridColumns = Math.max(1, Math.min(maxItemsPerRow, enabled.length))

  const { isConnected, hasPending, apply } = usePickerJsonConsumer("person", id, nodeData)

  return (
    <ParameterNodeShell
      id={id}
      label={nodeData.label}
      icon={<UserRound />}
      handleId="out"
      selected={selected}
      fluidWidth
      inputHandles={PICKER_JSON_INPUT_HANDLES}
      extraHandleIcons={<PickerJsonHandleIcon nodeId={id} nodeType="person" />}
      headerSlot={
        isConnected && !nodeData.autoApplyInjected ? (
          <PickerUpdateButton hasPending={hasPending} onApply={apply} />
        ) : null
      }
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
          {enabled.map(({ dimension, entryIds }) => {
            const entryId = entryIds[0]
            const entry = getPerson(entryId)
            // Multi-pick (ethnicity, hair-color, eye-color, distinctive-
            // features): primary label on the main line, additional picks
            // stacked underneath with a "+ " prefix so the card stays narrow.
            const extraIds = entryIds.slice(1)
            // Age + "age-custom" sentinel: show the user-typed number directly
            // ("8", "42") so the card reads as the actual age, not the
            // placeholder "Custom age…".
            const isAgeCustom = dimension === "age" && entryId === "age-custom"
            const customAgeNum =
              typeof nodeData.customAge === "number" ? nodeData.customAge : undefined
            const primaryLabel =
              isAgeCustom && customAgeNum !== undefined
                ? `${customAgeNum}`
                : getPersonLabel(entryId)
            const description =
              entryIds.length > 1
                ? undefined
                : isAgeCustom && customAgeNum !== undefined
                  ? t("node.customAge")
                  : entry?.description
            return (
              <CharacterPickRow
                key={dimension}
                family="person"
                id={entryId}
                shape={characterArtShape("person", dimension)}
                setLabel={PERSON_DIMENSION_LABELS[dimension]}
                value={primaryLabel}
                extras={extraIds.map((extraId) => getPersonLabel(extraId))}
                description={description}
                fallback={getPersonEntryIcon(dimension, entryId)}
              />
            )
          })}
        </div>
      ) : (
        <p className="text-muted-foreground text-sm italic">
          {t("node.pickATypeToBegin")}
        </p>
      )}
    </ParameterNodeShell>
  )
}

export const PersonNode = memo(PersonNodeComponent)
