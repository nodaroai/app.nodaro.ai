/**
 * The `style` picker catalog's labels in a platform language, on the server:
 * the same locale sidecars and resolver every client app uses
 * (`@nodaro/shared/i18n`), loaded through the package's own loaders since a
 * Node process has no bundler glob. English is the catalog's own label; a
 * style the sidecar does not name falls back to a catalog pack's sidecar,
 * then to English.
 */
import {
  LANGUAGES,
  STYLE_SIDECAR_LOADERS,
  ensureLocaleCatalogLoaded,
  registerSidecarLoaders,
  resolveLabel,
  type LocaleId,
} from "@nodaro/shared/i18n"

// At module load, before the first read: a sidecar asked for with no loader
// registered is remembered as missing.
registerSidecarLoaders(STYLE_SIDECAR_LOADERS)

/** The platform language a `?locale=` names (its exact id, or the same id in another letter case); English for anything else. */
export function platformLocaleOf(raw: unknown): LocaleId {
  if (typeof raw !== "string") return "en"
  const asked = raw.trim().toLowerCase()
  return LANGUAGES.find((l) => l.id.toLowerCase() === asked)?.id ?? "en"
}

/** A labeller of `style` catalog options in `locale`: `(id, englishLabel) => label`. */
export async function styleLabelsIn(locale: LocaleId): Promise<(id: string, englishLabel: string) => string> {
  await ensureLocaleCatalogLoaded("style", locale)
  return (id, englishLabel) => resolveLabel("style", id, englishLabel, locale)
}
