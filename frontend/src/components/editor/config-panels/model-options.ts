import { hasCredits } from "@/lib/edition"
import { creditUnits, creditUnitLabel, formatCreditUnits } from "@/lib/credit-units"
import { isModelUnavailable } from "@/lib/surface-availability"
import { isVariablePricedModel, type CreditRange } from "@/lib/model-credit-range"
import { VIDEO_DURATION_AUTO, aspectRatioOptionsByKind, resolutionOptionsByKind, qualityOptionsByKind, backgroundOptionsByKind, outputFormatOptionsByKind, svgLevelOptionsByKind, normalizeModelInput, TRANSPARENT_OUTPUT_FORMATS, getModel, durationsByMode, modelsWithFeature, isFlux2Model, resolutionsAtAspectRatio, type LabeledOption } from "@nodaro/shared/model-catalog"
import {
  supportsAutoVideoDuration,
  type ImageToVideoProvider,
  type SunoModel,
} from "@nodaro/shared/models"
import { STYLES, stylesForMedia } from "@nodaro/prompts/pickers"
import { curateEntries } from "@nodaro/prompts/picker-catalogs"
import {
  menuRowModel,
  IMAGE_GEN_MODELS,
  IMAGE_I2I_MODELS,
  MODIFY_IMAGE_MODELS,
  UPSCALE_IMAGE_MODELS,
  VIDEO_I2V_MODELS,
  VIDEO_T2V_MODELS,
  VIDEO_GEN_MODELS,
  GVP_PROVIDERS,
  EVP_PROVIDERS,
  VIDEO_V2V_MODELS,
  EXTEND_VIDEO_MODELS,
  LIP_SYNC_MODELS,
  TTS_MODELS,
  DIALOGUE_MODELS,
  MOTION_TRANSFER_MODELS,
  VIDEO_DEPTH_MODELS,
} from "@nodaro/render-rules"
export { MODELS_WITH_REFERENCE_IMAGE_SUPPORT, REF_IMAGE_MAX_LIMITS, DEFAULT_REF_IMAGE_MAX, NATIVE_NEGATIVE_PROMPT_MODELS, I2I_STRENGTH_SUPPORT, I2I_MASK_SUPPORT, IMAGE_MASK_MODE, SEED_SUPPORT, RENDERING_SPEED_SUPPORT, GUIDANCE_SCALE_SUPPORT } from "@nodaro/shared/models"
export type { ImageMaskMode } from "@nodaro/shared/models"

/**
 * Drop models the deployment does not offer (B1 + B5). Applied where a config
 * panel reads a `*_MODELS` registry, so an unavailable provider never renders
 * in a dropdown — the backend also hides it from discovery and rejects it at
 * run. Single source: never re-derive availability per dropdown. Reads the
 * fetched EFFECTIVE set (surface-availability.ts: profile factory + admin
 * override + the admin's model switch) with the static profile deny as the
 * pre-fetch fallback.
 *
 * `menu` names whose menu it is (`ModelMenuOwner`): a row is judged as the
 * model it makes that node run, never by its raw value.
 *
 * `keep` is the node's STORED model: a saved node that holds a model the
 * deployment hides keeps it listed (and so labelled on the trigger), never
 * silently moved to another model — the run refuses it with its own message
 * (the same rule the quick strips apply, node-quick-configs.tsx).
 *
 * A component that renders the result subscribes through `useOfferedModels`
 * (use-offered-models.ts), so the menu follows an admin's switch; a plain
 * call is for a memo/effect that re-runs on its own.
 */
export function withoutDeniedModels<T extends { value: string }>(models: readonly T[], menu: ModelMenuOwner, keep?: string): readonly T[] {
  return models.filter((m) => m.value === keep || !isMenuRowWithheld(menu, m.value))
}

/**
 * Whose model menu a list of rows is: the node type, the data field the menu
 * writes (`provider` unless said) and, where the model a row runs depends on
 * it, the node's data. Every menu names its owner, so a row is judged as the
 * model it makes the node run.
 */
export interface ModelMenuOwner {
  readonly nodeType: string
  readonly field?: string
  readonly data?: Readonly<Record<string, unknown>>
}

/**
 * Whether a menu row is a model this deployment withholds, judged as the model
 * the row makes the node RUN (`menuRowModel`, `@nodaro/render-rules` — the rule
 * the server's checks apply): Generate Music's `minimax` is the MiniMax music
 * engine and no catalog model, never the MiniMax video model; Motion
 * Transfer's `kling` is the catalog's `motion-transfer`. A row that runs no
 * catalog model is never withheld.
 */
export function isMenuRowWithheld(menu: ModelMenuOwner, value: string): boolean {
  const model = menuRowModel(menu.nodeType, menu.field ?? "provider", value, menu.data ?? {})
  return model !== null && isModelUnavailable(model)
}

/**
 * The model menus' rows, in the order the menus render them. They live in
 * `@nodaro/render-rules` (`model-menus.ts`) because the server starts a node
 * it creates on the first row a menu offers, exactly as the editor does, so the
 * order is one list (decided 2026-11-10). Re-exported here, where every panel
 * and strip reads them.
 */
