import { useEffect } from "react"
import { ALL_CAPTION_STYLES, type CaptionStyle } from "@nodaro/shared/captions"
import { EDIT_PLAN_MAX_CLIP_COUNT, EDL_TARGET_ASPECTS, SPEAKER_SWITCH_IDS, parseSpeakerEmphasisStyle } from "@nodaro/shared/edl"
import {
  CLIP_PACK_ABSENT_FRAMING_SOURCE,
  CLIP_PACK_DEFAULTS,
  CLIP_PACK_DEFAULT_FRAMING,
  CLIP_PACK_MAX_TARGET_SEC,
  CLIP_PACK_MIN_TARGET_SEC,
  SPEAKER_VIEW_EMPHASIS_ATOMS,
  drawnTightenFraming,
  isClipPackEmphasis,
  tightenFramingLayouts,
  type TightenFramingAspect,
  type TightenFramingLayout,
} from "@nodaro/render-rules"
import { Checkbox } from "@/components/ui/checkbox"
import { Label } from "@/components/ui/label"
import { ClampedNumberInput } from "@/components/ui/clamped-number-input"
import { Switch } from "@/components/ui/switch"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { SPEAKER_LAYOUT_LABEL_KEYS } from "@/components/nodes/speaker-view-label-keys"
import { useT } from "@/lib/i18n"
import type { ConfigProps } from "@/components/editor/config-panels/types"
import { RunUpToHereNotice } from "@/components/editor/config-panels/run-up-to-here-notice"
import { CAPTION_STYLE_LABEL_KEYS } from "@/components/editor/config-panels/caption-style-labels"
import { SPEAKER_EMPHASIS_LABEL_KEYS } from "@/components/editor/config-panels/speaker-view-reasons"
import { UseCasePlanFields } from "@/components/editor/config-panels/use-case-plan-fields"
import { useSpeakerSwitchLabel } from "@/components/editor/config-panels/speaker-switch-label"
import { UseCaseFramingSourceField } from "@/components/editor/config-panels/use-case-framing-source-field"
import { UseCaseMulticamSection, usecaseViewerSoundOnly } from "@/components/editor/config-panels/use-case-multicam-section"
import { USE_CASE_AUDIO_LOCKS, usecaseAudioLockFailSafe } from "@/lib/use-case-audio-lock"
import { useUseCaseMulticamViewer } from "@/lib/use-case-multicam-viewer"
import type { UnitConfigKit } from "../exec-kit"
import type { ClipPackData } from "./types"

const NO_FRAMING = "none"
const D = CLIP_PACK_DEFAULTS

type Framing = NonNullable<ClipPackData["framing"]>

/**
 * Clip Pack's settings. What the run would read differently from the stored
 * value is snapped here, by the run's own rules (@nodaro/render-rules), so
 * the panel never shows a setting the run quietly overrides:
 *  - the recordings the run reads (the first alone, or — for a viewer who may
 *    use Speaker Map — every one) are read by the estimate's rule (the store's
 *    audio lock, `usecaseViewerSoundOnly`) — sound only makes audio clips,
 *    with no framing and no captions (the person's own are remembered, and
 *    come back when a video is wired again — lib/use-case-audio-lock.ts). The
 *    run itself decides by probing the file;
 *  - framing offers only the layouts Speaker View draws at the chosen shape,
 *    and a stored layout it does not draw is snapped as the run snaps it
 *    (CLAUDE.md Provider Enum Sync 12b), keeping the switch and emphasis;
 *  - with a framing, its source (`UseCaseFramingSourceField`): a saved node
 *    without one shows — and runs — the even split; a new node starts on
 *    automatic (unit.json). Hidden with Framing under the audio lock, kept;
 *  - the clip count and length are clamped to what the run reads (1–50
 *    clips, 5–180 seconds) when the person leaves the field, never while
 *    they type.
 * Two or more recordings or a Master audio show the Cameras section
 * (`UseCaseMulticamSection`) — only to a viewer who may use Speaker Map; any
 * other viewer is told their run reads the first recording only.
 */
