"use client"

import { memo } from "react"
import type { NodeProps } from "@xyflow/react"
import { PawPrint } from "lucide-react"
import { getAnimal, getAnimalLabel } from "@nodaro-shared/animals"
import { ParameterNodeShell } from "./parameter-node-shell"
import type { AnimalData } from "@/types/nodes"

function AnimalNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as AnimalData
  const animalId = nodeData.animal || "dog-golden-retriever"
  const animal = getAnimal(animalId)

  return (
    <ParameterNodeShell id={id} label={nodeData.label} icon={<PawPrint />} handleId="out" selected={selected}>
      <p className="text-foreground text-sm font-medium">
        {getAnimalLabel(animalId)}
      </p>
      {animal?.description && (
        <p className="text-muted-foreground text-[11px] leading-snug line-clamp-3">
          {animal.description}
        </p>
      )}
    </ParameterNodeShell>
  )
}

export const AnimalNode = memo(AnimalNodeComponent)
