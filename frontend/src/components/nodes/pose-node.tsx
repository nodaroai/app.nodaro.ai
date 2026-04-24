"use client"

import { memo } from "react"
import type { NodeProps } from "@xyflow/react"
import { PersonStanding } from "lucide-react"
import { getPose, getPoseLabel } from "@nodaro-shared/pose"
import { ParameterNodeShell } from "./parameter-node-shell"
import { PoseIcon } from "@/components/editor/config-panels/pose-icon"
import type { PoseData } from "@/types/nodes"

function PoseNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as PoseData
  const poseId = nodeData.pose || "standing-upright"
  const description = getPose(poseId)?.description

  return (
    <ParameterNodeShell id={id} label={nodeData.label} icon={<PersonStanding />} handleId="out" selected={selected} fluidWidth>
      <div className="flex items-center gap-2 min-w-0">
        <div className="flex-1 min-w-0">
          <p className="text-foreground text-sm font-medium truncate">
            {getPoseLabel(poseId)}
          </p>
          {description && (
            <p className="text-muted-foreground text-[11px] leading-snug">
              {description}
            </p>
          )}
        </div>
        <PoseIcon poseId={poseId} className="size-9 shrink-0 text-gray-600 dark:text-[#94A3B8]" />
      </div>
    </ParameterNodeShell>
  )
}

export const PoseNode = memo(PoseNodeComponent)
