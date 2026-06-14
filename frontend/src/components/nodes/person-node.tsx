"use client"

import { memo, useEffect, useMemo } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { useShallow } from "zustand/react/shallow"
import { UserRound, ScanFace } from "lucide-react"
import {
  PERSON_DIMENSION_LABELS,
  PERSON_DIMENSION_ORDER,
  PERSON_FIELD_BY_DIMENSION,
  getPerson,
  getPersonLabel,
  pickIds,
  type PersonDimension,
} from "@nodaro/shared"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { ParameterNodeShell } from "./parameter-node-shell"
import { HandleWithPopover, HANDLE_COLORS } from "./handle-with-popover"
import { getPersonEntryIcon } from "./person-styling-icon"
import { ACCEPTS_PICKER_JSON } from "@/lib/target-handle-registry"
import { pickerJsonKey, computeInjectionPatch } from "./person-injection"
import type { HandleConfig } from "./base-node"
import type { PersonData, DescribeToPickerData } from "@/types/nodes"

const PICKER_JSON_TOP = "calc(100% - 25px)"

// Hoisted so React Flow's reference equality on handles holds across renders.
// `external: true` — BaseNode counts this for sizing but doesn't render it; the
// typed pip is owned by <HandleWithPopover> below (mirrors character-fx-node +
// camera-motion-node). `left`/`top` match the HandleConfig and the popover.
const INPUT_HANDLES: ReadonlyArray<HandleConfig> = [
  { id: "picker-json", type: "target", position: Position.Left, customStyle: { top: PICKER_JSON_TOP, left: "-29px" }, hideHandle: true, external: true },
]

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
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const enabled = collectEnabled(nodeData)
  const maxItemsPerRow = Math.max(1, Math.min(4, nodeData.maxItemsPerRow ?? 2))
  const gridColumns = Math.max(1, Math.min(maxItemsPerRow, enabled.length))

  // Narrow subscription: a primitive fingerprint of the `picker-json`-handle
  // source (id + full data). Mirrors video-retake-node — serialize the one
  // connected source's data wholesale so the `injected` memo re-runs (and the
  // pending flag re-derives) when the upstream describe-to-picker result
  // changes, while avoiding a whole-array `s.nodes` / `s.edges` subscription
  // that would re-render every person node on any graph mutation.
  const fingerprint = useWorkflowStore(
    useShallow((s) => {
      const edge = s.edges.find((e) => e.target === id && e.targetHandle === "picker-json")
      if (!edge) return ""
      const src = s.nodes.find((n) => n.id === edge.source)
      if (!src) return `${edge.id}\x01${edge.source}`
      return `${edge.id}\x01${src.id}\x01${JSON.stringify(src.data ?? {})}`
    }),
  )

  // Read the upstream describe-to-picker's generatedPickerJson via live state,
  // keyed on the fingerprint so it stays current without a whole-array sub.
  const injected = useMemo<Record<string, unknown> | undefined>(() => {
    const { nodes, edges } = useWorkflowStore.getState()
    const edge = edges.find((e) => e.target === id && e.targetHandle === "picker-json")
    if (!edge) return undefined
    const src = nodes.find((n) => n.id === edge.source)
    const d = src?.data as DescribeToPickerData | undefined
    return d?.generatedPickerJson
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id, fingerprint])

  // `fingerprint` is "" exactly when there's no picker-json edge (see the
  // selector above), so connection state derives from it — no extra subscription.
  const isConnected = fingerprint !== ""
  const hasPending = !!injected && pickerJsonKey(injected) !== pickerJsonKey(nodeData.lastAppliedPickerJson)
  const mode = nodeData.applyMode ?? "override"

  const apply = () => {
    if (!injected) return
    updateNodeData(id, computeInjectionPatch(nodeData, injected, mode))
  }

  // Auto-apply on upstream change. After applying, lastAppliedPickerJson is set
  // to `injected` → on the next render hasPending becomes false, so this effect
  // re-runs but short-circuits at the guard — no apply loop.
  useEffect(() => {
    if (!nodeData.autoApplyInjected || !injected || !hasPending) return
    updateNodeData(id, computeInjectionPatch(nodeData, injected, mode))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [injected, hasPending, nodeData.autoApplyInjected, mode, id])

  return (
    <ParameterNodeShell
      id={id}
      label={nodeData.label}
      icon={<UserRound />}
      handleId="out"
      selected={selected}
      fluidWidth
      inputHandles={INPUT_HANDLES}
      extraHandleIcons={
        <HandleWithPopover
          nodeId={id}
          handleId="picker-json"
          nodeType="person"
          type="target"
          position={Position.Left}
          label="Picker JSON"
          color={HANDLE_COLORS.pickerJson}
          icon={<ScanFace className="w-3.5 h-3.5" />}
          accepts={ACCEPTS_PICKER_JSON}
          side="left"
          top={PICKER_JSON_TOP}
          // Single ambiguous input pip — pin the label visible so it's clear
          // this accepts an image→picker analysis result, not arbitrary output.
          alwaysShowLabel
        />
      }
    >
      {isConnected && !nodeData.autoApplyInjected && (
        <button
          type="button"
          disabled={!hasPending}
          onClick={apply}
          className={`mb-2 w-full rounded-md px-2 py-1 text-xs font-medium ${
            hasPending
              ? "bg-[#ff0073] text-white hover:bg-[#ff0073]/90"
              : "bg-muted text-muted-foreground cursor-not-allowed"
          }`}
        >
          {hasPending ? "⚡ Update from injected" : "Up to date"}
        </button>
      )}
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
                      {primaryLabel}
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
                {entryIds.length === 1 && (
                  isAgeCustom && customAgeNum !== undefined ? (
                    <p className="text-muted-foreground text-[10.5px] leading-snug">
                      Custom age
                    </p>
                  ) : entry?.description ? (
                    <p className="text-muted-foreground text-[10.5px] leading-snug">
                      {entry.description}
                    </p>
                  ) : null
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
