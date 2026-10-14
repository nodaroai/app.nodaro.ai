/**
 * `@nodaro/shared/i18n` — Locale ids, catalog sidecars and their loaders.
 *
 * One of the package's subpath entries (see `src/index.ts`). The root
 * re-exports every entry, so each name here is also importable from
 * `@nodaro/shared`.
 */
// Sound parameter-node dimensions (music + voice pickers + backend hints)






// i18n
export {
  LANGUAGES,
  getLocaleDirection,
  ensureLocaleCatalogLoaded,
  registerSidecarLoaders,
  registerCatalogSidecars,
  resetCatalogSidecars,
  resolveLabel,
  resolveDescription,
  entryMatchesQuery,
  type LocaleId,
  type LocaleDirection,
  type I18nCatalogId,
  type SidecarLoader,
} from "../i18n/index.js"
export { NON_EN_LOCALE_IDS, type LocaleCatalogMap } from "../i18n/types.js"
