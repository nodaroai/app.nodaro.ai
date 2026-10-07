"use client"

import { memo } from "react"
import { Position, type NodeProps } from "@xyflow/react"
import { Braces, Radar, Type } from "lucide-react"
import { useT } from "@/lib/i18n"
import { useCompetitors } from "@/hooks/queries/use-competitors-queries"
import type { CompetitorReadData } from "@/types/nodes"
import { DATA_HANDLE_COLORS } from "@/lib/data-handles"
import { HandleWithPopover, TEXT_HANDLE_COLOR } from "./handle-with-popover"
import { SocialReaderNodeCard } from "./social-reader-node-card"

/**
 * Read Competitor — a tracked brand's posts as its scans found them, in the
 * last N hours or days or on one day; optionally one platform and the brand's
 * own posts or the posts about it. The card is the shared post feed card; the
 * badge is the brand, looked up live by id (a template carries an id that is
 * not the reader's; a rename shows at once).
 */
function CompetitorReadNodeComponent({ id, data, selected }: NodeProps) {
  const t = useT()
  const nodeData = data as CompetitorReadData
  const { data: brands } = useCompetitors()
  const name = (brands ? brands.find((b) => b.id === nodeData.competitorId)?.brand : nodeData.competitorName) ?? ""
  return (
    <SocialReaderNodeCard
      id={id}
      data={nodeData}
      selected={selected}
      icon={<Radar className="h-4 w-4" />}
      smallIcon={<Radar className="w-3.5 h-3.5" />}
      header={t("node.competitorHeader")}
      badge={name || undefined}
      idleText={name ? t("node.competitorReads", { name }) : t("node.competitorPick")}
      dialogTitle={name ? t("node.competitorAllPosts", { name }) : t("node.competitorHeader")}
      pips={
        <>
          <HandleWithPopover nodeId={id} nodeType="competitor-read" handleId="text" type="source" position={Position.Right} label="Posts" color={TEXT_HANDLE_COLOR} icon={<Type />} side="right" top="24px" />
          <HandleWithPopover nodeId={id} nodeType="competitor-read" handleId="json" type="source" position={Position.Right} label="JSON" color={DATA_HANDLE_COLORS.json} icon={<Braces />} side="right" top="52px" />
        </>
      }
    />
  )
}

export const CompetitorReadNode = memo(CompetitorReadNodeComponent)