export {
  IMAGE_GEN_MODELS,
  IMAGE_I2I_MODELS,
  MODIFY_IMAGE_MODELS,
  UPSCALE_IMAGE_MODELS,
  VIDEO_I2V_MODELS,
  VIDEO_T2V_MODELS,
  VIDEO_GEN_MODELS,
  GVP_PROVIDERS,
  EVP_PROVIDERS,
  VIDEO_V2V_MODELS,
  EXTEND_VIDEO_MODELS,
  LIP_SYNC_MODELS,
  TTS_MODELS,
  DIALOGUE_MODELS,
  MOTION_TRANSFER_MODELS,
  VIDEO_DEPTH_MODELS,
} from "@nodaro/render-rules"

export const IMAGE_GEN_MODEL_IDS = IMAGE_GEN_MODELS.map(m => m.value)

export const IMAGE_EDIT_MODELS = [
  { value: "nano-banana-edit", label: "Nano Banana Edit", desc: "Context-aware image editing with prompt" },
  { value: "recraft-remove-bg", label: "Recraft Remove BG", desc: "Remove background, transparent PNG output" },
  { value: "recraft-upscale", label: "Recraft Upscale", desc: "AI-powered upscaling and enhancement" },
  { value: "topaz-image-upscale", label: "Topaz Upscale", desc: "Advanced upscaling with configurable factor" },
  // An own-label model: its name is the catalog's (`getModel(...).label`), the one every surface shows.
  { value: "nodaro-image-upscale", label: getModel("nodaro-image-upscale")?.label ?? "nodaro-image-upscale", desc: "Upscale up to 8x, lettering kept exactly as written" },
] as const

export const V2V_DURATION_OPTIONS = [
  { value: "5", label: "5 seconds" },
  { value: "10", label: "10 seconds" },
] as const

export const V2V_RESOLUTION_OPTIONS = [
  { value: "720p", label: "720p" },
  { value: "1080p", label: "1080p" },
] as const

export const V2V_ALEPH_ASPECT_RATIOS = [
  { value: "16:9", label: "16:9" },
  { value: "9:16", label: "9:16" },
  { value: "4:3", label: "4:3" },
  { value: "3:4", label: "3:4" },
  { value: "1:1", label: "1:1" },
  { value: "21:9", label: "21:9" },
] as const

/** Formats the credit badge shown on a model dropdown row. A variable-priced
 *  model renders "min-max CR" — the cheapest and priciest variant at the price
 *  a run is charged (`useModelCreditRange`); a fixed-price model renders "N CR";
 *  zero/unknown cost (e.g. community edition where `useModelCredits` returns 0)
 *  renders no badge. Shared by `ModelSelectOption` (Radix Select rows) and
 *  `ModelSearchSelect`'s cmdk rows so the rule lives in one place.
 *  `credits` and `range` are the resolved hook values — passed in because this
 *  is a plain function, not a component. */
export function formatCreditBadge(value: string, credits: number, range: CreditRange | undefined): string | undefined {
  // Editions without credits must show no price at all — FIRST, before any
  // branch that could quote one (found in the 2026-08-13 community grind).
  if (!hasCredits()) return undefined
  // A model priced per setting quotes its charged range, and nothing until the
  // range has loaded: its default variant's price alone would read as the
  // price. The range used to come from the catalog's BASE prices, so the
  // picker quoted below what the Run button charged.
  if (isVariablePricedModel(value)) {
    return range ? `${creditUnits(range.min)}-${creditUnits(range.max)} ${creditUnitLabel()}` : undefined
  }
  // credit-gated: unreachable without credits — the guard above returns first.
  if (credits > 0) return formatCreditUnits(credits)
  return undefined
}

/** Badge for per-second-billed providers (per-second lip-sync). Their bare
 *  credit id is the 5-min worst-case ceiling, which reads as an alarming flat
 *  price in a picker. Show the per-second rate instead, derived from the 15s
 *  bucket (÷15) so it tracks the DB pricing with no hardcoded rates. Pass the
 *  resolved credits for the provider's `:15s` identifier. */
export function formatPerSecondCreditBadge(credits15s: number): string | undefined {
  // Same edition rule as formatCreditBadge above: no credit system, no price.
  // Community happened to hide this badge only because the model-cost fetch
  // returns nothing there — an accident, not a guarantee (#645).
  if (!hasCredits()) return undefined
  if (!(credits15s > 0)) return undefined
  // credit-gated: unreachable without credits — the guard above returns first.
  return `≈${creditUnits(Math.max(1, Math.round(credits15s / 15)))} ${creditUnitLabel()}/s`
}

