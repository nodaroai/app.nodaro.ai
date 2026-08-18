/**
 * i18n seam — the package owns NO locale state.
 *
 * The consuming app wraps its tree in <PickerUiProvider locale={...} dir={...}>
 * and the package's `useLocalizedCatalog` / `useLocaleDir` read from that
 * context. All localization LOGIC lives in @nodaro/shared (sidecar loading +
 * resolvers) — this file only sources the current locale, exactly mirroring
 * the app's original `use-localized-entry` hook so moved components keep
 * byte-identical behavior. Defaults ("en", "ltr") make the provider optional.
 */
import { createContext, useContext, useEffect, useState, useCallback, type ReactNode } from "react"
import {
  ensureLocaleCatalogLoaded,
  resolveLabel as sharedResolveLabel,
  resolveDescription as sharedResolveDescription,
  entryMatchesQuery,
  type I18nCatalogId,
  type LocaleId,
} from "@nodaro/shared"

export type LocaleDirection = "ltr" | "rtl"

interface PickerUiContextValue {
  locale: LocaleId
  dir: LocaleDirection
}

const PickerUiContext = createContext<PickerUiContextValue>({ locale: "en", dir: "ltr" })

export function PickerUiProvider({
  locale = "en",
  dir = "ltr",
  children,
}: {
  locale?: LocaleId
  dir?: LocaleDirection
  children: ReactNode
}) {
  return <PickerUiContext.Provider value={{ locale, dir }}>{children}</PickerUiContext.Provider>
}

/** Current UI locale as injected by the host app (default "en"). */
export function usePickerUiLocale(): LocaleId {
  return useContext(PickerUiContext).locale
}

/** Text direction as injected by the host app (default "ltr"). */
export function useLocaleDir(): LocaleDirection {
  return useContext(PickerUiContext).dir
}

/** Localized label/description resolvers for a catalog — identical contract to
 *  the app's original hook; lazy-loads the locale sidecar then re-renders. */
export function useLocalizedCatalog(catalog: I18nCatalogId) {
  const locale = usePickerUiLocale()
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
