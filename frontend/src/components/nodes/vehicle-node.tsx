"use client"

import { memo } from "react"
import type { NodeProps } from "@xyflow/react"
import { Car } from "lucide-react"
import { getVehicle, getVehicleLabel } from "@nodaro-shared/vehicles"
import { ParameterNodeShell } from "./parameter-node-shell"
import type { VehicleData } from "@/types/nodes"

function VehicleNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as VehicleData
  const vehicleId = nodeData.vehicle || "sedan"
  const vehicle = getVehicle(vehicleId)

  return (
    <ParameterNodeShell id={id} label={nodeData.label} icon={<Car />} handleId="out" selected={selected}>
      <p className="text-foreground text-sm font-medium">
        {getVehicleLabel(vehicleId)}
      </p>
      {vehicle?.description && (
        <p className="text-muted-foreground text-[11px] leading-snug line-clamp-3">
          {vehicle.description}
        </p>
      )}
    </ParameterNodeShell>
  )
}

export const VehicleNode = memo(VehicleNodeComponent)
