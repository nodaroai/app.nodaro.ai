import type { NodaroClient } from "../client.js"

/**
 * Model-catalog types. Mirrors the backend's `GET /v1/models` projection
 * (itself shared with the MCP `list_models` tool) so the SDK stays
 * dependency-free — same convention as `PickerCatalog` / `NodeDescriptor`.
 */
export interface ModelSummary {
  id: string
  label: string
  description: string
  modes: string[]
  useCases: string[]
  /** Per-variant credit pricing. Cloud only — editions without a credit
   *  system (community/business) omit the field entirely. */
  pricing?: Array<{ identifier: string; credits: number; note?: string }>
  featured?: boolean
  features?: string[]
  aspectRatios?: string[]
  resolutions?: string[]
  qualities?: string[]
  durations?: number[]
  /** Compact per-model prompting tips (present when a doctrine exists). */
  promptTips?: string[]
  /** TRUE only when a sourced per-family prompt doctrine exists for this
   *  model — gate "vendor doctrine · real rewrite" badges on this and show
   *  a generic label otherwise (never overclaim). */
  doctrineCovered: boolean
}

export interface ModelFamilyGroup {
  family: string
  models: ModelSummary[]
}

export interface ModelsListResult {
  sections: Array<{ kind: "image" | "video" | "audio"; families: ModelFamilyGroup[] }>
  recommendations: Array<{ id: string; title: string; modelIds: string[]; reason?: string } & Record<string, unknown>>
  totalModels: number
}

export interface ListModelsOptions {
  kind?: "image" | "video" | "audio"
  /** Operation filter, e.g. "t2v", "i2v", "t2i". */
  mode?: string
  /** Vendor / lab name, e.g. "Google", "Bytedance". */
  family?: string
  featuredOnly?: boolean
}

export class ModelsResource {
  constructor(private client: NodaroClient) {}

  /** Browse the models available on this instance — capability sheets,
   *  per-variant credit pricing, prompt tips, and the `doctrineCovered`
   *  truth flag. Public endpoint; cached 5 minutes. */
  list(opts: ListModelsOptions = {}): Promise<ModelsListResult> {
    const qs = new URLSearchParams()
    if (opts.kind) qs.set("kind", opts.kind)
    if (opts.mode) qs.set("mode", opts.mode)
    if (opts.family) qs.set("family", opts.family)
    if (opts.featuredOnly) qs.set("featuredOnly", "true")
    const query = qs.toString()
    return this.client.request("GET", `/v1/models${query ? `?${query}` : ""}`)
  }
}
