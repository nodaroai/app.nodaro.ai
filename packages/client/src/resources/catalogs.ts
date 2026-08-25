import type { NodaroClient } from "../client.js"

/**
 * Catalog projection types. Mirror `@nodaro/shared`'s `ProjectedCatalog` so the
 * SDK stays dependency-free (same convention as `picker-catalogs.ts`). Tag-free
 * by design — the deferred `CatalogPolicy` never crosses the wire.
 */
export interface ProjectedCatalogOption {
  id: string
  label: string
  description?: string
  category?: string
  /** The prompt fragment this id injects downstream. Present only when detail="full". */
  promptHint?: string
  icon?: string
}
export interface ProjectedCatalogDimension {
  field: string
  label: string
  options: ProjectedCatalogOption[]
}
export interface ProjectedCatalog {
  nodeType: string
  label: string
  catalogId: string
  kind: "single" | "multi"
  valueField?: string
  defaultValue?: string
  categoryOrder?: string[]
  categoryLabels?: Record<string, string>
  detail: "compact" | "full"
  options?: ProjectedCatalogOption[]
  fields?: string[]
  dimensions?: ProjectedCatalogDimension[]
}

export class CatalogsResource {
  constructor(private client: NodaroClient) {}

  /** Every catalog, projected & pack-composed (honors the deployment's
   *  registered vendored packs). Cached publicly 5 min. */
  list(opts: { detail?: "compact" | "full" } = {}): Promise<{ data: ProjectedCatalog[] }> {
    const qs = opts.detail ? `?detail=${opts.detail}` : ""
    return this.client.request("GET", `/v1/catalogs${qs}`)
  }
}