// =============================================================================
// IMAGE MODEL ASPECT RATIOS — derived from MODEL_CATALOG (single source of
// truth). When you add a new model, update its `aspectRatios` in
// `packages/shared/src/model-catalog.ts` and both this map AND the MCP
// `list_models` output update automatically.
// =============================================================================
const DEFAULT_RATIOS: readonly LabeledOption[] = [
  { value: "1:1", label: "1:1 (Square)" },
  { value: "16:9", label: "16:9 (Landscape)" },
  { value: "9:16", label: "9:16 (Portrait)" },
  { value: "4:3", label: "4:3" },
] as const

export const IMAGE_ASPECT_RATIOS: Record<string, readonly LabeledOption[]> =
  aspectRatioOptionsByKind("image")

export function getAspectRatiosForModel(provider: string): readonly LabeledOption[] {
  return IMAGE_ASPECT_RATIOS[provider] ?? DEFAULT_RATIOS
}

/** The Auto tile on a node whose "auto" keeps a photo's shape — user-facing
 *  copy; the qualifier is translated in each locale's `optionQualifier` table. */
export const SOURCE_PHOTO_AUTO_LABEL = "Auto (match the photo)"

/**
 * `options` with the photo Auto tile first (and any catalog "auto" folded into
 * it). For the image nodes whose "auto" keeps a photo's shape — natively on a
 * model that lists it, else the platform picks the model's supported ratio
 * nearest the photo (`normalizeModelInput`'s source size): Modify Image (its
 * source photo) and Generate Image (a wired photo; with none, "auto" is the
 * model's default shape). That makes Auto a real choice on every model there.
 *
 * The provider fail-safes still snap any OTHER stale ratio to the first entry
 * of the list passed in (the catalog's own list), never to this Auto tile.
 */
export function withPhotoAuto(options: readonly LabeledOption[]): readonly LabeledOption[] {
  return [{ value: "auto", label: SOURCE_PHOTO_AUTO_LABEL }, ...options.filter((o) => o.value !== "auto")]
}

/** A model's ratio tiles on a photo-Auto node: `withPhotoAuto` over the catalog list
 *  (`getAspectRatiosForModel`), which stays the list a stale ratio snaps to. */
export function getSourcePhotoAspectRatios(provider: string): readonly LabeledOption[] {
  return withPhotoAuto(getAspectRatiosForModel(provider))
}

// =============================================================================
// VIDEO / COMPOSITION ASPECT RATIO PRESETS
// =============================================================================
export const VIDEO_RATIOS = [
  { value: "16:9", label: "16:9 (Landscape)" },
  { value: "9:16", label: "9:16 (Portrait)" },
  { value: "1:1", label: "1:1 (Square)" },
] as const

export const COMPOSITION_RATIOS = [
  { value: "16:9", label: "16:9 (Landscape)" },
  { value: "9:16", label: "9:16 (Portrait)" },
  { value: "1:1", label: "1:1 (Square)" },
  { value: "4:5", label: "4:5 (Social)" },
] as const

/**
 * 3D Render Pro's ratios — COMPOSITION_RATIOS plus ultra-wide.
 *
 * Its own list rather than a widened shared one: 21:9 is a Pro capability (the
 * scene contract's supported 1680x720), and adding it to the set every
 * composer node renders would offer it on nodes whose routes refuse it.
 */
export const PRO3D_ASPECT_RATIOS = [
  ...COMPOSITION_RATIOS,
  { value: "21:9", label: "21:9 (Ultra-wide)" },
] as const

/**
 * Aspect ratios offered by the Image Collage node — a richer set than
 * COMPOSITION_RATIOS (square + four landscape + four portrait). The values are
 * arbitrary "W:H"; the backend parses them generically (no enum), so adding one
 * here needs no route change. `AspectRatioSelector` renders each as a
 * proportional SVG shape. Ordered square → widening landscape → deepening
 * portrait so the picker grid reads left-to-right.
 */
export const COLLAGE_ASPECT_RATIOS = [
  { value: "1:1", label: "1:1 (Square)" },
  { value: "4:3", label: "4:3 (Standard)" },
  { value: "3:2", label: "3:2 (Photo)" },
  { value: "16:9", label: "16:9 (Wide)" },
  { value: "21:9", label: "21:9 (Cinema)" },
  { value: "4:5", label: "4:5 (Social)" },
  { value: "3:4", label: "3:4 (Portrait)" },
  { value: "2:3", label: "2:3 (Portrait)" },
  { value: "9:16", label: "9:16 (Tall)" },
] as const

// Image resolutions — derived from MODEL_CATALOG. Add new entries to the
// catalog's `resolutions` field, not here.
export const IMAGE_RESOLUTION_OPTIONS: Record<string, readonly LabeledOption[]> =
  resolutionOptionsByKind("image")

// =============================================================================
// VIDEO MODEL RESOLUTIONS — derived from MODEL_CATALOG.
// Providers with no entry have no resolution lever — `data.resolution` should
// be cleared when the user lands on them so backend Zod doesn't see stale
// values. Hailuo's "1080P (6s max)" decoration lives on the catalog entry's
// `valueLabels` field. Case-sensitive: hailuo uses uppercase ("768P",
// "1080P"), everything else is lowercase ("720p", "1080p").
// =============================================================================
export const VIDEO_RESOLUTION_OPTIONS: Record<string, readonly LabeledOption[]> = { ...resolutionOptionsByKind("video") }

