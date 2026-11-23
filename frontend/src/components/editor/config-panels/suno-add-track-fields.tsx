/**
 * The direction Suno Add Vocals and Suno Add Instrumental share (decided
 * 2026-11-23): the song as a link to its file when nothing is wired, the style
 * (empty reuses the original Suno song's), the title, the styles to avoid, the
 * voice and the three 0–1 weights — each weight unset until moved, so Suno
 * decides. Add Vocals adds the lyrics or the direction for the voice.
 *
 * Limits are the route's: `SUNO_ADD_TRACK_*` and `SUNO_TITLE_MAX`.
 */
import { Input } from "@/components/ui/input"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useT } from "@/lib/i18n"
import { surfaceVoiceGenderAllowed } from "@/lib/surface-selectors"
import { SUNO_SLIDER_META, SUNO_SLIDER_LABEL_KEYS, SUNO_SLIDER_DESC_KEYS, type SunoSliderMeta } from "@/lib/suno-sliders"
import { SUNO_LYRICS_SUGGESTION_ITEMS, SUNO_STYLE_SUGGESTION_ITEMS } from "@/lib/suno-tags"
import {
  DEFAULT_SUNO_MODEL,
  SUNO_ADD_TRACK_NEGATIVE_MAX,
  SUNO_ADD_TRACK_PROMPT_MAX,
  SUNO_ADD_TRACK_STYLE_MAX,
  SUNO_TITLE_MAX,
} from "@nodaro/shared/models"
import type { NodeRefItem } from "@/lib/node-refs"
import type { SunoAddVocalsData } from "@/types/nodes"
import { TagTextarea } from "./tag-textarea"
import { PromptLengthCounter } from "./prompt-length-counter"
import type { VariableDisplayMode } from "./types"

type AddTrackData = Pick<
  SunoAddVocalsData,
  "model" | "prompt" | "uploadUrl" | "style" | "title" | "negativeTags" | "vocalGender" | "styleWeight" | "weirdnessConstraint" | "audioWeight"
>

interface SunoAddTrackFieldsProps {
  readonly data: AddTrackData
  readonly onUpdate: (d: Record<string, unknown>) => void
  /** Add Vocals: also the lyrics or the direction for the voice. */
  readonly withPrompt: boolean
  readonly nodeRefs?: ReadonlyArray<NodeRefItem>
  readonly refMap?: Map<string, string>
  readonly variableDisplayMode?: VariableDisplayMode
}

const labelClass = "text-xs font-medium text-muted-foreground"
const hintClass = "text-[11px] leading-tight text-muted-foreground"

