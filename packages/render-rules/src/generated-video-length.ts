/**
 * How long a GENERATED clip is before it has run, read by the rule its own run
 * renders and prices it by: the one reading the published-app listing (backend
 * `lib/video-output-length.ts`, through its floor) and the measured walk
 * ({@link measuredWireLengthSec}, the run estimates of a step whose run
 * measures the file it is given) share.
 *
 * - Generate Video, Image to Video and Text to Video (payload-builder.ts, the
 *   three video cases): the node's provider, else the run's default; the
 *   catalog normalisation the run applies (`normalizeVideoRequestParams` and
 *   `pricedVideoSelection`: LTX's seeded duration tiers, at the node's
 *   resolution or the UI fill); then `pricedOutputDurationSec` (the requested
 *   seconds snapped to what the model offers, the model's default when unset,
 *   its longest clip for Auto). Several providers on one node each run, so the
 *   longest of theirs; Generate Video's model also depends on the run's mode (a
 *   split-id model resolves to its i2v or t2v twin), so both twins are read.
 * - Generate Video Pro: the clamp its pricing applies, one second over it when
 *   stitched (backend `ee/billing/generate-video-pro-credits.ts`).
 * - Extend Video's tail recipes: the seconds the run adds, held in each
 *   recipe's window (backend `lib/extend-recipe.ts` holds the rest of a recipe).
 * - A Seedance reference task type the node declares ("Use the reference video
 *   as"): read as its run resolves it (`seedanceTaskTypeAsRun` — an Edit runs at
 *   an automatic length, an Extend at an automatic length at the model's
 *   default), only when a reference clip qualifies. The measured walk hands the
 *   wired clips' lengths; the listing, which cannot see the wires, reads the
 *   node both ways — undeclared, and declared with one clip of the longest
 *   length the model accepts — and keeps the longer.
 *
 * Pure and environment-free: the deployment's Generate Video Pro cap is passed
 * in by the caller (the server reads its env, the editor its fallback).
 */
import {
  applyDefaultVideoSelection,
  billsReferenceVideoSeconds,
  hasContiguousSegmentDurations,
  isGeminiOmniPerSecondProvider,
  LEGACY_VIDEO_NODE_DEFAULT_PROVIDER,
  listedSeedanceTaskType,
  maxSegmentSecFor,
  minSegmentSecFor,
  PIXVERSE_V6_EXTEND_PROVIDER,
  pricedOutputDurationSec,
  resolveVideoProviderForMode,
  SEEDANCE_VIDEO_EDIT_TASK_TYPE,
  segmentDurationsFor,
  supportsAutoVideoDuration,
  VIDEO_REF_RATE_PROVIDERS,
  VIDEO_REF_VIDEO_DURATION_LIMITS,
  type TailExtendProvider,
} from "@nodaro/shared/models"
import { isAutoVideoDuration, normalizeVideoRequestParams, VIDEO_DURATION_AUTO } from "@nodaro/shared/model-catalog"
import { pricedVideoSelection, seedanceExtendAddedSec } from "@nodaro/shared/credits"
import { uiResolutionFill } from "@nodaro/shared/video"
import { settingsProviderModels } from "@nodaro/shared/nodes"
import { MODEL_CATALOG } from "@nodaro/shared/model-catalog"
import { nodeProviders } from "./node-fan-out"
import { seedanceTaskTypeAsRun } from "./seedance-task-type-as-run"

/** The model a legacy Image to Video / Text to Video node runs when it names none (the workflow run's own default), one constant with the write boundary's (`@nodaro/shared`). */
export { LEGACY_VIDEO_NODE_DEFAULT_PROVIDER }

/** The generation nodes whose output length is their configured duration. */
export const CONFIGURED_DURATION_VIDEO_TYPES: ReadonlySet<string> = new Set(["generate-video", "image-to-video", "text-to-video"])

/** The seconds one provider renders for these settings, as its run prices them (the pure body of the backend's `resolveVideoRequestNorm`). */
export function videoProviderRenderedSec(provider: string, data: Readonly<Record<string, unknown>>): number {
  const duration = data.duration as number | string | undefined
  const norm = normalizeVideoRequestParams(provider, { resolution: (data.resolution as string | undefined) ?? uiResolutionFill(provider) })
  const priced = pricedVideoSelection({ provider, resolution: norm.resolution, duration })
  return pricedOutputDurationSec(provider, priced.duration ?? duration)
}