export function getVideoResolutionOptions(
  provider: string,
): readonly LabeledOption[] | undefined {
  return VIDEO_RESOLUTION_OPTIONS[provider]
}

// =============================================================================
// VIDEO MODEL DURATIONS — derived from MODEL_CATALOG via durationsByMode().
// Merges i2v + t2v durations per provider so the generate-video node can
// expose the full union (a provider that supports both modes uses the same
// duration list under one id). Labels are "Ns" suffix; the catalog stores
// raw numbers. Single source of truth — add a new provider's durations to
// `packages/shared/src/model-catalog.ts` and both the dropdown and the
// audit tooling pick it up.
// =============================================================================
const _I2V_DURATIONS = durationsByMode("i2v")
const _T2V_DURATIONS = durationsByMode("t2v")

export const VIDEO_DURATION_OPTIONS: Record<string, ReadonlyArray<{ value: number; label: string }>> =
  (() => {
    const ids = new Set<string>([
      ...Object.keys(_I2V_DURATIONS),
      ...Object.keys(_T2V_DURATIONS),
    ])
    const out: Record<string, ReadonlyArray<{ value: number; label: string }>> = {}
    for (const id of ids) {
      const merged = new Set<number>([
        ...(_I2V_DURATIONS[id] ?? []),
        ...(_T2V_DURATIONS[id] ?? []),
      ])
      const sorted = Array.from(merged).sort((a, b) => a - b)
      if (sorted.length > 0) {
        const options = sorted.map((n) => ({ value: n, label: `${n}s` }))
        // Auto rides LAST so `options[0]` stays a real length for every
        // "first option" default; it is a catalog capability, so a new model
        // that declares `autoDuration` gets the option everywhere for free.
        out[id] = supportsAutoVideoDuration(id)
          ? [...options, { value: VIDEO_DURATION_AUTO, label: "Auto" }]
          : options
      }
    }
    // Grok t2v alias — KIE_T2V_DURATIONS keys grok image-mode under "grok" but
    // MODEL_CATALOG only tracks the i2v durations under "grok-i2v". Mirror the
    // alias here so the legacy TextToVideoConfig snap-stale effect doesn't
    // silently skip when reading VIDEO_DURATION_OPTIONS["grok"].
    if (!out["grok"] && out["grok-i2v"]) {
      out["grok"] = out["grok-i2v"]
    }
    return out
  })()

/** Duration `{value, label}` options for a video model. Returns `[]` for
 *  providers without a duration lever (fixed-duration models that derive
 *  duration from input, like Wan V2V). */
export function getDurationsForVideoModel(
  provider: string,
): ReadonlyArray<{ value: number; label: string }> {
  return VIDEO_DURATION_OPTIONS[provider] ?? []
}

// =============================================================================
// VIDEO MODEL ASPECT RATIOS — derived from MODEL_CATALOG. Providers without
// an `aspectRatios` entry fall through to the generic VIDEO_RATIOS default
// (16:9 / 9:16 / 1:1) used by the legacy video-configs panels.
// =============================================================================
const _VIDEO_ASPECT_BY_PROVIDER: Record<string, readonly LabeledOption[]> = { ...aspectRatioOptionsByKind("video") }

/**
 * Per-provider VIDEO_ASPECT_RATIOS export — re-exposes the per-provider map
 * for callers that need direct access (provider-aware dropdowns, audit
 * tooling). Use `getAspectRatiosForVideoModel(provider)` for the
 * fallback-aware accessor.
 */
export const VIDEO_ASPECT_RATIOS: Record<string, readonly LabeledOption[]> = _VIDEO_ASPECT_BY_PROVIDER

/**
 * Per-provider VIDEO_FPS_OPTIONS — most providers in MODEL_CATALOG don't yet
 * expose an fps lever (the catalog doesn't track it), so this map currently
 * only contains LTX 2.3 entries. Add other providers here as fps becomes a
 * user-facing setting on their config panels. The "Fast >10s implies
 * 24-25fps only" constraint is enforced by the config panel's snap-stale
 * useEffect, not by this list.
 */
export const VIDEO_FPS_OPTIONS: Record<string, ReadonlyArray<{ value: number; label: string }>> = {
  "ltx-2.3-pro": [24, 25, 48, 50].map((n) => ({ value: n, label: `${n} fps` })),
  "ltx-2.3-fast": [24, 25, 48, 50].map((n) => ({ value: n, label: `${n} fps` })),
}

/** Per-provider aspect ratio options for video models. Falls back to the
 *  generic VIDEO_RATIOS triplet (16:9 / 9:16 / 1:1) when the catalog entry
 *  doesn't declare an `aspectRatios` field — matches the legacy
 *  video-configs behavior. */
