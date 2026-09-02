import { AlertTriangle } from "lucide-react"
import { useT } from "@/lib/i18n"

/**
 * Character counter + over-limit WARNING for prompt / negative / text fields.
 *
 * Warn-don't-block: the field itself stays editable up to the generous
 * PROMPT_HARD_CEILING so the user can keep typing; this surfaces the per-MODEL
 * limit and tells them the backend will truncate to it — they decide whether to
 * switch to a higher-limit model or trim. `max` is the selected model's verified
 * cap (getMaxImagePromptChars / getMaxVideoPromptChars / getMaxTtsChars / Suno
 * helpers). When the model's limit isn't known, pass the modality default.
 */
export function PromptLengthCounter({
  value,
  max,
  modelLabel,
  noun,
}: {
  readonly value: string | undefined
  readonly max: number
  /** The selected model's name, shown in the warning so the user knows what to switch away from. */
  readonly modelLabel?: string
  /** Field noun for the warning copy ("prompt" | "negative prompt" | "lyrics" | "text"). Already
   *  localized by the caller; defaults to the localized "prompt". */
  readonly noun?: string
}) {
  const t = useT()
  const len = value?.length ?? 0
  const over = len > max
  const nounText = noun ?? t("audiocfg.prompt")
  return (
    <div className="flex flex-col gap-0.5">
      <span className={`text-xs ${over ? "text-amber-500 font-medium" : "text-muted-foreground"}`}>
        {len}/{max}
      </span>
      {over && (
        <span className="text-xs text-amber-500 inline-flex items-start gap-1">
          <AlertTriangle className="h-3 w-3 shrink-0 mt-0.5" aria-hidden />
          <span>
            {modelLabel
              ? t("cfgext.plcOverLimitModel", { over: len - max, model: modelLabel, max, noun: nounText })
              : t("cfgext.plcOverLimit", { over: len - max, max, noun: nounText })}
          </span>
        </span>
      )}
    </div>
  )
}
