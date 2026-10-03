// Dates, times and numbers the user READS, in the language chosen in the
// app's language menu — not the browser's locale. A Hebrew UI must not print
// "Sep 24" or "9/24/2026" beside Hebrew text just because the browser is
// en-US.
//
// English keeps the browser default (`undefined`), so an English user's
// figures are byte-identical to what the bare native calls printed before
// this module existed (an en-GB browser still gets "24/09/2026").
//
// Non-hook, like `tx()`: every helper reads the LIVE locale at call time.
// Call them at render; never build a formatter (or cache its output) at
// module scope — that freezes the locale at import time.
//
// Guarded by `__tests__/ui-locale-formatting.test.ts`: a `.toLocaleDateString(`,
// `.toLocaleTimeString(`, `new Date(…).toLocaleString(` or `Intl.DateTimeFormat(`
// in a user-facing source must pass `uiLocale()` as its locale (or go through
// the helpers below).
import { useLocaleStore } from "@/lib/locale-store"

/**
 * The locale argument for `Intl` / `toLocale*String` calls: `undefined` (the
 * browser default) for English, the chosen locale id otherwise ("he",
 * "pt-BR", …). Every `LocaleId` is a valid BCP-47 tag.
 */
export function uiLocale(): string | undefined {
  const locale = useLocaleStore.getState().locale
  return locale === "en" ? undefined : locale
}

type DateInput = Date | string | number

/** `new Date(value).toLocaleDateString(<ui locale>, options)`. */
export function formatDate(value: DateInput, options?: Intl.DateTimeFormatOptions): string {
  return new Date(value).toLocaleDateString(uiLocale(), options)
}

/** `new Date(value).toLocaleTimeString(<ui locale>, options)`. */
export function formatTime(value: DateInput, options?: Intl.DateTimeFormatOptions): string {
  return new Date(value).toLocaleTimeString(uiLocale(), options)
}

/** `new Date(value).toLocaleString(<ui locale>, options)` — date AND time. */
export function formatDateTime(value: DateInput, options?: Intl.DateTimeFormatOptions): string {
  return new Date(value).toLocaleString(uiLocale(), options)
}

/** `value.toLocaleString(<ui locale>, options)` — thousands separators, digits. */
export function formatNumber(value: number, options?: Intl.NumberFormatOptions): string {
  return value.toLocaleString(uiLocale(), options)
}
