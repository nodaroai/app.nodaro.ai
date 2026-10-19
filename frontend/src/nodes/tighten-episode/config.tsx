import { useEffect } from "react"
import { ALL_CAPTION_STYLES, type CaptionStyle } from "@nodaro/shared/captions"
import { EDL_TARGET_ASPECTS } from "@nodaro/shared/edl"
import {
  TIGHTEN_EPISODE_DEFAULTS,
  drawnTightenFraming,
  resolveTightenEpisodeSettings,
  tightenFramingLayouts,
  usecaseDescriptor,
  usecaseMediaKindOf,
  type TightenFramingAspect,
  type TightenFramingLayout,
} from "@nodaro/render-rules"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import { Slider } from "@/components/ui/slider"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { SPEAKER_LAYOUT_LABEL_KEYS } from "@/components/nodes/speaker-view-label-keys"
import { useT } from "@/lib/i18n"
import type { ConfigProps } from "@/components/editor/config-panels/types"
import { RunUpToHereNotice } from "@/components/editor/config-panels/run-up-to-here-notice"
import { CAPTION_STYLE_LABEL_KEYS } from "@/components/editor/config-panels/caption-style-labels"
import { UseCasePlanFields } from "@/components/editor/config-panels/use-case-plan-fields"
import type { UnitConfigKit } from "../exec-kit"
import type { TightenEpisodeData } from "./types"

const NO_FRAMING = "none"
const D = TIGHTEN_EPISODE_DEFAULTS

/**
 * Tighten Episode's settings. What the run would read differently from the
 * stored value is snapped here, by the run's own rules (@nodaro/render-rules),
 * so the panel never shows a setting the run quietly overrides:
 *  - the recording wired into `media` is read by the estimate's rule
 *    (`usecaseMediaKindOf`, from the wire) — an audio one makes an audio
 *    episode, with no captions and no framing (the person's Output and
 *    Captions are remembered, and come back when a video is wired again —
 *    lib/use-case-audio-lock.ts). The run itself decides by probing the file;
 *  - framing offers only the layouts Speaker View draws at the chosen shape,
 *    and a stored layout it does not draw is snapped as the run snaps it;
 *  - a stored framing the run would not read at all (a shape it has no
 *    renderer for) is cleared, as the run's resolver clears it.
 */
