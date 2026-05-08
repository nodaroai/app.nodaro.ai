"use client"

import { memo } from "react"
import type { NodeProps } from "@xyflow/react"
import { Music } from "lucide-react"
import {
  getMusicGenreLabel,
  getMusicSubgenre,
  getMusicEra,
  buildMusicGenreHints,
} from "@nodaro/shared"
import { ParameterNodeShell } from "./parameter-node-shell"
import type { MusicGenreData } from "@/types/nodes"

function MusicGenreNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as MusicGenreData
  const subgenre = getMusicSubgenre(nodeData.genre, nodeData.subgenre)
  const era = getMusicEra(nodeData.era)
  const genreLabel = subgenre?.label ?? getMusicGenreLabel(nodeData.genre)
  const composed = buildMusicGenreHints(nodeData)

  return (
    <ParameterNodeShell id={id} label={nodeData.label} icon={<Music />} handleId="out" selected={selected} fluidWidth>
      <p className="text-foreground text-sm font-medium">
        {genreLabel || "Music Genre"}
      </p>
      {era && (
        <p className="text-muted-foreground text-[11px] leading-snug">{era.label}</p>
      )}
      {composed && (
        <p className="text-muted-foreground text-[10px] italic leading-snug">{composed}</p>
      )}
    </ParameterNodeShell>
  )
}

export const MusicGenreNode = memo(MusicGenreNodeComponent)
