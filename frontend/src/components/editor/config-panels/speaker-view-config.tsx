import { useMemo } from "react"
import {
  SPEAKER_VIEW_ASPECTS,
  SPEAKER_VIEW_NOT_PRICED_MESSAGE,
  SPEAKER_VIEW_PRICED,
  normalizeSpeakerViewData,
  validSpeakerCrossfade,
  validSpeakerEmphasis,
  validSpeakerLayouts,
  validSpeakerSwitches,
  speakerViewAspectOf,
  type SpeakerViewNodeSettings,
} from "@nodaro/render-rules"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useT } from "@/lib/i18n"
import { speakerViewBatchValidity } from "@/lib/speaker-view-validity"
import { speakerViewContextOf, speakerViewEdits, speakerViewTranscript } from "@/lib/speaker-view-context"
import { speakerViewChangeCounts, speakerViewInputProblem, speakerViewInputState, speakerViewLabelMismatch } from "@/lib/speaker-view-input-state"
import type { SpeakerViewData } from "@/types/nodes"
import { AspectRatioSelector } from "./aspect-ratio-selector"
import type { ConfigProps } from "./types"
import { SpeakerViewAdvanced, SpeakerViewFramingSummary } from "./speaker-view-framing-summary"
import { SpeakerViewInputSummary } from "./speaker-view-input-summary"
import { SpeakerViewEmphasisSection, SpeakerViewLayoutSection, SpeakerViewSwitchSection } from "./speaker-view-sections"

const ASPECT_OPTIONS = SPEAKER_VIEW_ASPECTS.map((a) => ({ value: a, label: a }))

/**
 * Speaker View's settings (U2, U2b): the edit wired in, the output, and the
 * layout, switch and emphasis as tile pickers. A choice the aspect or the
 * speaker count rules out is GREYED with its reason (SV3); the same pure
 * functions feed the quick strip and the run, so the three always agree.
 */
export function SpeakerViewConfig({ data, onUpdate, nodes, edges = [], nodeId }: ConfigProps<SpeakerViewData> & { readonly nodeId?: string }) {
  const t = useT()
  const settings = data as SpeakerViewNodeSettings
  const ctx = useMemo(() => (nodeId ? speakerViewContextOf(nodeId, nodes, edges) : undefined), [nodeId, nodes, edges])
  const edits = useMemo(() => (nodeId ? speakerViewEdits(nodeId, nodes, edges) : []), [nodeId, nodes, edges])
  const transcript = useMemo(() => (nodeId ? speakerViewTranscript(nodeId, nodes, edges) : undefined), [nodeId, nodes, edges])
  const state = useMemo(() => (nodeId ? speakerViewInputState(nodeId, nodes, edges) : ({ kind: "no-edit" } as const)), [nodeId, nodes, edges])
  const verdict = useMemo(() => speakerViewBatchValidity(edits, transcript, data), [edits, transcript, data])
  const problem = useMemo(() => speakerViewInputProblem(edits, transcript, data), [edits, transcript, data])
  const mismatch = useMemo(() => speakerViewLabelMismatch(edits, transcript), [edits, transcript])
  const counts = useMemo(() => speakerViewChangeCounts(ctx), [ctx])

  const aspect = speakerViewAspectOf(settings, ctx)
  const layout = typeof data.layout === "string" ? data.layout : "auto"
  const switchType = typeof data.switchType === "string" ? data.switchType : "cut"

  return (
    <div className="flex flex-col gap-3" data-testid="speaker-view-config">
      <p className="text-[11px] text-muted-foreground">{t("speakerView.hint")}</p>
      {!SPEAKER_VIEW_PRICED && (
        <p role="status" data-testid="speaker-view-not-priced" className="rounded-md border border-amber-500/40 bg-amber-500/10 px-2 py-1 text-[11px] text-amber-700 dark:text-amber-400" title={SPEAKER_VIEW_NOT_PRICED_MESSAGE}>
          {t("speakerView.notPriced")}
        </p>
      )}

      <SpeakerViewInputSummary state={state} ctx={ctx} verdict={verdict} problem={problem} mismatch={mismatch} nodeId={nodeId} nodes={nodes} edges={edges} />

      <section className="flex flex-col gap-2">
        <Label>{t("speakerView.section.output")}</Label>
        <AspectRatioSelector options={ASPECT_OPTIONS} value={data.targetAspect ?? aspect} onValueChange={(v) => onUpdate({ targetAspect: v })} className="grid-cols-4" />
        <Select value={data.quality ?? "final"} onValueChange={(v) => onUpdate({ quality: v as "proxy" | "final" })}>
          <SelectTrigger aria-label={t("speakerView.field.quality")}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="final">{t("proccfg.applyEdlFinal")}</SelectItem>
            <SelectItem value="proxy">{t("proccfg.applyEdlProxy")}</SelectItem>
          </SelectContent>
        </Select>
      </section>

      <SpeakerViewLayoutSection options={validSpeakerLayouts(settings, ctx)} value={layout} aspect={aspect} snapped={normalizeSpeakerViewData(settings, ctx).notes} onUpdate={onUpdate} />
      <SpeakerViewSwitchSection options={validSpeakerSwitches(settings, ctx)} crossfade={validSpeakerCrossfade(settings, ctx)} value={switchType} durationMs={data.switchDurationMs} counts={counts} onUpdate={onUpdate} />
      <SpeakerViewEmphasisSection options={validSpeakerEmphasis(settings)} value={data.emphasisStyle} durationMs={data.emphasisDurationMs} onUpdate={onUpdate} />
      <SpeakerViewFramingSummary regions={(data as { speakerRegions?: unknown }).speakerRegions} nodeId={nodeId} />
      <SpeakerViewAdvanced accentColor={data.accentColor} onChange={(accentColor) => onUpdate({ accentColor })} />
    </div>
  )
}