export function ConfigPanel({ data: raw, onUpdate, nodeId, nodes, edges, sources = [] }: ConfigProps<never> & { readonly kit: UnitConfigKit; readonly nodeId: string }) {
  const data = raw as unknown as ClipPackData
  const t = useT()
  const switchLabel = useSpeakerSwitchLabel()
  const viewer = useUseCaseMulticamViewer()
  // The recordings this viewer's run reads, in the node's order — the store's lock reads them so too.
  const audioSource = usecaseViewerSoundOnly(nodeId, nodes, edges ?? [], viewer)
  // No framing stored = the run's default framing; null = none.
  const framing: Framing | null = audioSource ? null : data.framing === undefined ? { ...CLIP_PACK_DEFAULT_FRAMING } : data.framing
  const captions = !audioSource && (data.captions ?? D.captions)
  const switchType = framing?.switchType && (SPEAKER_SWITCH_IDS as readonly string[]).includes(framing.switchType) ? framing.switchType : CLIP_PACK_DEFAULT_FRAMING.switchType
  const emphasis = framing?.emphasisStyle && isClipPackEmphasis(framing.emphasisStyle) ? framing.emphasisStyle : CLIP_PACK_DEFAULT_FRAMING.emphasisStyle
  const emphasisAtoms = parseSpeakerEmphasisStyle(emphasis).filter((a) => a !== "none")

  // Fail-safes: each writes only when the stored value differs from what the
  // run would read, so opening a settled node writes nothing.
  useEffect(() => {
    // The store keeps the lock on every wire change (and gives the person's settings
    // back); this only snaps a graph that arrived already wired.
    const patch = usecaseAudioLockFailSafe(audioSource ? "audio" : undefined, data, USE_CASE_AUDIO_LOCKS["clip-pack"]!)
    if (patch) onUpdate(patch)
  }, [audioSource])

  useEffect(() => {
    if (!framing || audioSource) return
    const drawn = drawnTightenFraming(framing.aspect, framing.layout)
    if (drawn.layout !== framing.layout) onUpdate({ framing: { ...framing, layout: drawn.layout } })
  }, [framing?.aspect, framing?.layout, audioSource])

  const pickAspect = (v: string) => {
    if (v === NO_FRAMING) return onUpdate({ framing: null })
    const aspect = v as TightenFramingAspect
    const base = framing ?? CLIP_PACK_DEFAULT_FRAMING
    onUpdate({ framing: { ...base, aspect, layout: drawnTightenFraming(aspect, base.layout).layout } })
  }
  const setFraming = (patch: Partial<Framing>) => {
    if (framing) onUpdate({ framing: { ...framing, ...patch } })
  }
  // Kept in the atoms' own order, whatever order they were toggled in; all off is "none".
  const toggleEmphasis = (atom: string, on: boolean) => {
    const next = SPEAKER_VIEW_EMPHASIS_ATOMS.filter((a) => (a === atom ? on : emphasisAtoms.includes(a)))
    setFraming({ emphasisStyle: next.length > 0 ? next.join("+") : "none" })
  }

  return (
    <div className="space-y-4">
      <UseCaseMulticamSection type="clip-pack" data={data} onUpdate={onUpdate} nodeId={nodeId} nodes={nodes} edges={edges ?? []} sources={sources} viewer={viewer} />

      <p className="text-xs text-muted-foreground">{t("proccfg.clipPackHint")}</p>

      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="clip-pack-count">{t("proccfg.clipPackCount")}</Label>
          <ClampedNumberInput
            id="clip-pack-count"
            min={1}
            max={EDIT_PLAN_MAX_CLIP_COUNT}
            allowEmpty
            value={data.count}
            placeholder={String(D.count)}
            onCommit={(count) => onUpdate({ count })}
          />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="clip-pack-length">{t("proccfg.clipPackLength")}</Label>
          <ClampedNumberInput
            id="clip-pack-length"
            min={CLIP_PACK_MIN_TARGET_SEC}
            max={CLIP_PACK_MAX_TARGET_SEC}
            allowEmpty
            value={data.targetDurationSec}
            placeholder={String(D.targetDurationSec)}
            onCommit={(targetDurationSec) => onUpdate({ targetDurationSec })}
          />
        </div>
      </div>

      <div className="space-y-1.5">
        <Label>{t("proccfg.clipPackFraming")}</Label>
        <Select value={framing ? framing.aspect : NO_FRAMING} disabled={audioSource} onValueChange={pickAspect}>
          <SelectTrigger aria-label={t("proccfg.clipPackFraming")}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value={NO_FRAMING}>{t("proccfg.clipPackFramingNone")}</SelectItem>
            {EDL_TARGET_ASPECTS.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}
          </SelectContent>
        </Select>
        {framing && (
          <>
            <Select value={framing.layout} onValueChange={(v) => setFraming({ layout: v as TightenFramingLayout })}>
              <SelectTrigger aria-label={t("proccfg.clipPackFramingLayout")}><SelectValue /></SelectTrigger>
              <SelectContent>
                {tightenFramingLayouts(framing.aspect).map((l) => (
                  <SelectItem key={l} value={l}>{t(SPEAKER_LAYOUT_LABEL_KEYS[l]!)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <div className="space-y-1">
              <Label>{t("proccfg.clipPackSwitch")}</Label>
              <Select value={switchType} onValueChange={(v) => setFraming({ switchType: v })}>
                <SelectTrigger aria-label={t("proccfg.clipPackSwitch")}><SelectValue /></SelectTrigger>
                <SelectContent>
                  {SPEAKER_SWITCH_IDS.map((id) => <SelectItem key={id} value={id}>{switchLabel(id)}</SelectItem>)}
                </SelectContent>
              </Select>
            </div>
            <fieldset className="space-y-1">
              <legend className="text-sm font-medium">{t("proccfg.clipPackEmphasis")}</legend>
              <div className="flex flex-wrap gap-3">
                {SPEAKER_VIEW_EMPHASIS_ATOMS.map((atom) => {
                  const id = `clip-pack-emphasis-${atom}`
                  return (
                    <div key={atom} className="flex items-center gap-1.5">
                      <Checkbox id={id} checked={emphasisAtoms.includes(atom)} onCheckedChange={(v) => toggleEmphasis(atom, v === true)} />
                      <Label htmlFor={id} className="font-normal">{t(SPEAKER_EMPHASIS_LABEL_KEYS[atom]!)}</Label>
                    </div>
                  )
                })}
              </div>
            </fieldset>
          </>
        )}
        {audioSource && <p className="text-xs text-muted-foreground">{t("proccfg.clipPackAudioForced")}</p>}
      </div>

      {/* Only with a framing chosen; hidden with Framing under the audio lock — never cleared. */}
      {framing && (
        <UseCaseFramingSourceField value={data.framingSource} onChange={(framingSource) => onUpdate({ framingSource })} absent={CLIP_PACK_ABSENT_FRAMING_SOURCE} />
      )}

      <div className="space-y-1.5">
        <div className="flex items-center justify-between">
          <Label htmlFor="clip-pack-captions">{t("proccfg.clipPackCaptions")}</Label>
          <Switch id="clip-pack-captions" aria-label={t("proccfg.clipPackCaptions")} checked={captions} disabled={audioSource} onCheckedChange={(v) => onUpdate({ captions: v })} />
        </div>
        {captions && (
          <Select value={data.captionStyle ?? D.captionStyle} onValueChange={(v) => onUpdate({ captionStyle: v as CaptionStyle })}>
            <SelectTrigger aria-label={t("proccfg.clipPackCaptionStyle")}><SelectValue /></SelectTrigger>
            <SelectContent>
              {ALL_CAPTION_STYLES.map((style) => (
                <SelectItem key={style} value={style}>{t(CAPTION_STYLE_LABEL_KEYS[style])}</SelectItem>
              ))}
            </SelectContent>
          </Select>
        )}
      </div>

      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <Label htmlFor="clip-pack-review">{t("proccfg.clipPackReview")}</Label>
          <Switch id="clip-pack-review" aria-label={t("proccfg.clipPackReview")} checked={data.reviewBeforeRender === true} onCheckedChange={(v) => onUpdate({ reviewBeforeRender: v })} />
        </div>
        <p className="text-xs text-muted-foreground">{t("proccfg.clipPackReviewHint")}</p>
      </div>

      <UseCasePlanFields data={data} onUpdate={onUpdate} defaultTier={D.planTier} tierLabelKey="proccfg.clipPackPlanTier" idPrefix="clip-pack" />

      {nodeId && <RunUpToHereNotice nodeId={nodeId} nodes={nodes} edges={edges ?? []} />}
    </div>
  )
}
