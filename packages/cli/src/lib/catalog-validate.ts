import type { CatalogSnapshot } from "./catalog-snapshot.js"

export interface SidecarValidateReport {
  catalogId: string
  missing: Array<{ id: string; locale: string }>
  exempted: string[]
  ok: boolean
}
export function validatePackSidecars(
  snapshot: CatalogSnapshot,
  locales: readonly string[],
  exemptLocales: readonly string[],
): SidecarValidateReport {
  const exempt = new Set(exemptLocales)
  const missing: Array<{ id: string; locale: string }> = []
  const exempted: string[] = []
  for (const locale of locales) {
    if (exempt.has(locale)) {
      exempted.push(locale)
      continue
    }
    const map = snapshot.sidecars[locale] ?? {}
    for (const e of snapshot.entries) if (!map[e.id]) missing.push({ id: e.id, locale })
  }
  return { catalogId: snapshot.catalogId, missing, exempted, ok: missing.length === 0 }
}
