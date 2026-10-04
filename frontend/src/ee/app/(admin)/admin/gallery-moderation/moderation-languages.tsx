import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { useT } from "@/lib/i18n"
import { uiLocale } from "@/lib/i18n/format"

/** The languages an admin can say a word is in. Shown in the admin's language; sent in English for the model. */
const CODES = ["he", "en", "ar", "ru", "es", "pt", "fr", "de", "it", "tr", "pl", "nl", "hi", "id", "ja", "ko", "zh", "th", "vi"] as const
const ANY = "any"

function named(code: string, locale: string | undefined): string {
  try {
    return new Intl.DisplayNames(locale ? [locale] : undefined, { type: "language" }).of(code) ?? code
  } catch {
    return code
  }
}

/** The English name the backend passes to the model, or undefined for "any language". */
export function languageForModel(code: string): string | undefined {
  return code === ANY ? undefined : named(code, "en")
}

export const DEFAULT_LANGUAGE = "he"

export function LanguageSelect({ value, onChange, disabled }: { readonly value: string; readonly onChange: (code: string) => void; readonly disabled?: boolean }) {
  const t = useT()
  const locale = uiLocale()
  return (
    <Select value={value} onValueChange={onChange} disabled={disabled}>
      <SelectTrigger className="w-40" aria-label={t("galleryModeration.language")}>
        <SelectValue />
      </SelectTrigger>
      <SelectContent>
        <SelectItem value={ANY}>{t("galleryModeration.languageAny")}</SelectItem>
        {CODES.map((code) => (
          <SelectItem key={code} value={code}>
            {named(code, locale)}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
