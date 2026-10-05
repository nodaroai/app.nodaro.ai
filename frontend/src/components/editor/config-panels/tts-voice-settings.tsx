import { ttsHasLever } from "@nodaro/shared"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { useT } from "@/lib/i18n"
import { TTS_VOICE_SETTING_DEFAULTS as DEFAULTS } from "@/types/nodes"

/** The text-to-speech node fields these controls read and write. */
export interface TtsSettingsFields {
  stability?: number
  similarityBoost?: number
  style?: number
  speed?: number
}

interface SettingsProps {
  readonly provider: string | undefined
  readonly data: TtsSettingsFields
  readonly onUpdate: (patch: Partial<TtsSettingsFields>) => void
}

/**
 * The voice-setting sliders of a text-to-speech node — only the levers the
 * chosen model honours (`MODEL_CATALOG[id].tts.levers`). Which model honours
 * which is data on its sheet, never a comparison here. A missing provider shows
 * what turbo shows — unchanged from before the sheet; the node itself runs an
 * omitted provider as v3 (see the model dropdown beside it). A node saved
 * without a setting shows the node's default from its one source,
 * `TTS_VOICE_SETTING_DEFAULTS` — the same value a published app's card starts at.
 */
export function TtsVoiceSettings({ provider, data, onUpdate }: SettingsProps) {
  const t = useT()
  return (
    <>
      {ttsHasLever(provider, "stability") && (
        <div>
          <Label htmlFor="stability">{t("field.stability")} ({data.stability ?? DEFAULTS.stability})</Label>
          <Input id="stability" type="range" min={0} max={1} step={0.05} value={data.stability ?? DEFAULTS.stability} onChange={(e) => onUpdate({ stability: parseFloat(e.target.value) })} className="h-2" />
          <div className="flex justify-between text-[10px] text-muted-foreground mt-0.5"><span>{t("audiocfg.variable")}</span><span>{t("audiocfg.stable")}</span></div>
        </div>
      )}
      {ttsHasLever(provider, "similarity") && (
        <div>
          <Label htmlFor="similarityBoost">{t("audiocfg.similarity")} ({data.similarityBoost ?? DEFAULTS.similarityBoost})</Label>
          <Input id="similarityBoost" type="range" min={0} max={1} step={0.05} value={data.similarityBoost ?? DEFAULTS.similarityBoost} onChange={(e) => onUpdate({ similarityBoost: parseFloat(e.target.value) })} className="h-2" />
          <div className="flex justify-between text-[10px] text-muted-foreground mt-0.5"><span>{t("audiocfg.low")}</span><span>{t("audiocfg.high")}</span></div>
        </div>
      )}
      {ttsHasLever(provider, "style") && (
        <div>
          <Label htmlFor="style">{t("audiocfg.styleExaggeration")} ({data.style ?? DEFAULTS.style})</Label>
          <Input id="style" type="range" min={0} max={1} step={0.05} value={data.style ?? DEFAULTS.style} onChange={(e) => onUpdate({ style: parseFloat(e.target.value) })} className="h-2" />
          <div className="flex justify-between text-[10px] text-muted-foreground mt-0.5"><span>{t("audiocfg.none")}</span><span>{t("audiocfg.exaggerated")}</span></div>
        </div>
      )}
      {ttsHasLever(provider, "speed") && (
        <div>
          <Label htmlFor="speed">{t("audiocfg.speed")} ({data.speed ?? DEFAULTS.speed})</Label>
          <Input id="speed" type="range" min={0.7} max={1.2} step={0.05} value={data.speed ?? DEFAULTS.speed} onChange={(e) => onUpdate({ speed: parseFloat(e.target.value) })} className="h-2" />
          <div className="flex justify-between text-[10px] text-muted-foreground mt-0.5"><span>0.7x</span><span>1.2x</span></div>
        </div>
      )}
    </>
  )
}
