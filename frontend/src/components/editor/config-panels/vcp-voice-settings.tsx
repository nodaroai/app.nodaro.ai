import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Switch } from "@/components/ui/switch"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useT } from "@/lib/i18n"
import type { VoiceChangerProData } from "@/types/nodes"

type VcpVoice = NonNullable<VoiceChangerProData["orderedVoices"][number]>
type VcpEngine = NonNullable<VcpVoice["engine"]>

interface VcpVoiceSettingsProps {
  /** Position of this voice in `orderedVoices` (speaker index). */
  readonly index: number
  readonly voice: VcpVoice
  /** Immutably patch this voice's per-voice settings. */
  readonly updateVoice: (index: number, patch: Partial<VcpVoice>) => void
}

/**
 * The v3 Re-speak lane takes exactly 0 / 0.5 / 1 for stability; any other
 * value (a continuous slider position from Recast or v4) snaps to 0.5 at the
 * moment the user picks v3 — from the click, never from a render effect, so a
 * node that is only selected is never rewritten.
 */
const snapV3 = (stability: number | undefined): number =>
  stability === 0 || stability === 0.5 || stability === 1 ? stability : 0.5

/**
 * The per-voice engine radio and the levers each engine honours, for one
 * Voice Changer Pro speaker:
 *
 *  - Recast (`"sts"`, the default) — stability, similarity, style, speaker boost.
 *  - Re-speak (v3) — stability at 0 / 0.5 / 1 only; the other levers are
 *    ignored by the lane, so they are not rendered.
 *  - Re-speak (v4) — any stability 0–1 and similarity; style and speaker
 *    boost are ignored by the lane.
 *
 * Volume and seed live beside this block in the parent — they are
 * engine-independent.
 */
export function VcpVoiceSettings({ index: i, voice: v, updateVoice }: VcpVoiceSettingsProps) {
  const t = useT()
  const engine: VcpEngine = v.engine ?? "sts"
  const isRespeak = engine === "v3" || engine === "v4"
  const radioClass = (on: boolean) =>
    `h-7 rounded-md border text-xs ${on ? "border-[#ff0073] text-foreground" : "border-border text-muted-foreground"}`
  return (
    <>
      <div>
        <Label>{t("audiocfg.vcpEngine")}</Label>
        <div className="grid grid-cols-3 gap-1" role="radiogroup" aria-label={t("audiocfg.vcpEngine")}>
          <button
            type="button"
            role="radio"
            aria-checked={engine === "sts"}
            className={radioClass(engine === "sts")}
            onClick={() => updateVoice(i, { engine: undefined })}
          >
            {t("audiocfg.engineRecast")}
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={engine === "v3"}
            className={radioClass(engine === "v3")}
            onClick={() => updateVoice(i, { engine: "v3", stability: snapV3(v.stability) })}
          >
            {t("audiocfg.engineRespeak")}
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={engine === "v4"}
            className={radioClass(engine === "v4")}
            onClick={() => updateVoice(i, { engine: "v4" })}
          >
            {t("audiocfg.engineRespeakV4")}
          </button>
        </div>
        {isRespeak && (
          <p className="text-[10px] text-amber-600 mt-1">{t("audiocfg.hintRespeakWarning")}</p>
        )}
      </div>
      {engine === "v3" ? (
        <div>
          <Label>{t("field.stability")}</Label>
          <Select
            value={String(v.stability ?? 0.5)}
            onValueChange={(val) => updateVoice(i, { stability: parseFloat(val) })}
          >
            <SelectTrigger aria-label={t("field.stability")}><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value="0">{t("audiocfg.mostVariable")}</SelectItem>
              <SelectItem value="0.5">{t("audiocfg.balanced05")}</SelectItem>
              <SelectItem value="1">{t("audiocfg.mostStable")}</SelectItem>
            </SelectContent>
          </Select>
        </div>
      ) : (
        <div>
          <Label htmlFor={`stability-${i}`}>{t("field.stability")} ({v.stability ?? 0.5})</Label>
          <Input id={`stability-${i}`} type="range" min={0} max={1} step={0.05} value={v.stability ?? 0.5} onChange={(e) => updateVoice(i, { stability: parseFloat(e.target.value) })} className="h-2" />
          <div className="flex justify-between text-[10px] text-muted-foreground mt-0.5"><span>{t("audiocfg.variable")}</span><span>{t("audiocfg.stable")}</span></div>
        </div>
      )}
      {/* Similarity: honoured by the speech-to-speech recast and by Re-speak
          v4; the v3 lane ignores it, so it is not rendered there. */}
      {engine !== "v3" && (
        <div>
          <Label htmlFor={`similarity-${i}`}>{t("audiocfg.similarity")} ({v.similarityBoost ?? 0.75})</Label>
          <Input id={`similarity-${i}`} type="range" min={0} max={1} step={0.05} value={v.similarityBoost ?? 0.75} onChange={(e) => updateVoice(i, { similarityBoost: parseFloat(e.target.value) })} className="h-2" />
          <div className="flex justify-between text-[10px] text-muted-foreground mt-0.5"><span>{t("audiocfg.low")}</span><span>{t("audiocfg.high")}</span></div>
        </div>
      )}
      {/* Recast-only levers — both Re-speak lanes ignore style and speaker
          boost (documented in the wire contract), so hide them rather than
          render dead controls. */}
      {engine === "sts" && (<>
        <div>
          <Label htmlFor={`style-${i}`}>{t("audiocfg.styleExaggeration")} ({v.style ?? 0})</Label>
          <Input id={`style-${i}`} type="range" min={0} max={1} step={0.05} value={v.style ?? 0} onChange={(e) => updateVoice(i, { style: parseFloat(e.target.value) })} className="h-2" />
          <div className="flex justify-between text-[10px] text-muted-foreground mt-0.5"><span>{t("audiocfg.none")}</span><span>{t("audiocfg.exaggerated")}</span></div>
        </div>
        <div>
          <div className="flex items-center justify-between">
            <Label htmlFor={`speaker-boost-${i}`}>{t("field.speakerBoost")}</Label>
            <Switch id={`speaker-boost-${i}`} checked={v.useSpeakerBoost ?? true} onCheckedChange={(c) => updateVoice(i, { useSpeakerBoost: c })} />
          </div>
          <p className="text-[10px] text-muted-foreground mt-0.5">
            {t("audiocfg.hintSpeakerBoostRecast")}
          </p>
        </div>
      </>)}
    </>
  )
}
