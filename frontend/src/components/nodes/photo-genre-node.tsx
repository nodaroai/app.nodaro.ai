"use client"

import { memo } from "react"
import type { NodeProps } from "@xyflow/react"
import { Camera } from "lucide-react"
import { getPhotoGenre, getPhotoGenreLabel } from "@nodaro/shared"
import { ParameterNodeShell } from "./parameter-node-shell"
import type { PhotoGenreData } from "@/types/nodes"

function PhotoGenreNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as PhotoGenreData
  const genreId = nodeData.photoGenre || "fashion-editorial"
  const genre = getPhotoGenre(genreId)

  return (
    <ParameterNodeShell id={id} label={nodeData.label} icon={<Camera />} handleId="out" selected={selected}>
      <p className="text-foreground text-sm font-medium">
        {getPhotoGenreLabel(genreId)}
      </p>
      {genre?.description && (
        <p className="text-muted-foreground text-[11px] leading-snug line-clamp-3">
          {genre.description}
        </p>
      )}
    </ParameterNodeShell>
  )
}

export const PhotoGenreNode = memo(PhotoGenreNodeComponent)
