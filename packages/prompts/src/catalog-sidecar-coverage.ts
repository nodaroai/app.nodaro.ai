import { NON_EN_LOCALE_IDS, type LocaleId } from "@nodaro/shared"
import type { CatalogPack } from "./catalog-packs.js"

/**
 * Sidecar-localization coverage for a curation pack's added option ids. For
 * every pack-added id, each non-English locale must either have a sidecar entry
 * or be declared exempt (`pack.exemptSidecarLocales`). Exemptions are REPORTED,
 * never treated as failures — a deployment may knowingly ship a pack with only
 * a subset of the 11 locales translated.
 */
export interface SidecarCoverageReport {
  readonly total: number
  readonly missing: ReadonlyArray<{ catalogId: string; locale: LocaleId; id: string }>
  readonly exempted: ReadonlyArray<{ catalogId: string; locale: LocaleId }>
}

function packOptionIds(pack: CatalogPack): string[] {
  if (pack.options) return pack.options.map((o) => o.id)
  if (pack.dimensions) return pack.dimensions.flatMap((d) => d.options.map((o) => o.id))
  if (pack.catalog?.options) return pack.catalog.options.map((o) => o.id)
  if (pack.catalog?.dimensions) return pack.catalog.dimensions.flatMap((d) => d.options.map((o) => o.id))
  return []
}

export function computePackSidecarCoverage(pack: CatalogPack): SidecarCoverageReport {
  const ids = packOptionIds(pack)
  const exempt = new Set<LocaleId>(pack.exemptSidecarLocales ?? [])
  const missing: Array<{ catalogId: string; locale: LocaleId; id: string }> = []
  const exempted: Array<{ catalogId: string; locale: LocaleId }> = []
  for (const locale of NON_EN_LOCALE_IDS) {
    if (exempt.has(locale)) { exempted.push({ catalogId: pack.catalogId, locale }); continue }
    const map = pack.sidecars?.[locale] ?? {}
    for (const id of ids) if (!map[id]) missing.push({ catalogId: pack.catalogId, locale, id })
  }
  return { total: ids.length * NON_EN_LOCALE_IDS.length, missing, exempted }
}
