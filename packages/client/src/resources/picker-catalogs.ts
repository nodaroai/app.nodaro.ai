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
  /**
   * Short professional term injected by compact hint mode; `label` is for
   * display. Present at BOTH detail levels — a thin client renders `label`
   * and injects `term`. Empty for a no-op ("auto"/"none") entry that injects
   * nothing.
   */
  term?: string
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
  /** "compact" (default) = id, label, category, term, icon; "full" additionally includes description + promptHint. */
  detail?: "compact" | "full"
  /** single-dim: filter to one category. */
  category?: string
  /** multi-dim: only this dimension field. */
  field?: string
}

/** Input for `analyzeText` (POST /v1/text-to-picker). */
export interface TextToPickerParams {
  /** Free-text scene/shot description to analyze. */
  text: string
  /** Picker node types to fill. Omit for ALL analyzable pickers (the server
   *  fans the analysis out per family and merges). */
  targetPickers?: string[]
  /** Extra guidance appended to the analyzer system prompt. */
  instructions?: string
  /** Originating client app slug (e.g. "cine") — attribution only. */
  origin?: string
  llmModel?: string
  reasoningEffort?: string
}

export interface TextToPickerResult {
  jobId: string
  /** pickerType → dimension → chosen catalog id(s) — same shape as
   *  describe-to-picker; hydrate pickers from it verbatim. */
  pickerJson: Record<string, Record<string, string | string[]>>
  /** Catalog-coverage feedback (attributes the text described that no
   *  catalog id represents well). Surface as "we couldn't infer X". */
  gaps?: {
    missingItems: Array<{ picker: string; dimension: string; observed: string }>
    missingCategories: Array<{ picker: string; suggestedDimension: string; observed: string }>
  }
}

export class PickerCatalogsResource {
  constructor(private client: NodaroClient) {}

  /** List every parameter-picker node type + its option count. Cached publicly 5 min. */
  list(): Promise<{ data: PickerCatalogSummary[] }> {
    return this.client.request("GET", "/v1/picker-catalogs")
  }

  /** Fill pickers from a free-text description (Cine "AI Fill"): returns the
   *  same pickerJson shape as describe-to-picker, keyed by picker node type. */
  analyzeText(params: TextToPickerParams): Promise<TextToPickerResult> {
    return this.client.request("POST", "/v1/text-to-picker", { body: params })
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
