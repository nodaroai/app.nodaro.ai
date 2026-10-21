// One piece of trend text in every platform language: English (required) and
// Hebrew as tabs, any other platform language one pick away. Each language is
// typed in its own direction (Hebrew and Arabic right to left).

import { useId, useState } from "react"
import { LANGUAGES, type LocaleId } from "@nodaro/shared/i18n"
import { Input } from "@/components/ui/input"
import { Textarea } from "@/components/ui/textarea"
import { cn } from "@/lib/utils"
import type { TrendLocalizedText } from "@/lib/api"

const PINNED: readonly LocaleId[] = ["en", "he"]
const byId = new Map(LANGUAGES.map((l) => [l.id, l]))

interface Props {
  readonly label: string
  readonly value: TrendLocalizedText
  readonly onChange: (next: TrendLocalizedText) => void
  readonly maxLength: number
  readonly multiline?: boolean
  readonly optional?: boolean
}

export function LocalizedField({ label, value, onChange, maxLength, multiline, optional }: Props) {
  const id = useId()
  const [lang, setLang] = useState<LocaleId>("en")
  // English and Hebrew always; another language once it has text or is picked.
  const shown = [
    ...PINNED,
    ...LANGUAGES.map((l) => l.id).filter((l) => !PINNED.includes(l) && (l === lang || !!value[l])),
  ]
  const others = LANGUAGES.filter((l) => !shown.includes(l.id))
  const def = byId.get(lang)
  const text = value[lang] ?? ""
  const fieldLabel = `${label} (${def?.englishName ?? lang})`
  const set = (v: string) => onChange({ ...value, [lang]: v })
  const missingEnglish = !optional && !value.en.trim()

  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <label htmlFor={id} className="text-sm font-medium">
          {label}
          {optional && <span className="ml-1 text-xs font-normal text-muted-foreground">optional</span>}
        </label>
        <div className="flex flex-wrap items-center gap-1" role="group" aria-label={`${label}: language`}>
          {shown.map((l) => (
            <button
              key={l}
              type="button"
              aria-pressed={lang === l}
              onClick={() => setLang(l)}
              className={cn(
                "relative h-8 min-w-9 rounded-md border px-2 text-xs font-medium",
                lang === l ? "border-primary bg-primary text-primary-foreground" : "bg-background hover:bg-muted",
              )}
            >
              {byId.get(l)?.shortCode ?? l}
              {value[l] && lang !== l && <span className="absolute right-0.5 top-0.5 h-1.5 w-1.5 rounded-full bg-emerald-500" />}
            </button>
          ))}
          {others.length > 0 && (
            <select
              aria-label={`${label}: another language`}
              className="h-8 rounded-md border bg-background px-1 text-xs"
              value=""
              onChange={(e) => e.target.value && setLang(e.target.value as LocaleId)}
            >
              <option value="">+ Language</option>
              {others.map((l) => (
                <option key={l.id} value={l.id}>
                  {l.englishName}
                </option>
              ))}
            </select>
          )}
        </div>
      </div>
      {multiline ? (
        <Textarea
          id={id}
          aria-label={fieldLabel}
          dir={def?.dir ?? "ltr"}
          rows={2}
          maxLength={maxLength}
          value={text}
          onChange={(e) => set(e.target.value)}
          aria-invalid={lang === "en" && missingEnglish}
        />
      ) : (
        <Input
          id={id}
          aria-label={fieldLabel}
          dir={def?.dir ?? "ltr"}
          maxLength={maxLength}
          value={text}
          onChange={(e) => set(e.target.value)}
          aria-invalid={lang === "en" && missingEnglish}
        />
      )}
      {lang !== "en" && !text && value.en && (
        <p className="truncate text-xs text-muted-foreground" dir="auto">
          Falls back to English: {value.en}
        </p>
      )}
    </div>
  )
}
