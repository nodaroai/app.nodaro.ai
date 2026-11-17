import { SUNO_SPEECH_LIMITS, sunoSpeechMode, sunoSpeechVariety, sunoSpeechVocalGender, type SunoSpeechMode } from "@nodaro/render-rules"
import { useT } from "@/lib/i18n"
import { hasCredits } from "@/lib/edition"
import { useModelCredits } from "@/hooks/use-model-credit-cost"
import { Label } from "@/components/ui/label"
import { Textarea } from "@/components/ui/textarea"
import { Switch } from "@/components/ui/switch"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import type { ConfigProps } from "@/components/editor/config-panels/types"
import type { UnitConfigKit } from "../exec-kit"
import { definition } from "./definition.generated"
import type { SunoSpeechData } from "./types"

const PRICE_ROWS: Readonly<Record<string, number>> = definition.priceRows

/** What a run costs: the charged price of the node's flat row (both takes), the editor's price mirror until the server answers. */
export function useRunCredits(): number {
  return useModelCredits(definition.type, PRICE_ROWS[definition.type] ?? 0)
}

/** The value a select shows for "not set" (the model's own choice); never sent. */
const UNSET = "auto"

/** A character count against its limit, as the provider counts it (after trimming). */
function Count({ text, max, testId }: { readonly text: string; readonly max: number; readonly testId: string }) {
  const n = text.trim().length
  return (
    <span data-testid={testId} aria-live="polite" className={`shrink-0 text-[11px] tabular-nums ${n > max ? "text-red-500" : "text-muted-foreground"}`}>
      {`${n} / ${max}`}
    </span>
  )
}

/**
 * Suno Speech's settings. A mode switch: Brief (the default; a one-line scene,
 * Suno writes and performs the script) or Script (the words to speak, with an
 * optional tone, variety, voice gender and background music). Each field shows
 * its limit as the route enforces it. Nothing depends on a provider, so nothing
 * snaps (root CLAUDE.md Provider Enum Sync 12b does not apply). Wired text
 * (the Prompt input) replaces the mode's text at run time.
 */
export function ConfigPanel({ data: raw, onUpdate }: ConfigProps<never> & { readonly kit: UnitConfigKit; readonly nodeId: string }) {
  const data = raw as unknown as SunoSpeechData
  const t = useT()
  const mode = sunoSpeechMode(data.mode)
  const prompt = typeof data.prompt === "string" ? data.prompt : ""
  const script = typeof data.script === "string" ? data.script : ""
  const tone = typeof data.tone === "string" ? data.tone : ""
  const variety = sunoSpeechVariety(data.variety)
  const gender = sunoSpeechVocalGender(data.vocalGender)
  const credits = useRunCredits()
  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-1.5">
        <Label>{t("sunoSpeech.mode")}</Label>
        <Select value={mode} onValueChange={(v) => onUpdate({ mode: sunoSpeechMode(v) as SunoSpeechMode })}>
          <SelectTrigger aria-label={t("sunoSpeech.mode")}><SelectValue /></SelectTrigger>
          <SelectContent>
            <SelectItem value="brief">{t("sunoSpeech.modeBrief")}</SelectItem>
            <SelectItem value="script">{t("sunoSpeech.modeScript")}</SelectItem>
          </SelectContent>
        </Select>
        <p className="text-[11px] text-muted-foreground leading-snug">{mode === "brief" ? t("sunoSpeech.modeBriefHint") : t("sunoSpeech.modeScriptHint")}</p>
      </div>

      {mode === "brief" ? (
        <div className="flex flex-col gap-1.5">
          <Label htmlFor="suno-speech-prompt">{t("sunoSpeech.brief")}</Label>
          <Textarea
            id="suno-speech-prompt"
            className="min-h-[80px] text-sm resize-y"
            value={prompt}
            maxLength={SUNO_SPEECH_LIMITS.promptMax}
            placeholder={t("sunoSpeech.briefPlaceholder")}
            onChange={(e) => onUpdate({ prompt: e.target.value.slice(0, SUNO_SPEECH_LIMITS.promptMax) })}
          />
          <div className="flex justify-end"><Count text={prompt} max={SUNO_SPEECH_LIMITS.promptMax} testId="suno-speech-prompt-count" /></div>
        </div>
      ) : (
        <>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="suno-speech-script">{t("sunoSpeech.script")}</Label>
            <Textarea
              id="suno-speech-script"
              className="min-h-[120px] text-sm resize-y"
              value={script}
              maxLength={SUNO_SPEECH_LIMITS.scriptMax}
              placeholder={t("sunoSpeech.scriptPlaceholder")}
              onChange={(e) => onUpdate({ script: e.target.value.slice(0, SUNO_SPEECH_LIMITS.scriptMax) })}
            />
            <div className="flex justify-end"><Count text={script} max={SUNO_SPEECH_LIMITS.scriptMax} testId="suno-speech-script-count" /></div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label htmlFor="suno-speech-tone">{t("sunoSpeech.tone")}</Label>
            <Textarea
              id="suno-speech-tone"
              className="min-h-[60px] text-sm resize-y"
              value={tone}
              maxLength={SUNO_SPEECH_LIMITS.toneMax}
              placeholder={t("sunoSpeech.tonePlaceholder")}
              onChange={(e) => onUpdate({ tone: e.target.value.slice(0, SUNO_SPEECH_LIMITS.toneMax) })}
            />
            <div className="flex justify-end"><Count text={tone} max={SUNO_SPEECH_LIMITS.toneMax} testId="suno-speech-tone-count" /></div>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>{t("sunoSpeech.vocalGender")}</Label>
            <Select value={gender ?? UNSET} onValueChange={(v) => onUpdate({ vocalGender: sunoSpeechVocalGender(v) })}>
              <SelectTrigger aria-label={t("sunoSpeech.vocalGender")}><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={UNSET}>{t("sunoSpeech.modelPicks")}</SelectItem>
                <SelectItem value="female">{t("sunoSpeech.female")}</SelectItem>
                <SelectItem value="male">{t("sunoSpeech.male")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex flex-col gap-1.5">
            <Label>{t("sunoSpeech.variety")}</Label>
            <Select value={variety === undefined ? UNSET : String(variety)} onValueChange={(v) => onUpdate({ variety: v === UNSET ? undefined : sunoSpeechVariety(Number(v)) })}>
              <SelectTrigger aria-label={t("sunoSpeech.variety")}><SelectValue /></SelectTrigger>
              <SelectContent>
                <SelectItem value={UNSET}>{t("sunoSpeech.modelPicks")}</SelectItem>
                <SelectItem value="0">{t("sunoSpeech.variety0")}</SelectItem>
                <SelectItem value="1">{t("sunoSpeech.variety1")}</SelectItem>
                <SelectItem value="2">{t("sunoSpeech.variety2")}</SelectItem>
                <SelectItem value="3">{t("sunoSpeech.variety3")}</SelectItem>
                <SelectItem value="4">{t("sunoSpeech.variety4")}</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center justify-between gap-2">
            <Label htmlFor="suno-speech-music">{t("sunoSpeech.backgroundMusic")}</Label>
            <Switch id="suno-speech-music" checked={data.backgroundMusic === true} onCheckedChange={(on) => onUpdate({ backgroundMusic: on })} />
          </div>
        </>
      )}

      {hasCredits() && (
        <p className="text-[11px] text-muted-foreground leading-snug border-t border-border pt-2">
          {t("sunoSpeech.price", { credits })}
        </p>
      )}
    </div>
  )
}
