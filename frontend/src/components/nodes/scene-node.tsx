"use client"

import { memo } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { Clapperboard, Users, MapPin, Box } from "lucide-react"
import { BaseNode } from "./base-node"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import type { SceneNodeDataType } from "@/types/nodes"

function SceneNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as SceneNodeDataType
  const allCharDefs = useWorkflowStore((s) => s.characterDefinitions)

  const charCount = nodeData.characters.length
  const objCount = nodeData.objects.length
  const locationAsset = nodeData.locationAssetId
    ? allCharDefs.find((c) => c.id === nodeData.locationAssetId)
    : undefined

  return (
    <BaseNode
      id={id}
      label={nodeData.sceneName || nodeData.label}
      icon={<Clapperboard className="h-4 w-4" />}
      category="scene"
      credits={0}
      selected={selected}
      handles={[
        { id: "in", type: "target", position: Position.Left, label: "Input" },
        { id: "prompt", type: "source", position: Position.Right, label: "Prompt", top: "25%" },
        { id: "imageRefs", type: "source", position: Position.Right, label: "Refs", top: "45%" },
        { id: "narration", type: "source", position: Position.Right, label: "Narration", top: "65%" },
        { id: "duration", type: "source", position: Position.Right, label: "Duration", top: "85%" },
      ]}
    >
      <div className="flex flex-col gap-1.5">
        {/* Location thumbnail */}
        {locationAsset?.referenceImageUrl ? (
          <img
            src={locationAsset.referenceImageUrl}
            alt={locationAsset.name}
            className="w-full h-20 object-cover rounded-md"
          />
        ) : (
          <div className="flex items-center justify-center h-20 rounded-md border-2 border-dashed border-muted-foreground/20 text-muted-foreground/40">
            <Clapperboard className="w-5 h-5" />
          </div>
        )}

        {/* Summary */}
        {nodeData.summary && (
          <p className="text-[10px] text-muted-foreground line-clamp-2">{nodeData.summary}</p>
        )}

        {/* Metadata row */}
        <div className="flex items-center gap-2 text-muted-foreground flex-wrap">
          <span className="text-[9px] px-1.5 py-0.5 rounded bg-violet-500/10 text-violet-500">
            {nodeData.shotType}
          </span>
          <span className="text-[9px]">{nodeData.duration}s</span>
          {charCount > 0 && (
            <span className="flex items-center gap-0.5 text-[9px]" title={`${charCount} character${charCount !== 1 ? "s" : ""}`}>
              <Users className="w-2.5 h-2.5" /> {charCount}
            </span>
          )}
          {locationAsset && (
            <span className="flex items-center gap-0.5 text-[9px]" title={locationAsset.name}>
              <MapPin className="w-2.5 h-2.5" />
            </span>
          )}
          {objCount > 0 && (
            <span className="flex items-center gap-0.5 text-[9px]" title={`${objCount} object${objCount !== 1 ? "s" : ""}`}>
              <Box className="w-2.5 h-2.5" /> {objCount}
            </span>
          )}
        </div>
      </div>
    </BaseNode>
  )
}

export const SceneNode = memo(SceneNodeComponent)
