import { z } from "zod"
import { LANGUAGES, type LocaleId } from "@nodaro/shared/i18n"

/** Every interface language the platform ships — the ids a client may name. */
const SHIPPED_LOCALE_IDS = LANGUAGES.map((language) => language.id) as [LocaleId, ...LocaleId[]]

/**
 * The interface language a consent was given in, as a request-body field.
 *
 * Lenient by contract, like the fingerprints and the `sourceApp` slug beside
 * it: an absent, malformed or unknown value reads as "the client did not say"
 * (`undefined`) and is never answered with a 400. An older client, which does
 * not send the field, keeps working, and a newer one cannot lose its user's
 * "yes" over a language id we do not ship.
 */
export const consentLocaleField = z.enum(SHIPPED_LOCALE_IDS).optional().catch(undefined)
