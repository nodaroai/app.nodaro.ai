"use client"

import { memo } from "react"
import type { NodeProps } from "@xyflow/react"
import { Music } from "lucide-react"
import {
  getMusicGenreLabel,
  getMusicSubgenre,
  getMusicEra,
  buildMusicGenreHints,
  pickIds,
} from "@nodaro/shared"
import { ParameterNodeShell } from "./parameter-node-shell"
import type { MusicGenreData } from "@/types/nodes"

function MusicGenreNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as MusicGenreData
  const genreIds = pickIds(nodeData.genre)
  const era = getMusicEra(nodeData.era)
  const composed = buildMusicGenreHints(nodeData)

  // Multi-pick: join genre labels with " / "; subgenre is meaningless in
  // multi-mode. Single-pick: subgenre label takes precedence over genre.
  let primaryLabel = ""
  if (genreIds.length > 1) {
    primaryLabel = genreIds.map((id) => getMusicGenreLabel(id)).filter(Boolean).join(" / ")
  } else if (genreIds.length === 1) {
    const subgenre = getMusicSubgenre(genreIds[0], nodeData.subgenre)
    primaryLabel = subgenre?.label ?? getMusicGenreLabel(genreIds[0])
  }

  return (
    <ParameterNodeShell id={id} label={nodeData.label} icon={<Music />} handleId="out" selected={selected} fluidWidth>
      <p className="text-foreground text-sm font-medium">
        {primaryLabel || "Music Genre"}
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
