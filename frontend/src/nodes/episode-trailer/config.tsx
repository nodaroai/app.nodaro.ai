import { EPISODE_TRAILER_DEFAULTS, TRAILER_FORMATS, usecaseRecordingsProblem, type TrailerFormat } from "@nodaro/render-rules"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { useT, type MessageKey } from "@/lib/i18n"
import type { ConfigProps } from "@/components/editor/config-panels/types"
import { RunUpToHereNotice } from "@/components/editor/config-panels/run-up-to-here-notice"
import { UseCasePlanFields } from "@/components/editor/config-panels/use-case-plan-fields"
import { UseCaseCamerasFields } from "@/components/editor/config-panels/use-case-cameras-fields"
import { useUseCaseMulticamViewer } from "@/lib/use-case-multicam-viewer"
import { USE_CASE_RECORDINGS_REASON_KEYS } from "@/lib/use-case-recordings-copy"
import { usecaseWiredRecordings } from "@/lib/use-case-wired-recordings"
import type { UnitConfigKit } from "../exec-kit"
import type { EpisodeTrailerData } from "./types"

const FORMAT_LABEL_KEYS: Readonly<Record<TrailerFormat, MessageKey>> = {
  "9:16": "node.trailerFormat9x16",
  "1:1": "node.trailerFormat1x1",
  "4:5": "node.trailerFormat4x5",
  "16:9": "node.trailerFormat16x9",
}

/**
 * Trailer's settings: the formats it delivers (at least one — the route
 * refuses an empty list, so the last one cannot be unticked), whether it
 * stops for a review before it renders, and the plan step's tier,
 * instructions and style guide. No setting depends on a provider, so nothing
 * needs snapping (CLAUDE.md Provider Enum Sync 12b does not apply).
 *
 * Two or more recordings or a Master audio show the Cameras section
 * (`UseCaseCamerasFields`) and badge what the run would refuse
 * (`usecaseRecordingsProblem`) — only to a viewer who may use Speaker Map;
 * any other viewer is told their run reads the first recording only, and
 * nothing shows until their availability has landed. There is no audio lock:
 * every format is a video, and a run with no picture is refused.
 */
export function ConfigPanel({ data: raw, onUpdate, nodeId, nodes, edges, sources = [] }: ConfigProps<never> & { readonly kit: UnitConfigKit; readonly nodeId: string }) {
  const data = raw as unknown as EpisodeTrailerData
  const t = useT()
  const viewer = useUseCaseMulticamViewer()
  // The recordings the type reads (in the node's order), and a Master audio that is not one of them.
  const wired = usecaseWiredRecordings({ id: nodeId, type: "episode-trailer", data }, nodes, edges ?? [])
  const masterId = wired.masterId
  const recordings = wired.recordings.map((r) => {
    const source = sources.find((s) => s.id === r.nodeId && s.targetHandle === "media")
    return { ...r, label: source?.label ?? r.nodeId, source }
  })
  const multicam = recordings.length >= 2 || !!masterId
  const problem = viewer === "offered" && multicam ? usecaseRecordingsProblem({ kinds: recordings.map((r) => r.kind), masterAudio: !!masterId, cameras: data.cameras }) : null
  const problemKey = problem ? USE_CASE_RECORDINGS_REASON_KEYS[problem.code] : undefined
  const chosen = data.formats && data.formats.length > 0 ? data.formats : EPISODE_TRAILER_DEFAULTS.formats
  // Kept in the formats' own order, whatever order they were ticked in.
  const toggle = (format: TrailerFormat, on: boolean) => {
    const next = TRAILER_FORMATS.filter((f) => (f === format ? on : chosen.includes(f)))
    if (next.length > 0) onUpdate({ formats: next })
  }

  return (
    <div className="space-y-4">
      {multicam && viewer === "withheld" && <p className="text-xs text-muted-foreground">{t("proccfg.usecaseNeedsSpeakerMap")}</p>}
      {multicam && viewer === "offered" && (
        <>
          <UseCaseCamerasFields
            data={data}
            onUpdate={onUpdate}
            recordings={recordings}
            hasMaster={!!masterId}
            masterLabel={sources.find((s) => s.id === masterId && s.targetHandle === "masterAudio")?.label}
            report={data.useCaseCameras}
          />
          {problem && <p className="text-xs text-red-500">{problemKey ? t(problemKey) : problem.message}</p>}
        </>
      )}

      <fieldset className="space-y-1.5">
        <legend className="text-sm font-medium">{t("node.trailerFormats")}</legend>
        {TRAILER_FORMATS.map((format) => {
          const on = chosen.includes(format)
          const id = `trailer-format-${format.replace(":", "x")}`
          return (
            <div key={format} className="flex items-center gap-2">
              <Checkbox
                id={id}
                checked={on}
                // The last format left cannot be unticked.
                disabled={on && chosen.length === 1}
                onCheckedChange={(v) => toggle(format, v === true)}
              />
              <Label htmlFor={id} className="font-normal">{t(FORMAT_LABEL_KEYS[format])}</Label>
            </div>
          )
        })}
        <p className="text-xs text-muted-foreground">{t("proccfg.trailerFormatsHint")}</p>
      </fieldset>

      <p className="text-xs text-muted-foreground">{t("proccfg.trailerIntroHint")}</p>

      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <Label htmlFor="trailer-review">{t("proccfg.trailerReview")}</Label>
          <Switch id="trailer-review" aria-label={t("proccfg.trailerReview")} checked={data.reviewBeforeRender === true} onCheckedChange={(v) => onUpdate({ reviewBeforeRender: v })} />
        </div>
        <p className="text-xs text-muted-foreground">{t("proccfg.trailerReviewHint")}</p>
      </div>

      <UseCasePlanFields
        data={data}
        onUpdate={onUpdate}
        defaultTier={EPISODE_TRAILER_DEFAULTS.planTier}
        tierLabelKey="proccfg.trailerPlanTier"
        idPrefix="trailer"
      />
      {nodeId && <RunUpToHereNotice nodeId={nodeId} nodes={nodes} edges={edges ?? []} />}
    </div>
  )
}