/**
 * Generate Video Pro duration cap fallback (seconds) — mirrors the backend
 * default (`GENERATE_VIDEO_PRO_MAX_DURATION` env var,
 * `ee/billing/generate-video-pro-credits.ts`). Lives HERE (not in
 * video-configs.tsx, which re-exports it for back-compat) so the node quick
 * strip can import it without pulling the whole config-panel module graph
 * into the canvas bundle.
 */
export const GENERATE_VIDEO_PRO_MAX_DURATION_FALLBACK = 120

export function getAspectRatiosForVideoModel(
  provider: string,
): readonly LabeledOption[] {
  return _VIDEO_ASPECT_BY_PROVIDER[provider] ?? (VIDEO_RATIOS as readonly LabeledOption[])
}

/** Builds the capability tooltip for a video model — Durations, Resolutions,
 *  Aspect ratios on three short lines. Used by the model dropdowns in the
 *  generate-video config panel + quick toolbar so hover surfaces what each
 *  model supports without duplicating the marketing description that already
 *  renders inline. Returns `undefined` when no capability info is available
 *  (caller falls back to the marketing description). */
export function getVideoModelCapabilitiesTooltip(provider: string): string | undefined {
  const durations = getDurationsForVideoModel(provider)
  const resolutions = VIDEO_RESOLUTION_OPTIONS[provider]
  const ratios = getAspectRatiosForVideoModel(provider)
  const parts: string[] = []
  if (durations.length > 0) {
    parts.push(`Durations: ${durations.map((d) => d.label).join(", ")}`)
  }
  if (resolutions && resolutions.length > 0) {
    parts.push(`Resolutions: ${resolutions.map((r) => r.value).join(", ")}`)
  }
  if (ratios.length > 0) {
    parts.push(`Aspect ratios: ${ratios.map((r) => r.value).join(", ")}`)
  }
  return parts.length > 0 ? parts.join("\n") : undefined
}

// Image qualities — derived from MODEL_CATALOG.
export const IMAGE_QUALITY_OPTIONS: Record<string, readonly LabeledOption[]> =
  qualityOptionsByKind("image")

// Image backgrounds — derived from MODEL_CATALOG. No entry: no such setting.
export const IMAGE_BACKGROUND_OPTIONS: Record<string, readonly LabeledOption[]> =
  backgroundOptionsByKind("image")

/** The quality a run renders at when none is set, where it is not the first listed. */
export function defaultQualityFor(provider: string): string | undefined {
  return getModel(provider)?.defaultQuality
}

/** Where several models share one list: the first option, but never Auto, which is only chosen on purpose. */
export function firstFixedQuality(options: readonly LabeledOption[] | undefined): string | undefined {
  return (options?.find((o) => o.value !== "auto") ?? options?.[0])?.value
}

/** The one size this model renders a transparent background at, where it is limited. */
export function transparentResolutionFor(provider: string): string | undefined {
  return getModel(provider)?.transparentResolution
}

// Image output formats — derived from MODEL_CATALOG, the model's default
// first. No entry: the model writes one format, not a setting.
export const IMAGE_OUTPUT_FORMAT_OPTIONS: Record<string, readonly LabeledOption[]> =
  outputFormatOptionsByKind("image")

// An SVG's levels of detail, per model that writes SVG — the first the default.
export const IMAGE_SVG_LEVEL_OPTIONS: Record<string, readonly LabeledOption[]> =
  svgLevelOptionsByKind("image")

/** How many frames a GIF of this model can have (`values`: only those), where it writes GIF. */
export function gifFramesFor(provider: string): { readonly min: number; readonly max: number; readonly default: number; readonly values?: readonly number[] } | undefined {
  return getModel(provider)?.gifFrames
}

/** How long each frame of this model's GIF shows (ms), where it writes GIF. */
export function gifFrameDurationFor(provider: string): { readonly min: number; readonly max: number; readonly step: number; readonly default: number } | undefined {
  return getModel(provider)?.gifFrameDurationMs
}

/**
 * The file a node writes on `provider`: its `outputFormat` when the model
 * writes it, else the model's default (its first). Undefined when the model has
 * no format setting (it writes its one format).
 */
export function outputFormatOf(provider: string, outputFormat: unknown): string | undefined {
  const options = IMAGE_OUTPUT_FORMAT_OPTIONS[provider]
  if (!options) return undefined
  return options.find((o) => o.value === outputFormat)?.value ?? options[0]?.value
}

/**
 * Whether the node writes a GIF on `provider`. A GIF is square
 * (`IMAGE_GIF_FRAME_SIZE` a frame): its aspect ratio and size do not apply, so
 * the panels and the run strip hide both while it is chosen, keeping what the
 * node stores for another format.
 */
export function writesGif(provider: string | undefined, outputFormat: unknown): boolean {
  return provider !== undefined && outputFormatOf(provider, outputFormat) === "gif"
}

/** Whether a file of this format keeps a transparent background (no format named: the model's own, which does). */
export function keepsTransparentBackground(format: string | undefined): boolean {
  return format === undefined || TRANSPARENT_OUTPUT_FORMATS.includes(format)
}

