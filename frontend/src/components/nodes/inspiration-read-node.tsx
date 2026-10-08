"use client"

import { memo } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { Bookmark, Braces, Type } from "lucide-react"
import { useT } from "@/lib/i18n"
import { SOCIAL_PLATFORM_META } from "@/components/research/social-platforms"
import type { InspirationReadData } from "@/types/nodes"
import { DATA_HANDLE_COLORS } from "@/lib/data-handles"
import { HandleWithPopover, TEXT_HANDLE_COLOR } from "./handle-with-popover"
import { SocialReaderNodeCard } from "./social-reader-node-card"

/**
 * Read Inspiration — the posts saved to the person's Inspiration library in
 * the last N hours or days, or on one day; optionally one platform and one
 * tag. The card is the shared post feed card; the badge names the platform
 * (and the tag) it reads.
 */
function InspirationReadNodeComponent({ id, data, selected }: NodeProps) {
  const t = useT()
  const nodeData = data as InspirationReadData
  const platform = nodeData.platform && nodeData.platform !== "all" ? SOCIAL_PLATFORM_META[nodeData.platform]?.name : undefined
  const tag = typeof nodeData.tag === "string" ? nodeData.tag.trim().replace(/^#+/, "") : ""
  const badge = [platform ?? t("competitors.allPlatforms"), tag ? `#${tag}` : ""].filter(Boolean).join(" · ")
  return (
    <SocialReaderNodeCard
      id={id}
      data={nodeData}
      selected={selected}
      icon={<Bookmark className="h-4 w-4" />}
      smallIcon={<Bookmark className="w-3.5 h-3.5" />}
      header={t("nav.inspiration")}
      badge={badge}
      idleText={t("node.inspirationReads")}
      dialogTitle={t("node.inspirationAllPosts")}
      pips={
        <>
          <HandleWithPopover nodeId={id} nodeType="inspiration-read" handleId="text" type="source" position={Position.Right} label="Posts" color={TEXT_HANDLE_COLOR} icon={<Type />} side="right" top="24px" />
          <HandleWithPopover nodeId={id} nodeType="inspiration-read" handleId="json" type="source" position={Position.Right} label="JSON" color={DATA_HANDLE_COLORS.json} icon={<Braces />} side="right" top="52px" />
        </>
      }
    />
  )
}

export const InspirationReadNode = memo(InspirationReadNodeComponent)
