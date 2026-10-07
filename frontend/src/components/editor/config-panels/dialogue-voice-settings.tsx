import { dialogueHasLever, getDialogueCapabilities } from "@nodaro/shared"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useT } from "@/lib/i18n"
import { TTS_VOICE_SETTING_DEFAULTS } from "@/types/nodes"

/** The Text to Dialogue node fields these controls read and write. */
export interface DialogueSettingsFields {
  stability?: number
  similarityBoost?: number
}

interface Props {
  readonly provider: string | undefined
  readonly data: DialogueSettingsFields
  readonly onUpdate: (patch: Partial<DialogueSettingsFields>) => void
}

/** The stability a dialogue node shows when it stores none — the panel's default since it shipped. */
const DIALOGUE_STABILITY_DEFAULT = 0.5

/**
 * Stability and similarity of a Text to Dialogue node — what the chosen model's
 * sheet offers: stepped stability as a dropdown (v3 dialogue: 0 / 0.5 / 1),
 * otherwise a 0–1 slider; similarity only when the model honours it. Which
 * model offers which is data on its sheet, never a comparison here.
 */
export function DialogueVoiceSettings({ provider, data, onUpdate }: Props) {
  const t = useT()
  const steps = getDialogueCapabilities(provider).stabilitySteps
  const stability = data.stability ?? DIALOGUE_STABILITY_DEFAULT
  const stepLabel = (s: number) =>
    s === 0 ? t("audiocfg.mostVariable") : s === 0.5 ? t("audiocfg.balanced05") : s === 1 ? t("audiocfg.mostStable") : String(s)
  return (
    <>
      {steps ? (
        <div>
          <Label>{t("field.stability")}</Label>
          <Select value={String(stability)} onValueChange={(v) => onUpdate({ stability: parseFloat(v) })}>
            <SelectTrigger aria-label={t("field.stability")}><SelectValue /></SelectTrigger>
            <SelectContent>
              {steps.map((s) => <SelectItem key={s} value={String(s)}>{stepLabel(s)}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
      ) : (
        <div>
          <Label htmlFor="dlg-stability">{t("field.stability")} ({stability})</Label>
          <Input id="dlg-stability" type="range" min={0} max={1} step={0.05} value={stability} onChange={(e) => onUpdate({ stability: parseFloat(e.target.value) })} className="h-2" />
          <div className="flex justify-between text-[10px] text-muted-foreground mt-0.5"><span>{t("audiocfg.variable")}</span><span>{t("audiocfg.stable")}</span></div>
        </div>
      )}
      {dialogueHasLever(provider, "similarity") && (
        <div>
          <Label htmlFor="dlg-similarity">{t("audiocfg.similarity")} ({data.similarityBoost ?? TTS_VOICE_SETTING_DEFAULTS.similarityBoost})</Label>
          <Input id="dlg-similarity" type="range" min={0} max={1} step={0.05} value={data.similarityBoost ?? TTS_VOICE_SETTING_DEFAULTS.similarityBoost} onChange={(e) => onUpdate({ similarityBoost: parseFloat(e.target.value) })} className="h-2" />
          <div className="flex justify-between text-[10px] text-muted-foreground mt-0.5"><span>{t("audiocfg.low")}</span><span>{t("audiocfg.high")}</span></div>
        </div>
      )}
    </>
  )
}
