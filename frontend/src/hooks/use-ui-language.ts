import { useCallback, useMemo } from "react"
import type { LocaleId } from "@nodaro/shared/i18n"
import { useLocaleStore } from "@/lib/locale-store"
import { useAuth } from "@/hooks/use-auth"
import { useUpdatePreferredLocaleMutation } from "@/hooks/queries/use-user-settings-queries"
import { languageMenuRows } from "@/lib/i18n"

/**
 * The interface language as the language controls read and change it — the
 * sidebar's switcher and the shared site header's pill alike: the current
 * locale, the rows to offer (complete translations, plus the current one —
 * `lib/i18n/offered-locales.ts`), and a pick that switches the app chrome AND
 * the picker catalogs (the locale store) and persists it to the profile.
 */
export function useUiLanguage() {
  const locale = useLocaleStore((s) => s.locale)
  const setLocale = useLocaleStore((s) => s.setLocale)
  const { user } = useAuth()
  const userId = user?.id
  const { mutate } = useUpdatePreferredLocaleMutation()

  const pick = useCallback(
    (next: LocaleId) => {
      setLocale(next)
      if (userId) mutate({ userId, preferredLocale: next })
    },
    [setLocale, userId, mutate],
  )

  // Stable per locale, so consumers memoizing on `rows` (the header's
  // language pill) do not rebuild on every render.
  const rows = useMemo(() => languageMenuRows(locale), [locale])

  return { locale, rows, pick }
}
