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
  /**
   * Short professional term injected by compact hint mode; `label` is for
   * display. Present at BOTH detail levels — a thin client renders `label`
   * and injects `term`. Empty for a no-op ("auto"/"none") entry that injects
   * nothing.
   */
  term?: string
  icon?: string
  /**
   * Absolute URL of the option's picture — a photo, 3D emoji, flag or (Nodaro
   * Cloud only) rendered look preview — on the installation's own host, or the
   * Nodaro CDN for look previews. Absent when the option has no picture. Use it
   * as given: file names carry a content hash, so it can be cached for good.
   */
  imageUrl?: string
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
  /** person and styling: the topics their settings are grouped under, in order, each with its picture. */
  sections?: ProjectedCatalogSection[]
}

/** A topic a multi-dim catalog's settings are grouped under in the editor (person, styling). */
export interface ProjectedCatalogSection {
  label: string
  fields: string[]
  imageUrl?: string
}

/**
 * `GET /v1/catalogs`. `data` is present only when the deployment registered
 * catalog packs (`curated: true`); with none the catalogs are the bundled
 * ones — read them per picker with `client.pickerCatalogs.get(nodeType)`.
 */
export interface CatalogsListResponse {
  curated: boolean
  packs: number
  version: number
  data?: ProjectedCatalog[]
}

export class CatalogsResource {
  constructor(private client: NodaroClient) {}

  /** Every catalog, projected & pack-composed (honors the deployment's
   *  registered vendored packs). Cached publicly 5 min. `data` is absent
   *  when the deployment registered no packs (`curated: false`). */
  list(opts: { detail?: "compact" | "full" } = {}): Promise<CatalogsListResponse> {
    const qs = opts.detail ? `?detail=${opts.detail}` : ""
    return this.client.request("GET", `/v1/catalogs${qs}`)
  }
}
