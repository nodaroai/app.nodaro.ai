import type { LocaleId } from "@nodaro/shared/i18n"
import { isOfferedLocale } from "@/lib/i18n/offered-locales"
import { useLocaleStore } from "@/lib/locale-store"

/**
 * The language the consent surfaces are drawn in — what the server records
 * beside a consent as the interface language it was given in.
 *
 * It is the interface language, except where that language's chrome is not
 * translated yet: its dictionary falls back to English key by key, so the
 * words on screen ARE English and the record has to say so. (`uiLocale()` does
 * not serve here: it answers `undefined` for English, and the record wants the
 * id.)
 */
export function consentInterfaceLocale(): LocaleId {
  const { locale } = useLocaleStore.getState()
  return isOfferedLocale(locale) ? locale : "en"
}
