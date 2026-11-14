"use client"

import { useId } from "react"
import { ttsDirection, ttsDirectionFor } from "@nodaro/shared/model-catalog"
import { Label } from "@/components/ui/label"
import { Separator } from "@/components/ui/separator"
import { Textarea } from "@/components/ui/textarea"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useT } from "@/lib/i18n"

/** The text-to-speech node fields these controls read and write (`TextToSpeechData`). A type, so `ttsDirectionFor` reads it as a record. */
export type TtsDirectionFields = {
  styleDirection?: string
  pace?: string
  accent?: string
  audioProfile?: string
}

interface Props {
  /** The model the panel shows (a node with no model shows the default one). */
  readonly provider: string
  readonly data: TtsDirectionFields
  readonly onUpdate: (patch: Partial<TtsDirectionFields>) => void
}

/** The "model default" row of a choice: Radix forbids an empty value, so it is a sentinel that writes `undefined`. */
const DEFAULT_CHOICE = "__default"

function ChoiceField({ label, choices, value, onChange }: {
  readonly label: string
  readonly choices: readonly string[]
  /** The value the run sends — a stored value the model does not take reads as the default. */
  readonly value: string | undefined
  readonly onChange: (value: string | undefined) => void
}) {
  const t = useT()
  const labelId = useId()
  return (
    <div>
      <Label id={labelId}>{label}</Label>
      <Select
        value={value ?? DEFAULT_CHOICE}
        onValueChange={(v) => {
          // Radix can report "" while its items change: no choice was made.
          if (v) onChange(v === DEFAULT_CHOICE ? undefined : v)
        }}
      >
        <SelectTrigger aria-labelledby={labelId}><SelectValue /></SelectTrigger>
        <SelectContent>
          <SelectItem value={DEFAULT_CHOICE}>{t("common.default")}</SelectItem>
          {/* The model's own names, sent as they are — product terms, shown as written in every language. */}
          {choices.map((c) => (
            <SelectItem key={c} value={c}>{c}</SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}

function FreeTextField({ label, placeholder, max, value, onChange }: {
  readonly label: string
  readonly placeholder: string
  readonly max: number
  readonly value: string
  readonly onChange: (value: string) => void
}) {
  const id = useId()
  return (
    <div>
      <Label htmlFor={id}>{label}</Label>
      <Textarea id={id} rows={2} maxLength={max} value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} dir="auto" />
      <span className={`text-xs ${value.length > max ? "text-amber-500 font-medium" : "text-muted-foreground"}`}>
        {value.length}/{max}
      </span>
    </div>
  )
}

/**
 * "Style direction" of a text-to-speech model whose sheet takes it
 * (`TtsCapabilities.direction`: Gemini) — how the voice delivers the text,
 * never spoken and never billed. Each control is drawn from the sheet, never a
 * model id: free text for `styleDirection` up to `styleMaxChars` (3.8), or a
 * choice of the model's `styles` (3.1 / 2.5); `pace` and `accent` choices; free
 * text for `audioProfile` up to `audioProfileMaxChars`. A choice's "Default"
 * clears its field (the model's own default runs). Nothing for a model with no
 * direction.
 *
 * A choice shows what the run sends (`ttsDirectionFor`), so a value the model
 * does not take reads as the default rather than a blank field. Writes ONLY in
 * the user's own edit handlers — never from an effect: one panel instance is
 * reused across text-to-speech nodes. A user's model switch clears what the new
 * model does not take (`ttsModelSwitchPatch`). The fields are not mappable: a
 * mapping resolves only for a field listed in `NODE_MAPPABLE_FIELDS`.
 */
export function TtsDirectionSection({ provider, data, onUpdate }: Props) {
  const t = useT()
  const sheet = ttsDirection(provider)
  if (!sheet) return null
  const sent = ttsDirectionFor(provider, data)
  return (
    <>
      <Separator />
      <div className="space-y-2" data-testid="tts-direction">
        <div>
          <Label className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">{t("audiocfg.directionTitle")}</Label>
          <p className="text-[11px] text-muted-foreground mt-0.5">{t("audiocfg.directionHint")}</p>
        </div>
        {sheet.styleMaxChars !== undefined && !sheet.styles && (
          <FreeTextField
            label={t("audiocfg.directionStyle")}
            placeholder={t("audiocfg.directionStylePh")}
            max={sheet.styleMaxChars}
            value={data.styleDirection ?? ""}
            onChange={(v) => onUpdate({ styleDirection: v })}
          />
        )}
        {sheet.styles && (
          <ChoiceField label={t("audiocfg.directionStyle")} choices={sheet.styles} value={sent.styleDirection} onChange={(v) => onUpdate({ styleDirection: v })} />
        )}
        {sheet.paces && (
          <ChoiceField label={t("audiocfg.directionPace")} choices={sheet.paces} value={sent.pace} onChange={(v) => onUpdate({ pace: v })} />
        )}
        {sheet.accents && (
          <ChoiceField label={t("audiocfg.directionAccent")} choices={sheet.accents} value={sent.accent} onChange={(v) => onUpdate({ accent: v })} />
        )}
        {sheet.audioProfileMaxChars !== undefined && (
          <FreeTextField
            label={t("audiocfg.directionAudioProfile")}
            placeholder={t("audiocfg.directionAudioProfilePh")}
            max={sheet.audioProfileMaxChars}
            value={data.audioProfile ?? ""}
            onChange={(v) => onUpdate({ audioProfile: v })}
          />
        )}
      </div>
    </>
  )
}
