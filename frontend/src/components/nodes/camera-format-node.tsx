"use client"

import { memo } from "react"
import type { NodeProps } from "@xyflow/react"
import { Film } from "lucide-react"
import { getCameraFormat, getCameraFormatLabel } from "@nodaro-shared/camera-format"
import { ParameterNodeShell } from "./parameter-node-shell"
import { CameraFormatPreview } from "@/components/editor/config-panels/camera-format-preview"
import type { CameraFormatData } from "@/types/nodes"

function CameraFormatNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as CameraFormatData
  const cameraFormatId = nodeData.cameraFormat || "35mm-film"
  const description = getCameraFormat(cameraFormatId)?.description

  return (
    <ParameterNodeShell id={id} label={nodeData.label} icon={<Film />} handleId="out" selected={selected} fluidWidth>
      <p className="text-foreground text-sm font-medium">
        {getCameraFormatLabel(cameraFormatId)}
      </p>
      <CameraFormatPreview cameraFormatId={cameraFormatId} className="w-full aspect-[16/9]" />
      {description && (
        <p className="text-muted-foreground text-[11px] leading-snug">
          {description}
        </p>
      )}
    </ParameterNodeShell>
  )
}

export const CameraFormatNode = memo(CameraFormatNodeComponent)
