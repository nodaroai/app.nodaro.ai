"use client"

import { memo } from "react"
import { useT } from "@/lib/i18n"
import type { NodeProps } from "@xyflow/react"
import { Cpu } from "lucide-react"
import { getModel } from "@nodaro/shared"
import { ParameterNodeShell } from "./parameter-node-shell"
import type { ProviderData } from "@/types/nodes"

function ProviderNodeComponent({ id, data, selected }: NodeProps) {
  const t = useT()
  const nodeData = data as ProviderData
  // The model's catalog name ("Seedance 2"); an id the catalog doesn't know shows as stored.
  const modelLabel = nodeData.provider ? (getModel(nodeData.provider)?.label ?? nodeData.provider) : undefined

  return (
    <ParameterNodeShell id={id} label={nodeData.label} icon={<Cpu />} handleId="provider" selected={selected}>
      <p className="text-muted-foreground truncate max-w-[180px] text-xs">
        {modelLabel ?? t("node.selectProviderPlaceholder")}
      </p>
    </ParameterNodeShell>
  )
}

export const ProviderNode = memo(ProviderNodeComponent)
