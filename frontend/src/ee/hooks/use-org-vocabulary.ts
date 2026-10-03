import { useMemo } from "react"
import { useLocaleStore } from "@/lib/locale-store"
import { localizeVocabulary } from "@/ee/lib/org-vocabulary"

/**
 * A vocabulary as the server sent it, rendered in the interface language
 * (`ee/lib/org-vocabulary.ts`): the kind's default words translated, the
 * organization's own words as typed, and the workspace word's gender. Pass the
 * organization's raw `settings.vocabulary_overrides` as `overrides`: its own
 * word's gender lives there. Empty when there is no vocabulary yet.
 */
export function useOrgVocabulary(
  vocabulary: Readonly<Record<string, string>> | null | undefined,
  overrides?: Readonly<Record<string, string>> | null,
): Record<string, string> {
  const locale = useLocaleStore((s) => s.locale)
  return useMemo(
    () => (vocabulary ? localizeVocabulary(vocabulary, locale, overrides) : {}),
    [vocabulary, overrides, locale],
  )
}
