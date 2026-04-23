"use client"

import { memo } from "react"
import type { NodeProps } from "@xyflow/react"
import { Mountain } from "lucide-react"
import { getSetting, getSettingLabel } from "@nodaro-shared/setting"
import { ParameterNodeShell } from "./parameter-node-shell"
import { SettingPreview } from "@/components/editor/config-panels/setting-preview"
import type { SettingData } from "@/types/nodes"

function SettingNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as SettingData
  const settingId = nodeData.setting || "forest"
  const description = getSetting(settingId)?.description

  return (
    <ParameterNodeShell id={id} label={nodeData.label} icon={<Mountain />} handleId="out" selected={selected} fluidWidth>
      <p className="text-foreground text-sm font-medium">
        {getSettingLabel(settingId)}
      </p>
      <SettingPreview settingId={settingId} className="w-full aspect-[16/9]" />
      {description && (
        <p className="text-muted-foreground text-[11px] leading-snug">
          {description}
        </p>
      )}
    </ParameterNodeShell>
  )
}

export const SettingNode = memo(SettingNodeComponent)
