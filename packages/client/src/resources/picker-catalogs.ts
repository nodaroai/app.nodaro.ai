import type { NodaroClient } from "../client.js"

/**
 * Picker-catalog types. Mirrors `@nodaro/shared`'s `ProjectedPickerCatalog` /
 * `PickerCatalogSummary` so the SDK stays dependency-free (same convention as
 * `NodeDescriptor` mirroring node-registry).
 */
export interface PickerOption {
  id: string
  label: string
  description?: string
  category?: string
  /** The prompt fragment this id injects downstream. Present only when detail="full". */
  promptHint?: string
  icon?: string
}

export interface PickerDimension {
  field: string
  label: string
  options: PickerOption[]
}

export interface PickerCatalog {
  nodeType: string
  label: string
  catalogId: string
  kind: "single" | "multi"
  /** single only — the node-data field the chosen id writes to. */
  valueField?: string
  defaultValue?: string
  categoryOrder?: string[]
  categoryLabels?: Record<string, string>
  /** single-dim catalogs. */
  options?: PickerOption[]
  /** multi-dim catalogs. */
  fields?: string[]
  dimensions?: PickerDimension[]
  detail?: "compact" | "full"
}

export interface PickerCatalogSummary {
  nodeType: string
  label: string
  catalogId: string
  kind: "single" | "multi"
  valueField?: string
  fields?: string[]
  optionCount: number
}

export interface GetPickerCatalogOptions {
  /** "compact" (default) = id, label, category, icon; "full" additionally includes description + promptHint. */
  detail?: "compact" | "full"
  /** single-dim: filter to one category. */
  category?: string
  /** multi-dim: only this dimension field. */
  field?: string
}

export class PickerCatalogsResource {
  constructor(private client: NodaroClient) {}

  /** List every parameter-picker node type + its option count. Cached publicly 5 min. */
  list(): Promise<{ data: PickerCatalogSummary[] }> {
    return this.client.request("GET", "/v1/picker-catalogs")
  }

  /** Get one picker's catalog of valid values. */
  get(nodeType: string, opts: GetPickerCatalogOptions = {}): Promise<{ data: PickerCatalog }> {
    const qs = new URLSearchParams()
    if (opts.detail) qs.set("detail", opts.detail)
    if (opts.category) qs.set("category", opts.category)
    if (opts.field) qs.set("field", opts.field)
    const query = qs.toString()
    return this.client.request(
      "GET",
      `/v1/picker-catalogs/${encodeURIComponent(nodeType)}${query ? `?${query}` : ""}`,
    )
  }
}
