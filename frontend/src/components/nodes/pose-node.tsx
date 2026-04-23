"use client"

import { memo } from "react"
import type { NodeProps } from "@xyflow/react"
import { PersonStanding } from "lucide-react"
import { getPose, getPoseLabel } from "@nodaro-shared/pose"
import { ParameterNodeShell } from "./parameter-node-shell"
import type { PoseData } from "@/types/nodes"

function PoseNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as PoseData
  const poseId = nodeData.pose || "standing-upright"
  const description = getPose(poseId)?.description

  return (
    <ParameterNodeShell id={id} label={nodeData.label} icon={<PersonStanding />} handleId="out" selected={selected} fluidWidth>
      <p className="text-foreground text-sm font-medium">
        {getPoseLabel(poseId)}
      </p>
      {description && (
        <p className="text-muted-foreground text-[11px] leading-snug">
          {description}
        </p>
      )}
    </ParameterNodeShell>
  )
}

export const PoseNode = memo(PoseNodeComponent)
