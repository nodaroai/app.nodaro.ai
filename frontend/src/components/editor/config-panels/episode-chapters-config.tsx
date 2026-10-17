"use client"

import { EPISODE_CHAPTERS_DEFAULTS } from "@nodaro/render-rules"
import { useT } from "@/lib/i18n"
import type { EpisodeChaptersData } from "@/types/nodes"
import type { ConfigProps } from "./types"
import { RunUpToHereNotice } from "./run-up-to-here-notice"
import { UseCasePlanFields } from "./use-case-plan-fields"

/**
 * Chapters' settings: the plan step's tier, instructions and style guide —
 * what the run sends its route (the descriptor's `settingKeys`). No setting
 * depends on a provider or on the recording, so nothing needs snapping
 * (CLAUDE.md Provider Enum Sync 12b does not apply).
 */
export function EpisodeChaptersConfig({ data, onUpdate, nodeId, nodes, edges }: ConfigProps<EpisodeChaptersData> & { readonly nodeId?: string }) {
  const t = useT()
  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">{t("proccfg.chaptersHint")}</p>
      <UseCasePlanFields
        data={data}
        onUpdate={onUpdate}
        defaultTier={EPISODE_CHAPTERS_DEFAULTS.planTier}
        tierLabelKey="proccfg.chaptersPlanTier"
        idPrefix="chapters"
      />
      {nodeId && <RunUpToHereNotice nodeId={nodeId} nodes={nodes} edges={edges ?? []} />}
    </div>
  )
}