/** The output-format levers of an image node, and the background they constrain. */
export interface ImageFormatNodeLevers {
  outputFormat?: string
  gifFrames?: number
  gifFrameDurationMs?: number
  svgLevel?: string
  background?: string
}

/**
 * The config panels' fail-safe for the output format (Provider Enum Sync step
 * 12b), as a patch for `data` — the node's data as the panel's other snaps
 * left it. `provider` is the node's one model; undefined when several are
 * selected, where no format is offered.
 *  - a format the model does not write is cleared (the model's default runs);
 *  - a GIF's frames and speed, and an SVG's level, are kept on the node while
 *    another format is chosen (the run ignores them), and moved into the
 *    model's range only while that format is the one written — through the
 *    catalog's own snap, so Economy's 4 / 9 / 16 frames are never re-derived;
 *  - a transparent background becomes `auto` with a format that cannot keep it.
 * Never writes a lever the node does not hold.
 */
export function imageFormatFailSafe(provider: string | undefined, data: Readonly<ImageFormatNodeLevers>): Partial<ImageFormatNodeLevers> {
  const updates: Partial<ImageFormatNodeLevers> = {}
  const options = provider ? IMAGE_OUTPUT_FORMAT_OPTIONS[provider] : undefined
  let format = data.outputFormat
  if (format !== undefined && !options?.some((o) => o.value === format)) {
    updates.outputFormat = undefined
    format = undefined
  }
  if (provider && format === "gif") {
    const frames = typeof data.gifFrames === "number" ? data.gifFrames : undefined
    const ms = typeof data.gifFrameDurationMs === "number" ? data.gifFrameDurationMs : undefined
    if (frames !== undefined || ms !== undefined) {
      const snapped = normalizeModelInput(provider, { outputFormat: "gif", gifFrames: frames, gifFrameDurationMs: ms })
      if (frames !== undefined && snapped.gifFrames !== frames) updates.gifFrames = snapped.gifFrames
      if (ms !== undefined && snapped.gifFrameDurationMs !== ms) updates.gifFrameDurationMs = snapped.gifFrameDurationMs
    }
  }
  if (provider && format === "svg" && typeof data.svgLevel === "string") {
    const level = normalizeModelInput(provider, { outputFormat: "svg", svgLevel: data.svgLevel }).svgLevel
    if (level !== data.svgLevel) updates.svgLevel = level
  }
  if (data.background === "transparent" && !keepsTransparentBackground(format)) {
    updates.background = "auto"
  }
  return updates
}

/**
 * An image model's size options at a ratio: only the sizes it renders there
 * (the catalog's `resolutionsByAspectRatio`; GPT Image 2.5 draws 27:16,
 * 16:27, 9:8 and 8:9 at 1K only). The model's whole list at any other ratio.
 */
export function imageResolutionOptionsAt(provider: string, aspectRatio: string | undefined): readonly LabeledOption[] | undefined {
  const options = IMAGE_RESOLUTION_OPTIONS[provider]
  const offered = resolutionsAtAspectRatio(provider, aspectRatio)
  return options && offered ? options.filter((o) => offered.includes(o.value)) : options
}

/**
 * The size a model renders when none is set, where its catalog entry declares
 * one because it is not the first listed (`defaultResolution`: MiniMax H3
 * Image renders 2K, not 1K). What a panel, the quick strip and a published
 * app show and write for an unset size. Undefined for every other model, which
 * keeps showing its first listed size.
 */
export function declaredDefaultResolution(provider: string): string | undefined {
  return getModel(provider)?.defaultResolution
}

/**
 * Default resolution when no (or a stale) resolution is set on the node: the
 * catalog's declared default first (`declaredDefaultResolution`), else the
 * Flux 2 family's. Flux 2 uses ascending MP options ("0.5 MP" … "4 MP"), so
 * snapping to options[0] would wrongly land on 0.5 MP. Returns undefined for
 * every other provider (let the caller use the existing options[0] logic).
 */
export function defaultResolutionFor(provider: string): string | undefined {
  const declared = declaredDefaultResolution(provider)
  if (declared) return declared
  if (!isFlux2Model(provider)) return undefined
  return provider === "flux-2-klein" ? "1 MP" : "2 MP"
}

// Kling 3.0 supports continuous durations from 3s to 15s.
// Kept as a named export for the few callers that iterate this directly.
export const KLING3_DURATIONS = Array.from({ length: 13 }, (_, i) => i + 3)

// KIE.ai allowed durations per i2v provider — derived from MODEL_CATALOG.
export const KIE_VIDEO_DURATIONS: Record<string, number[]> = durationsByMode("i2v")

// Model capability constants — re-exported from shared package (single source of truth)

/** Inline Style dropdown options for image config panels. Derived from the
 *  canonical STYLES catalog so the dropdown and the standalone Style node
 *  stay in sync — both resolve to the same promptHint at execution time.
 *  Only the styles offered for images (`stylesForMedia`): a video-only style
 *  (Felt Puppet) is the Style node's and the video pickers' alone.
 *
 *  A FUNCTION, not a constant: it is read through the deployment's curated
 *  view, so a style a pack removed is not offered (and a pack's relabel
 *  shows). Callers inside components should pair it with
 *  `useCatalogPacksVersion()` so a late registration re-renders; by identity
 *  to the bundled list on a deployment with no packs. */