/** What a reading of a generation knows beyond its settings. */
export interface GeneratedVideoLengthOptions {
  /**
   * Read the duration the run itself fills for a Generate Video that names
   * neither a provider nor a duration (`applyDefaultVideoSelection`: the
   * default model at its short default). Absent, only the default provider is
   * filled and an unset duration reads that model's own default, which is
   * longer: the listing's reading, harmless for it (it only over-lists).
   */
  readonly runDefaultDuration?: boolean
  /**
   * The lengths of the clips wired into its reference-video handles (`undefined`
   * where a clip's length is not known): a model whose output follows its clip
   * renders up to it ({@link referenceClipOutputSec}). Absent or empty: no clip.
   */
  readonly referenceClipSecs?: ReadonlyArray<number | undefined>
  /**
   * Its duration is set at run time by a source whose value is not known
   * before the run (a field mapping or a `field-duration` wire from a node
   * that is not a parameter node): each model at its longest clip, the most a
   * run can render whatever the value turns out to be.
   */
  readonly openDuration?: boolean
  /**
   * Its model is set at run time by such a source: every model the node may
   * run (`settingsProviderModels`), the longest of them; none listed: unknown.
   */
  readonly openProvider?: boolean
}

/** The longest clip a model renders (its catalog durations; Auto is one of them); `undefined` when it declares none. */
export function longestModelClipSec(provider: string): number | undefined {
  const durations = MODEL_CATALOG[provider]?.durations ?? []
  return durations.length === 0 ? undefined : Math.max(...durations)
}

/**
 * The length, in seconds, of the clip a generation node renders, by its run's
 * own rule (see the module note): the longest over the providers it runs.
 * `undefined` for a node whose length is not its configured duration (every
 * type outside {@link CONFIGURED_DURATION_VIDEO_TYPES}), and for one whose
 * open model or duration has no declared bound (unknown: the cap).
 */
export function generatedVideoRenderedSec(
  node: { readonly type?: string | null; readonly data?: unknown },
  options: GeneratedVideoLengthOptions = {},
): number | undefined {
  const type = node.type ?? ""
  if (!CONFIGURED_DURATION_VIDEO_TYPES.has(type)) return undefined
  const stored = (node.data ?? {}) as Record<string, unknown>
  const selection = type === "generate-video" && options.runDefaultDuration
    ? applyDefaultVideoSelection({ provider: stored.provider as string | undefined, duration: stored.duration })
    : undefined
  const data = selection ? { ...stored, duration: selection.duration } : stored
  const named = options.openProvider
    ? settingsProviderModels(type)
    : nodeProviders(type, data) ??
      [
        type === "generate-video"
          ? applyDefaultVideoSelection({ provider: data.provider as string | undefined }).provider
          : ((data.provider as string | undefined) ?? LEGACY_VIDEO_NODE_DEFAULT_PROVIDER),
      ]
  const providers =
    type === "generate-video"
      ? named.flatMap((p) => [resolveVideoProviderForMode(p, "image-to-video"), resolveVideoProviderForMode(p, "text-to-video")])
      : named
  if (providers.length === 0) return undefined
  const clips = options.referenceClipSecs ?? []
  /** One provider's clip, with the reference clips `wired` (their lengths; `undefined` where not known): its task type as the run resolves it. */
  const lengthOf = (p: string, wired: ReadonlyArray<number | undefined>): number | undefined => {
    const run = wired.length === 0 ? undefined : seedanceTaskTypeAsRun({ provider: p, duration: data.duration as number | string | undefined, data, referenceVideoSec: wired })
    const runData = run === undefined || run.duration === data.duration ? data : { ...data, duration: run.duration }
    const rendered = options.openDuration ? longestModelClipSec(p) : videoProviderRenderedSec(p, runData)
    if (rendered === undefined) return undefined
    // An open duration may turn out to be anything, so the edit rule's general branch (the longest of all) bounds it.
    return wired.length === 0 ? rendered : referenceClipOutputSec(p, rendered, options.openDuration ? undefined : runData.duration, wired, run?.taskType)
  }
  const lengths = providers.map((p) => {
    if (options.referenceClipSecs !== undefined) return lengthOf(p, clips)
    // The listing: the wires are not known, so both ways — undeclared, and as declared with one reference clip of the
    // longest length the model accepts (the server's own count of a clip it cannot measure) — the longer kept.
    const undeclared = lengthOf(p, [])
    if (undeclared === undefined || data.referenceTaskType === undefined) return undeclared
    const run = seedanceTaskTypeAsRun({ provider: p, duration: data.duration as number | string | undefined, data, referenceVideoSec: [undefined] })
    if (run.duration === data.duration) return undeclared
    return Math.max(undeclared, videoProviderRenderedSec(p, { ...data, duration: run.duration }))
  })
  return lengths.some((l) => l === undefined) ? undefined : Math.max(...(lengths as number[]))
}

