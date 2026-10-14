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
import { createContext, useContext, useEffect, useMemo, useState, useCallback, type ReactNode } from "react"
import {
  ensureLocaleCatalogLoaded,
  resolveLabel as sharedResolveLabel,
  resolveDescription as sharedResolveDescription,
  entryMatchesQuery,
  type I18nCatalogId,
  type LocaleId,
} from "@nodaro/shared/i18n"

export type LocaleDirection = "ltr" | "rtl"

/** Localizes an English interface label the package renders (a section,
 *  group or field name such as "Shot Size" or "Subgenre"). */
export type PickerLabelLocalizer = (english: string) => string

const identityPickerLabel: PickerLabelLocalizer = (english) => english

interface PickerUiContextValue {
  locale: LocaleId
  dir: LocaleDirection
  localizeLabel: PickerLabelLocalizer
}

const PickerUiContext = createContext<PickerUiContextValue>({ locale: "en", dir: "ltr", localizeLabel: identityPickerLabel })

export function PickerUiProvider({
  locale = "en",
  dir = "ltr",
  localizeLabel = identityPickerLabel,
  children,
}: {
  locale?: LocaleId
  dir?: LocaleDirection
  /** The host's localizer for the English section, group and field names the
   *  pickers render. The package owns no dictionary; English hosts omit it. */
  localizeLabel?: PickerLabelLocalizer
  children: ReactNode
}) {
  const value = useMemo(() => ({ locale, dir, localizeLabel }), [locale, dir, localizeLabel])
  return <PickerUiContext.Provider value={value}>{children}</PickerUiContext.Provider>
}

/** The host's label localizer (identity when the host passes none). */
export function usePickerLabel(): PickerLabelLocalizer {
  return useContext(PickerUiContext).localizeLabel
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

/** Fill `{name}` placeholders in a localized label template, so a host table
 *  can translate a label that carries a number ("pick up to {n}"). */
export function fillLabel(template: string, vars: Readonly<Record<string, string | number>>): string {
  return template.replace(/\{(\w+)\}/g, (whole, name: string) => (name in vars ? String(vars[name]) : whole))
}
