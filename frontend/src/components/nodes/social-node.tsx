"use client"

import { memo } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { Instagram, Video, Youtube, Linkedin, Twitter, Facebook } from "lucide-react"
import { BaseNode } from "./base-node"
import { PLATFORM_LABELS } from "@/lib/social-media-specs"
import type { SocialPostData, SocialPlatformType } from "@/types/nodes"

const PLATFORM_ICONS: Record<SocialPlatformType, React.ReactNode> = {
  instagram: <Instagram className="h-4 w-4" />,
  tiktok: <Video className="h-4 w-4" />,
  youtube: <Youtube className="h-4 w-4" />,
  linkedin: <Linkedin className="h-4 w-4" />,
  x: <Twitter className="h-4 w-4" />,
  facebook: <Facebook className="h-4 w-4" />,
}

function SocialNodeComponent({ id, data, selected }: NodeProps) {
  const nodeData = data as SocialPostData
  const platform = nodeData.platform
  const icon = PLATFORM_ICONS[platform] || PLATFORM_ICONS.instagram

  const statusText = nodeData.executionStatus === "completed" && nodeData.platformPostUrl
    ? "Published ✓"
    : nodeData.executionStatus === "failed"
      ? "Failed"
      : nodeData.caption
        ? nodeData.caption.slice(0, 40) + (nodeData.caption.length > 40 ? "..." : "")
        : `Post to ${PLATFORM_LABELS[platform]}...`

  return (
    <BaseNode
      id={id}
      label={nodeData.label}
      icon={icon}
      category="output"
      credits={1}
      selected={selected}
      handles={[
        { id: "in", type: "target", position: Position.Left, label: "Media" },
      ]}
    >
      <p className="text-muted-foreground text-[11px] truncate max-w-[180px]">
        {statusText}
      </p>
    </BaseNode>
  )
}

export const SocialNode = memo(SocialNodeComponent)