export function imageStylePresets(): ReadonlyArray<{ value: string; label: string }> {
  return stylesForMedia(curateEntries("style", STYLES), "image").map((s) => ({ value: s.id, label: s.label }))
}
/** The STOCK list, for the one consumer that is a module-scope table
 *  (types/nodes.ts NODE_DEFINITIONS) and cannot read at render time. The
 *  renderer's own `style` case never uses that table's options — it calls
 *  imageStylePresets() — so nothing curated is offered from here. */
export const IMAGE_STYLE_PRESETS: ReadonlyArray<{ value: string; label: string }> =
  stylesForMedia(STYLES, "image").map((s) => ({ value: s.id, label: s.label }))

// Providers that support start + end frame (2 images -> video) —
// derived from MODEL_CATALOG.features.includes("end-frame").
export const PROVIDERS_WITH_END_FRAME: string[] = modelsWithFeature("end-frame")

// Providers that accept reference images beyond the start frame —
// derived from MODEL_CATALOG.features.includes("reference-image"),
// filtered to video models so image-side reference flags don't leak in.
export const PROVIDERS_WITH_REFERENCES: string[] = modelsWithFeature("reference-image")
  .filter((id) => {
    // Avoid pulling image-only models (every i2i model has reference-image)
    // by intersecting with the i2v duration map — only video providers
    // appear there.
    return id in KIE_VIDEO_DURATIONS
  })

/** Aspect ratio options supported by Seedance 2.0 (includes 4:3, 3:4, 21:9, adaptive). */
export const SEEDANCE_2_VIDEO_RATIOS = [
  { value: "16:9", label: "16:9 (Landscape)" },
  { value: "9:16", label: "9:16 (Portrait)" },
  { value: "1:1", label: "1:1 (Square)" },
  { value: "4:3", label: "4:3" },
  { value: "3:4", label: "3:4" },
  { value: "21:9", label: "21:9 (Ultra-wide)" },
  { value: "adaptive", label: "Adaptive" },
] as const

// KIE.ai allowed durations per text-to-video provider — derived from
// MODEL_CATALOG. The "grok" key here is special: image-mode "grok" also
// supports t2v under the same id, so we read its durations from the
// i2v "grok-i2v" entry (same KIE underlying durations).
export const KIE_T2V_DURATIONS: Record<string, number[]> = {
  ...durationsByMode("t2v"),
  // grok image model serves t2v under id "grok" but the catalog tracks
  // its t2v durations on the separate "grok-i2v" entry.
  grok: durationsByMode("i2v")["grok-i2v"] ?? [6, 10],
}

// =============================================================================
// ADDITIONAL MODEL DESCRIPTION ARRAYS (lip-sync, TTS, Suno, motion transfer)
// =============================================================================

export type SunoModelOption = { value: SunoModel; label: string; desc: string }

/**
 * Every Suno version a picker OFFERS, in the order `SUNO_MODELS` (@nodaro/shared)
 * declares it: the active V6 family first (V6 is `DEFAULT_SUNO_MODEL`), then the
 * earlier versions, which are still fully selectable. That shared constant is the
 * source of truth for BOTH membership and order — the table here is display copy
 * for it, and `__tests__/model-options.test.ts` fails if the two drift.
 */
export const SUNO_MODELS: readonly SunoModelOption[] = [
  { value: "V6", label: "Suno V6", desc: "Greater musical expression with more natural vocals and richer details." },
  { value: "V6_WILD", label: "Suno V6 Wild", desc: "Pushes creative boundaries for bolder, more distinctive musical expression." },
  { value: "V6_MINI", label: "Suno V6 Mini", desc: "Lightweight and fast, balancing quality and speed for effortless creation." },
  { value: "V5_5", label: "Suno V5.5", desc: "Custom models tailored to unique taste" },
  { value: "V5", label: "Suno V5", desc: "Superior musical expression, faster generation" },
  { value: "V4_5PLUS", label: "Suno V4.5 Plus", desc: "Extended duration support" },
  { value: "V4_5ALL", label: "Suno V4.5 All", desc: "Full instrument + vocal generation" },
  { value: "V4_5", label: "Suno V4.5", desc: "Improved quality and coherence" },
  { value: "V4", label: "Suno V4", desc: "Stable, proven music generation" },
]


// =============================================================================
// AI-AVATAR (HeyGen) option constants — single source of truth shared by the
// config panel (ai-avatar-config.tsx) and the bottom-strip quick-config
// (node-quick-configs.tsx) so both lists can never drift.
// =============================================================================

/** HeyGen engine options — display labels + underlying values. */
export const AI_AVATAR_ENGINE_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "avatar-v",  label: "HeyGen Avatar V"  },
  { value: "avatar-iv", label: "HeyGen Avatar IV" },
]