export function SunoAddTrackFields({ data, onUpdate, withPrompt, nodeRefs, refMap, variableDisplayMode }: SunoAddTrackFieldsProps) {
  const t = useT()
  const refProps = { nodeRefs, refMap, displayMode: variableDisplayMode }
  return (
    <>
      {withPrompt && (
        <div className="flex flex-col gap-1.5">
          <label className={labelClass}>{t("audiocfg.addVocalsPromptOptional")}</label>
          <TagTextarea
            rows={4}
            value={data.prompt ?? ""}
            onChange={(v) => { if (v.length <= SUNO_ADD_TRACK_PROMPT_MAX) onUpdate({ prompt: v }) }}
            placeholder={t("audiocfg.phAddVocalsPrompt")}
            maxLength={SUNO_ADD_TRACK_PROMPT_MAX}
            tagMode="suno"
            customTags={SUNO_LYRICS_SUGGESTION_ITEMS}
            {...refProps}
          />
          <PromptLengthCounter value={data.prompt ?? ""} max={SUNO_ADD_TRACK_PROMPT_MAX} modelLabel={data.model ?? DEFAULT_SUNO_MODEL} noun={t("audiocfg.promptLyrics")} />
        </div>
      )}
      <div className="flex flex-col gap-1.5">
        <label className={labelClass}>{t("audiocfg.songFileLinkOptional")}</label>
        <Input dir="ltr" value={data.uploadUrl ?? ""} onChange={(e) => onUpdate({ uploadUrl: e.target.value })} placeholder={t("audiocfg.phSongFileLink")} />
      </div>
      <div className="flex flex-col gap-1.5">
        <label className={labelClass}>{t("audiocfg.styleOptional")}</label>
        <TagTextarea
          rows={2}
          value={data.style ?? ""}
          onChange={(v) => { if (v.length <= SUNO_ADD_TRACK_STYLE_MAX) onUpdate({ style: v }) }}
          placeholder={t("audiocfg.phAddTrackStyle")}
          maxLength={SUNO_ADD_TRACK_STYLE_MAX}
          tagMode="suno"
          customTags={SUNO_STYLE_SUGGESTION_ITEMS}
        />
        <p className={hintClass}>{t("audiocfg.hintAddTrackStyle")}</p>
      </div>
      <div className="flex flex-col gap-1.5">
        <label className={labelClass}>{t("audiocfg.titleOptional")}</label>
        <Input value={data.title ?? ""} maxLength={SUNO_TITLE_MAX} onChange={(e) => onUpdate({ title: e.target.value })} placeholder={t("audiocfg.phAddTrackTitle")} />
      </div>
      <div className="flex flex-col gap-1.5">
        <label className={labelClass}>{t("audiocfg.stylesToAvoidOptional")}</label>
        <Input value={data.negativeTags ?? ""} maxLength={SUNO_ADD_TRACK_NEGATIVE_MAX} onChange={(e) => onUpdate({ negativeTags: e.target.value })} placeholder={t("audiocfg.phAddTrackAvoid")} />
      </div>
      <div className="flex flex-col gap-1.5">
        <label className={labelClass}>{t("audiocfg.voiceOptional")}</label>
        <Select value={data.vocalGender ?? "auto"} onValueChange={(v) => onUpdate({ vocalGender: v === "male" || v === "female" ? v : undefined })}>
          <SelectTrigger aria-label={t("audiocfg.voiceOptional")}><SelectValue placeholder={t("audiocfg.phAuto")} /></SelectTrigger>
          <SelectContent>
            <SelectItem value="auto">{t("audiocfg.phAuto")}</SelectItem>
            {surfaceVoiceGenderAllowed("male") && <SelectItem value="male">{t("audiocfg.male")}</SelectItem>}
            {surfaceVoiceGenderAllowed("female") && <SelectItem value="female">{t("audiocfg.female")}</SelectItem>}
          </SelectContent>
        </Select>
      </div>
      <p className={hintClass}>{t("audiocfg.addTrackWeightsHint")}</p>
      {SUNO_SLIDER_META.map((s) => (
        <AddTrackWeight key={s.key} meta={s} value={data[s.key]} onChange={(v) => onUpdate({ [s.key]: v })} />
      ))}
    </>
  )
}

/** One 0–1 weight: Auto (unset) until moved, and back to Auto on request. */
function AddTrackWeight({ meta, value, onChange }: {
  readonly meta: SunoSliderMeta
  readonly value: number | undefined
  readonly onChange: (v: number | undefined) => void
}) {
  const t = useT()
  const isSet = typeof value === "number" && Number.isFinite(value)
  // The audio weight here is how closely the new part follows the song, not a persona's pull.
  const desc = meta.key === "audioWeight" ? t("audiocfg.sliderAudioWeightAddTrackDesc") : t(SUNO_SLIDER_DESC_KEYS[meta.key])
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between">
        <label className={labelClass}>{t(SUNO_SLIDER_LABEL_KEYS[meta.key])}</label>
        <span className="flex items-center gap-2 text-xs text-muted-foreground">
          {isSet ? value : t("audiocfg.phAuto")}
          {isSet && (
            <button type="button" className="underline hover:text-foreground" onClick={() => onChange(undefined)}>
              {t("audiocfg.weightResetAuto")}
            </button>
          )}
        </span>
      </div>
      <input
        type="range" min={meta.min} max={meta.max} step={meta.step}
        value={isSet ? value : meta.default}
        aria-label={t(SUNO_SLIDER_LABEL_KEYS[meta.key])}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className={`w-full accent-[#ff0073] ${isSet ? "" : "opacity-50"}`}
      />
      <p className={hintClass}>{desc}</p>
    </div>
  )
}