export function ConfigPanel({ data: raw, onUpdate, nodeId, nodes, edges }: ConfigProps<never> & { readonly kit: UnitConfigKit; readonly nodeId: string }) {
  const data = raw as unknown as TightenEpisodeData
  const t = useT()
  const wireInto = (handle: string) => (edges ?? []).find((e) => e.target === nodeId && e.targetHandle === handle && !!e.source)
  const mediaWire = wireInto("media")
  const audioSource = !!mediaWire && usecaseMediaKindOf(nodes.find((n) => n.id === mediaWire.source), mediaWire.sourceHandle) === "audio"
  const hasMusic = Boolean(wireInto("music"))
  const output = audioSource ? "audio" : data.output ?? D.output
  const captions = output === "video" && (data.captions ?? D.captions)
  const framing = data.framing ?? null

  // Fail-safes (CLAUDE.md Provider Enum Sync 12b): each writes only when the
  // stored value differs from what the run would read, so opening a settled
  // node writes nothing.
  useEffect(() => {
    // An audio recording forces its spec's values (`audioForced`). A stored
    // audio output with no captions set already reads as no captions, so it
    // is left as stored.
    if (audioSource && (data.output !== "audio" || data.captions === true)) onUpdate({ ...usecaseDescriptor("tighten-episode").audioForced })
  }, [audioSource])

  useEffect(() => {
    if (!framing || output !== "video") return
    // Not a framing the run reads (its resolver gives none): cleared, never shown.
    if (resolveTightenEpisodeSettings({ ...data, output }, "video").framing === null) {
      onUpdate({ framing: null })
      return
    }
    const drawn = drawnTightenFraming(framing.aspect, framing.layout)
    if (drawn.layout !== framing.layout) onUpdate({ framing: drawn })
  }, [framing?.aspect, framing?.layout, output])

  const pickAspect = (v: string) =>
    onUpdate({ framing: v === NO_FRAMING ? null : drawnTightenFraming(v as TightenFramingAspect, framing?.layout ?? "auto") })

  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label>{t("proccfg.tightenOutput")}</Label>
        <Select
          value={output}
          disabled={audioSource}
          onValueChange={(v) => onUpdate(v === "audio" ? { output: "audio", captions: false } : { output: "video" })}
        >
          <SelectTrigger aria-label={t("proccfg.tightenOutput")}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="video">{t("proccfg.tightenOutputVideo")}</SelectItem>
            <SelectItem value="audio">{t("proccfg.tightenOutputAudio")}</SelectItem>
          </SelectContent>
        </Select>
        {audioSource && <p className="text-xs text-muted-foreground">{t("proccfg.tightenAudioForced")}</p>}
      </div>

      {output === "video" && (
        <div className="space-y-1.5">
          <Label>{t("proccfg.tightenFraming")}</Label>
          <Select value={framing ? framing.aspect : NO_FRAMING} onValueChange={pickAspect}>
            <SelectTrigger aria-label={t("proccfg.tightenFraming")}><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_FRAMING}>{t("proccfg.tightenFramingNone")}</SelectItem>
              {EDL_TARGET_ASPECTS.map((a) => <SelectItem key={a} value={a}>{a}</SelectItem>)}
            </SelectContent>
          </Select>
          {framing && (
            <Select value={framing.layout} onValueChange={(v) => onUpdate({ framing: { aspect: framing.aspect, layout: v as TightenFramingLayout } })}>
              <SelectTrigger aria-label={t("proccfg.tightenFramingLayout")}><SelectValue /></SelectTrigger>
              <SelectContent>
                {tightenFramingLayouts(framing.aspect).map((l) => (
                  <SelectItem key={l} value={l}>{t(SPEAKER_LAYOUT_LABEL_KEYS[l]!)}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
          <p className="text-xs text-muted-foreground">{t("proccfg.tightenFramingHint")}</p>
        </div>
      )}

      {output === "video" && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label htmlFor="tighten-captions">{t("proccfg.tightenCaptions")}</Label>
            <Switch id="tighten-captions" aria-label={t("proccfg.tightenCaptions")} checked={captions} onCheckedChange={(v) => onUpdate({ captions: v })} />
          </div>
          {captions && (
            <Select value={data.captionStyle ?? D.captionStyle} onValueChange={(v) => onUpdate({ captionStyle: v as CaptionStyle })}>
              <SelectTrigger aria-label={t("proccfg.tightenCaptionStyle")}><SelectValue /></SelectTrigger>
              <SelectContent>
                {ALL_CAPTION_STYLES.map((style) => (
                  <SelectItem key={style} value={style}>{t(CAPTION_STYLE_LABEL_KEYS[style])}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        </div>
      )}

      <div className="space-y-1">
        <div className="flex items-center justify-between">
          <Label htmlFor="tighten-review">{t("proccfg.tightenReview")}</Label>
          <Switch id="tighten-review" aria-label={t("proccfg.tightenReview")} checked={data.reviewBeforeRender === true} onCheckedChange={(v) => onUpdate({ reviewBeforeRender: v })} />
        </div>
        <p className="text-xs text-muted-foreground">{t("proccfg.tightenReviewHint")}</p>
      </div>

      <UseCasePlanFields data={data} onUpdate={onUpdate} defaultTier={D.planTier} tierLabelKey="proccfg.tightenPlanTier" idPrefix="tighten" />

      {hasMusic && (
        <div className="space-y-1.5">
          <div className="flex items-center justify-between">
            <Label>{t("proccfg.tightenMusicDuck")}</Label>
            <span className="text-xs text-muted-foreground ms-2 tabular-nums">{data.musicDuckAmount ?? D.musicDuckAmount}%</span>
          </div>
          <Slider
            min={0}
            max={100}
            step={5}
            value={[data.musicDuckAmount ?? D.musicDuckAmount]}
            thumbAriaLabel={t("proccfg.tightenMusicDuck")}
            onValueChange={([v]) => onUpdate({ musicDuckAmount: v })}
          />
        </div>
      )}

      {nodeId && <RunUpToHereNotice nodeId={nodeId} nodes={nodes} edges={edges ?? []} />}
    </div>
  )
}
