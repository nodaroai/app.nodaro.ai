/**
 * Hook for reading localized label/description from an i18n sidecar.
 *
 * Usage in a picker:
 *
 * ```ts
 * const { resolveLabel, resolveDescription, matches } = useLocalizedCatalog("styling")
 * const label = resolveLabel(entry.id, entry.label)
 * const desc = resolveDescription(entry.id, entry.description)
 * const visible = matches(entry.id, entry.label, entry.description, query)
 * ```
 *
 * The hook lazy-loads the sidecar file for the user's current locale on
 * mount, then re-renders once loaded. While loading (or when no translation
 * exists), the resolver returns the canonical English string.
 */

import { useEffect, useState, useCallback } from "react"
import {
  ensureLocaleCatalogLoaded,
  resolveLabel as sharedResolveLabel,
  resolveDescription as sharedResolveDescription,
  entryMatchesQuery,
  type I18nCatalogId,
} from "@nodaro-shared/i18n"
import { useUserLocale } from "@/lib/locale-store"

export function useLocalizedCatalog(catalog: I18nCatalogId) {
  const locale = useUserLocale()
  // `tick` forces re-render once the async load completes.
  const [, setTick] = useState(0)

  useEffect(() => {
    if (locale === "en") return
    let cancelled = false
    ensureLocaleCatalogLoaded(catalog, locale).then(() => {
      if (!cancelled) setTick((n) => n + 1)
    })
    return () => {
      cancelled = true
    }
  }, [catalog, locale])

  const resolveLabel = useCallback(
    (id: string, englishLabel: string) => sharedResolveLabel(catalog, id, englishLabel, locale),
    [catalog, locale],
  )

  const resolveDescription = useCallback(
    (id: string, englishDescription: string) =>
      sharedResolveDescription(catalog, id, englishDescription, locale),
    [catalog, locale],
  )

  const matches = useCallback(
    (id: string, englishLabel: string, englishDescription: string, query: string) =>
      entryMatchesQuery(catalog, id, englishLabel, englishDescription, locale, query),
    [catalog, locale],
  )

  return { locale, resolveLabel, resolveDescription, matches }
}
