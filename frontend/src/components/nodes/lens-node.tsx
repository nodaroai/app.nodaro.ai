"use client"

import { memo } from "react"
import type { NodeProps } from "@xyflow/react"
import { Aperture } from "lucide-react"
import { getLens, getLensLabel } from "@nodaro/prompts"
import { ParameterNodeShell } from "./parameter-node-shell"
import { LookPreviewStyleSwitch } from "./look-preview-style"
import { usePickerJsonConsumer } from "./use-picker-json-consumer"
import { PICKER_CONSUMER_INPUT_HANDLES, PickerJsonHandleIcon, PickerUpdateButton } from "./picker-json-handle"
import { LensPreview, LookArt } from "@/lib/picker-ui"
import type { LensData } from "@/types/nodes"

function LensNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as LensData
  const lensId = nodeData.lens || "normal-50mm"
  const description = getLens(lensId)?.description

  const { isConnected, hasPending, apply } = usePickerJsonConsumer("lens", id, nodeData)

  return (
    <ParameterNodeShell
      id={id}
      label={nodeData.label}
      icon={<Aperture />}
      handleId="out"
      selected={selected}
      fluidWidth
      inputHandles={PICKER_CONSUMER_INPUT_HANDLES}
      extraHandleIcons={<PickerJsonHandleIcon nodeId={id} nodeType="lens" />}
      headerSlot={isConnected && !nodeData.autoApplyInjected ? <PickerUpdateButton hasPending={hasPending} onApply={apply} /> : null}
    >
      <div className="flex items-start justify-between gap-2">
        <p className="text-foreground text-sm font-medium min-w-0">
          {getLensLabel(lensId)}
        </p>
        <LookPreviewStyleSwitch pickerKey="lens" />
      </div>
      <LookArt pickerKey="lens" id={lensId} className="w-full aspect-[16/9]" width={640} fallback={<LensPreview lensId={lensId} variant="hybrid" className="w-full aspect-[16/9]" />} />
      {description && (
        <p className="text-muted-foreground text-[11px] leading-snug">
          {description}
        </p>
      )}
    </ParameterNodeShell>
  )
}

export const LensNode = memo(LensNodeComponent)
