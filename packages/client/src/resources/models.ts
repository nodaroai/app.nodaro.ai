import type { NodaroClientCore } from "../core.js"

/**
 * The company that made a model. `id` is stable — one id per company, the
 * company's name lowercased and hyphenated (`"google"`, `"black-forest-labs"`)
 * — so an app may key its own assets on it; a newer server can add makers, so
 * handle an id you do not know. `name` is the company's display name.
 */
export interface ModelMaker {
  id: string
  name: string
}

/**
 * Model-catalog types. Mirrors the backend's `GET /v1/models` projection
 * (itself shared with the MCP `list_models` tool) so the SDK stays
 * dependency-free — same convention as `PickerCatalog` / `NodeDescriptor`.
 */
export interface ModelSummary {
  id: string
  label: string
  /** The company that made the model. Not the same as the family it is
   *  grouped under: a few families name a lab or a product line (Tongyi-MAI
   *  and HappyHorse are Alibaba's, Depth Anything is ByteDance's). Absent on
   *  an older server. */
  maker?: ModelMaker
  /** The maker's official mark (an SVG) on this deployment's media CDN, or
   *  null when the deployment does not publish one for this maker — draw a
   *  fallback (the maker's name or initial) then. The address carries its
   *  file's version, so a replaced mark arrives under a new address. Absent
   *  on an older server. */
  logoUrl?: string | null
  description: string
  modes: string[]
  useCases: string[]
  /** Per-variant credit pricing: the credits a run of each variant is
   *  charged, the figure on the node's Run button. Cloud only — editions
   *  without a credit system (community/business) omit the field entirely. */
  pricing?: Array<{ identifier: string; credits: number; note?: string }>
  featured?: boolean
  features?: string[]
  aspectRatios?: string[]
  resolutions?: string[]
  /**
   * The aspect ratios at which the model renders fewer sizes than
   * `resolutions`, each with the sizes it renders there, in the spelling of
   * `resolutions` — e.g. GPT Image 2.5 `{ "27:16": ["1K"], "16:27": ["1K"],
   * "9:8": ["1K"], "8:9": ["1K"] }`. A ratio not listed renders every entry of
   * `resolutions`. Absent when every ratio renders every size (and on an
   * older server). A request for a size its ratio does not render runs, and
   * is charged, at the largest size the ratio renders at or below it; the
   * response's `adjustments` say so. A size menu offers, at the chosen ratio,
   * `resolutionsByAspectRatio?.[ratio] ?? resolutions`.
   */
  resolutionsByAspectRatio?: Record<string, string[]>
  qualities?: string[]
  /** The image background settings the model takes (`auto`, `opaque`, `transparent`). */
  backgrounds?: string[]
  /**
   * The one size a transparent background renders at, where the model limits
   * it (`"1K"` on GPT Image 2.5, and 2.6 Flare and Sunburst). A transparent
   * request at another size runs, and is charged, at this one. Absent when
   * the model sets no such limit (and on an older server).
   */
  transparentResolution?: string
  /**
   * `true` when the model takes a background setting only at
   * `transparentResolution` (GPT Image 2.5): at any other size the setting is
   * not sent, so `opaque` there renders as `auto`. Absent otherwise.
   */
  backgroundOnlyAtTransparentResolution?: true
  /** The files the model writes (`png`, `jpeg`, `webp`, `gif`, `svg`), its default first. Absent: a single format, not a setting. */
  outputFormats?: string[]
  /** The pixel size of every frame of a GIF the model writes (square). Present when `outputFormats` lists `gif`. */
  gifFrameSize?: number
  /** A GIF's frames: a whole number from `min` to `max`, or one of `values` where the model takes only some. */
  gifFrames?: { min: number; max: number; default: number; values?: number[] }
  /** How long each GIF frame shows, in ms: `min` to `max` in steps of `step`. */
  gifFrameDurationMs?: { min: number; max: number; step: number; default: number }
  /** The levels of detail an SVG is drawn at (`standard`, `detailed`, `max`), the default first. Present when `outputFormats` lists `svg`. */
  svgLevels?: string[]
  durations?: number[]
  /** The length (seconds) a request that names no `duration` renders and is
   *  charged at, where the model has one. */
  defaultDuration?: number
  /** `true` when the model accepts `duration: -1`: it picks the length itself. */
  autoDuration?: true
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
  constructor(private client: NodaroClientCore) {}

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
