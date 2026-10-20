import { EDL_TARGET_ASPECTS, type EdlTargetAspect } from "@nodaro/shared/edl"
import {
  resolveSpeakerLayoutSettings,
  tightenFramingLayouts,
  usecaseDescriptor,
  usecaseRecordingsProblem,
  validSpeakerCrossfade,
  validSpeakerEmphasis,
  validSpeakerSwitches,
  type SpeakerViewNodeSettings,
  type UseCaseSettings,
} from "@nodaro/render-rules"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { SPEAKER_LAYOUT_LABEL_KEYS } from "@/components/nodes/speaker-view-label-keys"
import { useT } from "@/lib/i18n"
import type { ConfigProps } from "@/components/editor/config-panels/types"
import { RunUpToHereNotice } from "@/components/editor/config-panels/run-up-to-here-notice"
import { SpeakerViewEmphasisSection, SpeakerViewSwitchSection } from "@/components/editor/config-panels/speaker-view-sections"
import { UseCaseCamerasFields } from "@/components/editor/config-panels/use-case-cameras-fields"
import { UseCaseFramingSourceField } from "@/components/editor/config-panels/use-case-framing-source-field"
import { useUseCaseMulticamViewer } from "@/lib/use-case-multicam-viewer"
import { USE_CASE_RECORDINGS_REASON_KEYS } from "@/lib/use-case-recordings-copy"
import { usecaseWiredRecordings } from "@/lib/use-case-wired-recordings"
import type { UnitConfigKit } from "../exec-kit"
import type { SpeakerLayoutData } from "./types"

const TYPE = "speaker-layout"

/** The settings as a run reads them (@nodaro/render-rules — what both engines and the estimate read). */
const resolved = (data: SpeakerLayoutData) => resolveSpeakerLayoutSettings(data as unknown as UseCaseSettings, "video")

/**
 * Speaker Layout's settings. Every value is shown as the run reads it — the
 * settings resolver every run reads, on both engines — and never written back
 * from here (the resolver is the invariant: a node written as workflow JSON or
 * by an agent is read the same way with no panel open):
 *  - the shape, and the layouts Speaker View draws at it; a stored layout the
 *    shape does not draw shows as the run snaps it, and a new shape writes the
 *    layout the run would read at it;
 *  - the switch and emphasis through Speaker View's own sections, fed the same
 *    rules the primitive offers (`validSpeakerSwitches`,
 *    `validSpeakerCrossfade`, `validSpeakerEmphasis`), so the two panels never
 *    drift: a choice the layout rules out is greyed with its reason. A layout's
 *    run sets no tween length, so neither slider is offered;
 *  - where the boxes come from (`UseCaseFramingSourceField`): a node with none
 *    shows what an absent one reads as for this type, its spec's
 *    `absentFramingSource` (automatic);
 *  - review: a 720p Preview first, then Render final.
 * Two or more recordings or a Master audio show the Cameras section
 * (`UseCaseCamerasFields`) and badge what the run would refuse
 * (`usecaseRecordingsProblem`) — only to a viewer who may use Speaker Map;
 * any other viewer is told their run reads the first recording only.
 */
export function ConfigPanel({ data: raw, onUpdate, nodeId, nodes, edges, sources = [] }: ConfigProps<never> & { readonly kit: UnitConfigKit; readonly nodeId: string }) {
  const data = raw as unknown as SpeakerLayoutData
  const t = useT()
  const viewer = useUseCaseMulticamViewer()
  // The recordings the type reads (in the node's order), and a Master audio that is not one of them.
  const wired = usecaseWiredRecordings({ id: nodeId, type: TYPE, data }, nodes, edges ?? [])
  const masterId = wired.masterId
  const recordings = wired.recordings.map((r) => {
    const source = sources.find((s) => s.id === r.nodeId && s.targetHandle === "media")
    return { ...r, label: source?.label ?? r.nodeId, source }
  })
  const multicam = recordings.length >= 2 || !!masterId
  const problem = viewer === "offered" && multicam ? usecaseRecordingsProblem({ kinds: recordings.map((r) => r.kind), masterAudio: !!masterId, cameras: data.cameras }) : null
  const problemKey = problem ? USE_CASE_RECORDINGS_REASON_KEYS[problem.code] : undefined

  const settings = resolved(data)
  // Speaker View's own reading of this layout (no edit to judge by before the run).
  const sv: SpeakerViewNodeSettings = { targetAspect: settings.targetAspect, layout: settings.layout, switchType: settings.switchType, emphasisStyle: settings.emphasisStyle }
  // A new shape: the layout the run would read at it (the stored one where the shape draws it).
  const pickAspect = (v: string) => onUpdate({ targetAspect: v, layout: resolved({ ...data, targetAspect: v as EdlTargetAspect }).layout })

  return (
    <div className="space-y-4">
      <p className="text-xs text-muted-foreground">{t("proccfg.speakerLayoutHint")}</p>
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

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label>{t("proccfg.speakerLayoutAspect")}</Label>
          <Select value={settings.targetAspect} onValueChange={pickAspect}>
            <SelectTrigger aria-label={t("proccfg.speakerLayoutAspect")}><SelectValue /></SelectTrigger>
            <SelectContent>
              {EDL_TARGET_ASPECTS.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label>{t("proccfg.speakerLayoutLayout")}</Label>
          <Select value={settings.layout} onValueChange={(layout) => onUpdate({ layout })}>
            <SelectTrigger aria-label={t("proccfg.speakerLayoutLayout")}><SelectValue /></SelectTrigger>
            <SelectContent>
              {tightenFramingLayouts(settings.targetAspect).map((l) => (
                <SelectItem key={l} value={l}>{t(SPEAKER_LAYOUT_LABEL_KEYS[l]!)}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>

      <SpeakerViewSwitchSection
        options={validSpeakerSwitches(sv, undefined)}
        crossfade={validSpeakerCrossfade(sv, undefined)}
        value={settings.switchType}
        durationMs={undefined}
        counts={null}
        showDuration={false}
        onUpdate={onUpdate}
      />
      <SpeakerViewEmphasisSection options={validSpeakerEmphasis(sv)} value={settings.emphasisStyle} durationMs={undefined} showDuration={false} onUpdate={onUpdate} />

      <UseCaseFramingSourceField value={data.framingSource} onChange={(framingSource) => onUpdate({ framingSource })} absent={usecaseDescriptor(TYPE).absentFramingSource} />

      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <Label htmlFor="speaker-layout-review">{t("proccfg.speakerLayoutReview")}</Label>
          <Switch id="speaker-layout-review" aria-label={t("proccfg.speakerLayoutReview")} checked={data.reviewBeforeRender === true} onCheckedChange={(v) => onUpdate({ reviewBeforeRender: v })} />
        </div>
        <p className="text-xs text-muted-foreground">{t("proccfg.speakerLayoutReviewHint")}</p>
      </div>

      {nodeId && <RunUpToHereNotice nodeId={nodeId} nodes={nodes} edges={edges ?? []} />}
    </div>
  )
}