/**
 * The longest reference clip a provider takes, which an unmeasured clip counts
 * as (`VIDEO_REF_VIDEO_DURATION_LIMITS`' per-clip cap, else 15 s) — the
 * reservation's own worst case (backend `refVideoWorstCaseSecFor`).
 */
export function referenceClipWorstCaseSec(provider: string): number {
  return VIDEO_REF_VIDEO_DURATION_LIMITS[provider]?.maxSec ?? REFERENCE_CLIP_WORST_CASE_SEC
}
const REFERENCE_CLIP_WORST_CASE_SEC = 15

/** The seconds an Auto-duration edit renders past its source clip rounded up (backend `SEEDANCE_AUTO_EDIT_HOLD_MARGIN_SEC`). */
export const AUTO_EDIT_MARGIN_SEC = 1

/**
 * The length a generation with reference clips renders, at most, from the
 * clips' lengths (an unknown one at {@link referenceClipWorstCaseSec}):
 * - a per-second Gemini Omni edit renders its source clip (the first);
 * - a model that renders exactly the requested length (Kling 4.0,
 *   `VIDEO_REF_RATE_PROVIDERS`), and any model that does not bill its clips'
 *   seconds, renders `renderedSec`;
 * - a Seedance run that DECLARES an edit at an automatic length, with every
 *   clip known, renders the clip it edits — the model may edit any of them, so
 *   the LONGEST — rounded up plus {@link AUTO_EDIT_MARGIN_SEC}, at most the
 *   model's longest clip;
 * - any other Seedance run: the longest of `renderedSec` and every clip. A run
 *   that declares nothing lets the model decide from the prompt whether a clip
 *   is a reference, an edit or an extension, and one it takes as a reference
 *   renders a length it picks within its range — at an automatic length, up to
 *   the model's longest clip (`renderedSec`); an edit renders a clip's length.
 *
 * The reservation's hold of the generation itself (backend
 * `seedance2RefVideoHeldOutputSec`) still holds an undeclared automatic run at
 * the longest clip plus the margin; this reading is never below that hold.
 *
 * @param referenceTaskType the run's declared reference task type, as resolved
 *   (`seedanceTaskTypeAsRun`); `undefined` when none is declared.
 */
export function referenceClipOutputSec(
  provider: string,
  renderedSec: number,
  requestedDuration: unknown,
  clipSecs: ReadonlyArray<number | undefined>,
  referenceTaskType?: unknown,
): number {
  if (clipSecs.length === 0 || !billsReferenceVideoSeconds(provider)) return renderedSec
  const worst = referenceClipWorstCaseSec(provider)
  const known = (s: number | undefined): s is number => typeof s === "number" && Number.isFinite(s) && s > 0
  const clips = clipSecs.map((s) => (known(s) ? s : worst))
  if (isGeminiOmniPerSecondProvider(provider)) return Math.ceil(clips[0]! - 0.05)
  if (VIDEO_REF_RATE_PROVIDERS.has(provider)) return renderedSec
  const declaresEdit = listedSeedanceTaskType(provider, referenceTaskType) === SEEDANCE_VIDEO_EDIT_TASK_TYPE
  if (isAutoVideoDuration(requestedDuration) && supportsAutoVideoDuration(provider) && clipSecs.every(known) && declaresEdit) {
    return Math.min(Math.ceil(Math.max(...clips)) + AUTO_EDIT_MARGIN_SEC, pricedOutputDurationSec(provider, VIDEO_DURATION_AUTO))
  }
  return Math.max(renderedSec, ...clips)
}

// ── Generate Video Pro ──────────────────────────────────────────────────────