/** Per-engine resolution options for HeyGen. Both engines support the same set
 *  today; the map exists so future engine-specific constraints don't require
 *  a schema change. */
export const AI_AVATAR_RESOLUTION_OPTIONS: Readonly<Record<string, ReadonlyArray<{ value: string; label: string }>>> = {
  "avatar-v":  [
    { value: "720p",  label: "720p"  },
    { value: "1080p", label: "1080p" },
    { value: "4k",    label: "4K"    },
  ],
  "avatar-iv": [
    { value: "720p",  label: "720p"  },
    { value: "1080p", label: "1080p" },
    { value: "4k",    label: "4K"    },
  ],
}

/** HeyGen speech-mode options for the bottom-strip quick-config. */
export const AI_AVATAR_SPEECH_MODES: ReadonlyArray<{ value: string; label: string }> = [
  { value: "text",  label: "Text (TTS)"   },
  { value: "audio", label: "Wired Audio"  },
]

/** Avatar-source options — pick a catalog avatar or animate a raw image. Drives
 *  the bottom-strip quick-config Source toggle. The config-panel Source radio
 *  renders the same two `value`s with its own terse labels ("Avatar"/"Image"). */
export const AI_AVATAR_SOURCE_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "avatar", label: "Catalog avatar" },
  { value: "image",  label: "From image"     },
]

/** Flat per-engine resolution value arrays (used by the fail-safe useEffect). */
export function getAiAvatarResolutionValues(engine: string): string[] {
  return (AI_AVATAR_RESOLUTION_OPTIONS[engine] ?? AI_AVATAR_RESOLUTION_OPTIONS["avatar-v"]!)
    .map((o) => o.value)
}

// =============================================================================
// CINEMATIC-AVATAR (HeyGen type:"cinematic_avatar") option constants — single
// source of truth shared by the config panel (cinematic-avatar-config.tsx) and
// the bottom-strip quick-config (node-quick-configs.tsx) so both lists can never
// drift. These MUST mirror the route's Zod enums (backend/src/routes/
// cinematic-avatar.ts).
// =============================================================================

/** Cinematic-avatar aspect-ratio options. Mirrors the route Zod enum. */
export const CINEMATIC_ASPECT_RATIO_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "16:9", label: "16:9" },
  { value: "9:16", label: "9:16" },
  { value: "1:1",  label: "1:1"  },
]

/** Cinematic-avatar resolution options. Mirrors the route Zod enum. */
export const CINEMATIC_RESOLUTION_OPTIONS: ReadonlyArray<{ value: string; label: string }> = [
  { value: "720p",  label: "720p"  },
  { value: "1080p", label: "1080p" },
]

// =============================================================================
// REFERENCE-BOARD provider options — subset of IMAGE_GEN_MODELS that render
// legible in-image text and accept reference conditioning. Single source of
// truth for the config panel dropdown; fail-safe useEffect re-uses
// IMAGE_ASPECT_RATIOS / IMAGE_RESOLUTION_OPTIONS / IMAGE_QUALITY_OPTIONS
// which already cover both providers.
// =============================================================================

/** Labeled provider options for the Reference Board config panel. Values must
 *  match the `REFERENCE_BOARD_PROVIDERS` constant exported from @nodaro/shared
 *  and the Zod enum in backend/src/routes/reference-board.ts. */
export const REFERENCE_BOARD_PROVIDER_OPTIONS: ReadonlyArray<{ value: string; label: string; desc: string }> = [
  { value: "nano-banana-pro", label: "Nano Banana Pro", desc: "Higher detail, production-ready images" },
  { value: "gpt-image-2",     label: "GPT Image 2",     desc: "Sharper text + photorealism, up to 4K" },
  { value: "gpt-image-2-5-flare",    label: "GPT Image 2.5 Flare",    desc: "Fast board drafts, up to 4K" },
  { value: "gpt-image-2-5-sunburst", label: "GPT Image 2.5 Sunburst", desc: "Precision board layout + labels, up to 4K" },
  { value: "gpt-image-2-6-flare",    label: "GPT Image 2.6 Flare",    desc: "Fast board drafts, up to 4K" },
  { value: "gpt-image-2-6-sunburst", label: "GPT Image 2.6 Sunburst", desc: "Precision board layout + labels, up to 4K" },
]

/** Flat lookup of model ID to description, built from all model arrays */
export const MODEL_DESCRIPTIONS: Record<string, string> = Object.fromEntries([
  ...IMAGE_GEN_MODELS,
  ...IMAGE_I2I_MODELS,
  ...IMAGE_EDIT_MODELS,
  ...VIDEO_I2V_MODELS,
  ...VIDEO_T2V_MODELS,
  ...VIDEO_V2V_MODELS,
  ...LIP_SYNC_MODELS,
  ...TTS_MODELS,
  ...DIALOGUE_MODELS,
  ...SUNO_MODELS,
  ...MOTION_TRANSFER_MODELS,
  ...VIDEO_DEPTH_MODELS,
].map(m => [m.value, m.desc]))
