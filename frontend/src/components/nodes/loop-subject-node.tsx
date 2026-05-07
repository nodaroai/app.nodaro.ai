"use client"

import { memo } from "react"
import type { NodeProps } from "@xyflow/react"
import { Repeat } from "lucide-react"
import { getLoopSubject, getLoopSubjectLabel } from "@nodaro/shared"
import { ParameterNodeShell } from "./parameter-node-shell"
import type { LoopSubjectData } from "@/types/nodes"

function LoopSubjectNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as LoopSubjectData
  const subjectId = nodeData.loopSubject || "tunnel"
  const subject = getLoopSubject(subjectId)

  return (
    <ParameterNodeShell id={id} label={nodeData.label} icon={<Repeat />} handleId="out" selected={selected} fluidWidth>
      <p className="text-foreground text-sm font-medium">
        {getLoopSubjectLabel(subjectId)}
      </p>
      {subject?.description && (
        <p className="text-muted-foreground text-[11px] leading-snug">
          {subject.description}
        </p>
      )}
    </ParameterNodeShell>
  )
}

export const LoopSubjectNode = memo(LoopSubjectNodeComponent)
