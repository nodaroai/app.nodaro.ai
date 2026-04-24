"use client"

import { memo } from "react"
import type { NodeProps } from "@xyflow/react"
import { Swords } from "lucide-react"
import { getWeapon, getWeaponLabel } from "@nodaro-shared/weapons"
import { ParameterNodeShell } from "./parameter-node-shell"
import type { WeaponData } from "@/types/nodes"

function WeaponNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as WeaponData
  const weaponId = nodeData.weapon || "katana"
  const weapon = getWeapon(weaponId)

  return (
    <ParameterNodeShell id={id} label={nodeData.label} icon={<Swords />} handleId="out" selected={selected}>
      <p className="text-foreground text-sm font-medium">
        {getWeaponLabel(weaponId)}
      </p>
      {weapon?.description && (
        <p className="text-muted-foreground text-[11px] leading-snug line-clamp-3">
          {weapon.description}
        </p>
      )}
    </ParameterNodeShell>
  )
}

export const WeaponNode = memo(WeaponNodeComponent)
