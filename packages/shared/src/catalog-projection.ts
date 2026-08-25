/**
 * Tag-free, policy-free wire shape for the `GET /v1/catalogs` projection — the
 * server-driven, pack-composed catalog view thin clients render their own
 * pickers from. This is the ONLY catalog-related type in `@nodaro/shared`
 * (Apache): catalog DATA stays in `@nodaro/prompts` (FSL), and the deferred
 * `CatalogPolicy` (tags / deny-by-tag / per-read-kind filter) is deliberately
 * NOT represented here — nothing tag- or policy-shaped may cross this boundary.
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
  /** single only — the node-data field the chosen id writes to. */
  valueField?: string
  defaultValue?: string
  categoryOrder?: readonly string[]
  categoryLabels?: Readonly<Record<string, string>>
  detail: "compact" | "full"
  /** single-dim catalogs. */
  options?: ProjectedCatalogOption[]
  /** multi-dim catalogs. */
  fields?: readonly string[]
  dimensions?: ProjectedCatalogDimension[]
}
