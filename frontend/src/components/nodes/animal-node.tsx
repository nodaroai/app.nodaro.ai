"use client"

import { memo } from "react"
import type { NodeProps } from "@xyflow/react"
import { PawPrint } from "lucide-react"
import { getAnimal, getAnimalLabel } from "@nodaro/shared"
import { ParameterNodeShell } from "./parameter-node-shell"
import { CharacterPickRow } from "./character-pick-row"
import { ANIMAL_ICON_FOR } from "@/lib/picker-ui"
import type { AnimalData } from "@/types/nodes"

function AnimalNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as AnimalData
  const animalId = nodeData.animal || "dog-golden-retriever"

  return (
    <ParameterNodeShell id={id} label={nodeData.label} icon={<PawPrint />} handleId="out" selected={selected}>
      <CharacterPickRow
        family="animals"
        id={animalId}
        value={getAnimalLabel(animalId)}
        description={getAnimal(animalId)?.description}
        fallback={<span className="text-3xl leading-none">{ANIMAL_ICON_FOR(animalId)}</span>}
      />
    </ParameterNodeShell>
  )
}

export const AnimalNode = memo(AnimalNodeComponent)
