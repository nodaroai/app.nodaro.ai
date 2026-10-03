"use client"

import { memo } from "react"
import type { NodeProps } from "@xyflow/react"
import { Hash } from "lucide-react"
import { ParameterNodeShell } from "./parameter-node-shell"
import type { SceneCountData } from "@/types/nodes"
import { useT } from "@/lib/i18n"

function SceneCountNodeComponent({ id, data, selected }: NodeProps) {
  const t = useT()
  const nodeData = data as SceneCountData

  return (
    <ParameterNodeShell id={id} label={nodeData.label} icon={<Hash />} handleId="count" selected={selected}>
      <p className="text-muted-foreground text-xs">
        {t("node.nScenes", { n: nodeData.count })}
      </p>
    </ParameterNodeShell>
  )
}

export const SceneCountNode = memo(SceneCountNodeComponent)