/** The duration a run with none configured is priced at (node-executor.ts). */
export const GENERATE_VIDEO_PRO_DEFAULT_DURATION_SEC = 8

/** The most seconds one run may ask for when the deployment sets no cap of its own (the server's `GENERATE_VIDEO_PRO_MAX_DURATION` default). */
export const GENERATE_VIDEO_PRO_DEFAULT_MAX_DURATION_SEC = 120

/** The requested duration as the run's pricing clamps it, for a provider with a segment menu, under the deployment's cap. */
export function generateVideoProClampedSec(provider: string, duration: number | undefined, capSec: number): number {
  const requested = typeof duration === "number" && Number.isFinite(duration) ? duration : GENERATE_VIDEO_PRO_DEFAULT_DURATION_SEC
  return Math.min(Math.max(Math.round(requested), minSegmentSecFor(provider)), capSec)
}

/**
 * The longest clip a Generate Video Pro run delivers for this duration: the
 * clamp, rounded up to the model's next offered length when one segment on a
 * sparse menu, and one second over it when stitched (the plan's raw length is
 * `ceil(D + loss × joins)` less the `loss` each join eats). A provider with no
 * segment menu is bounded by the cap.
 */
export function generateVideoProLengthSec(provider: string, duration: number | undefined, capSec: number): number {
  const menu = segmentDurationsFor(provider)
  if (menu.length === 0) return capSec
  const clamped = generateVideoProClampedSec(provider, duration, capSec)
  if (clamped > maxSegmentSecFor(provider)) return clamped + 1
  if (hasContiguousSegmentDurations(provider)) return clamped
  return menu.find((d) => d >= clamped) ?? clamped
}

// ── Extend Video's tail recipes ─────────────────────────────────────────────

/** A provider's catalog window: the shortest and longest of its `durations`, the window `seedanceExtendAddedSec` holds a request in. */
function catalogWindow(provider: TailExtendProvider): { readonly min: number; readonly max: number } {
  const offered = MODEL_CATALOG[provider]?.durations ?? []
  return offered.length > 0 ? { min: Math.min(...offered), max: Math.max(...offered) } : { min: 1, max: Number.POSITIVE_INFINITY }
}

/**
 * The seconds a tail-recipe Extend Video run may add, by provider (the rest of
 * each recipe: backend `lib/extend-recipe.ts`): its catalog window, read from
 * the catalog as the seconds rule reads it, so the two cannot differ.
 */
export const TAIL_RECIPE_WINDOWS: Readonly<Record<TailExtendProvider, { readonly min: number; readonly max: number }>> = {
  "seedance-2-5-extend": catalogWindow("seedance-2-5-extend"),
  "seedance-2-0-extend": catalogWindow("seedance-2-0-extend"),
  "kling-4-extend": catalogWindow("kling-4-extend"),
}

/** Whether an Extend Video provider runs a tail recipe. Own keys only, so `"toString"` answers false. */
export function isTailRecipeProvider(p: string): p is TailExtendProvider {
  return Object.hasOwn(TAIL_RECIPE_WINDOWS, p)
}

/**
 * The seconds a tail-recipe run adds for a requested `duration`: the seconds
 * its price counts (`pricedOutputDurationSec` — the provider's catalog default
 * when unset or unreadable), rounded and held in the recipe's window. It IS
 * `seedanceExtendAddedSec` (`@nodaro/shared/credits`), the one reading of the
 * length: the route queues it, the worker generates it, the output-length
 * rule adds it to the source, and every price and quote counts it.
 */
export function tailRecipeSeconds(provider: TailExtendProvider, duration: unknown): number {
  return seedanceExtendAddedSec(provider, duration)
}

/**
 * The seconds a PixVerse V6 Extend run (`pixverse-v6-extend`, a native extend:
 * no tail recipe) adds for a requested `duration`: the seconds its price counts
 * (`pricedOutputDurationSec`: snapped into the catalog's 1–15 s, its default 5
 * when unset or unreadable). The one reading of the length: the route queues
 * it, the worker generates it and the output-length rule adds it to the source
 * (backend `lib/extend-native.ts` re-exports it).
 */
export function pixverseExtendSeconds(duration: unknown): number {
  const requested = typeof duration === "number" || typeof duration === "string" ? duration : undefined
  return pricedOutputDurationSec(PIXVERSE_V6_EXTEND_PROVIDER, requested)
}
