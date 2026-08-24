// UI-string i18n for the app chrome. Deliberately tiny and dependency-free:
// it reuses the existing locale-store (the same setting that localizes picker
// catalogs) so ONE language choice drives both. English is the canonical key
// set; every other locale is a partial map that falls back to English, then to
// the raw key.
import { useMemo } from "react"
import { useLocaleStore } from "@/lib/locale-store"
import type { LocaleId } from "@nodaro/shared"
import { en, type MessageKey, type ChromeDict } from "./en"
import { he } from "./he"
import { ar } from "./ar"
import { de } from "./de"
import { es } from "./es"
import { fr } from "./fr"
import { hi } from "./hi"
import { ja } from "./ja"
import { ko } from "./ko"
import { ptBR } from "./pt-br"
import { ru } from "./ru"
import { zhCN } from "./zh-cn"

// All twelve shipped locales are registered here. Most start as empty stub
// dicts and fall back to English until translated; `en` and `he` are
// complete.
const DICTS: Partial<Record<LocaleId, ChromeDict>> = {
  en, he, ar, de, es, fr, hi, ja, ko, "pt-BR": ptBR, ru, "zh-CN": zhCN,
}

/** Locale ids that have a registered chrome dict (empty or not). */
export function registeredChromeLocales(): LocaleId[] {
  return Object.keys(DICTS) as LocaleId[]
}

/** Interpolate {name}-style placeholders. */
function interpolate(template: string, vars?: Record<string, string | number>): string {
  if (!vars) return template
  return template.replace(/\{(\w+)\}/g, (_, k: string) =>
    k in vars ? String(vars[k]) : `{${k}}`,
  )
}

export type TFunction = (key: MessageKey, vars?: Record<string, string | number>) => string

/** Resolve a message for a given locale (pure — for tests + non-hook callers). */
export function translate(locale: LocaleId, key: MessageKey, vars?: Record<string, string | number>): string {
  const s = DICTS[locale]?.[key] ?? en[key] ?? key
  return interpolate(s, vars)
}

/**
 * The app's translation hook. `const t = useT()` then `t("nav.projects")`.
 * Re-renders when the user switches language.
 */
export function useT(): TFunction {
  const locale = useLocaleStore((s) => s.locale)
  return useMemo<TFunction>(() => (key, vars) => translate(locale, key, vars), [locale])
}

/**
 * Non-hook translation for imperative call sites — toasts, event handlers, and
 * plain (non-component) modules like the workflow execution engine. Reads the
 * CURRENT locale from the store at call time, so it reflects the live language
 * choice; do NOT cache its result across a language switch.
 */
export function tx(key: MessageKey, vars?: Record<string, string | number>): string {
  return translate(useLocaleStore.getState().locale, key, vars)
}

/**
 * Localized relative-time string ("just now", "3h ago") in the CURRENT locale.
 * The single source of truth for relative timestamps — do NOT reimplement it
 * per page (an English-only copy is how mixed-language rows like "נמחק 3h ago"
 * shipped). Non-hook, so it works in plain render helpers; reads the live
 * locale via tx(), so don't cache its result across a language switch.
 */
export function formatRelative(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime()
  const min = Math.floor(ms / 60_000)
  if (min < 1) return tx("time.justNow")
  if (min < 60) return tx("time.minAgo", { n: min })
  const hr = Math.floor(min / 60)
  if (hr < 24) return tx("time.hrAgo", { n: hr })
  const d = Math.floor(hr / 24)
  if (d < 30) return tx("time.dayAgo", { n: d })
  const mo = Math.floor(d / 30)
  return tx("time.moAgo", { n: mo })
}

export type { MessageKey, ChromeDict }
