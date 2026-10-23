"use client"

import { tx, useT, type MessageKey } from "@/lib/i18n"
import { useLocalizeOptionLabel } from "@/lib/i18n/labels"
import { useEffect, useMemo, useRef, useState } from "react"
import type { LucideIcon } from "lucide-react"
import { Sparkles, Languages, Image as ImageIcon, LayoutGrid, Palette, Ratio, Maximize2, Clock, Wand2, Hash, Music2, Mic, Volume2, Gauge, Layers } from "lucide-react"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Popover, PopoverAnchor, PopoverContent } from "@/components/ui/popover"
import { speakerViewQuickConfigs } from "./speaker-view-quick-configs"
import { ClampedNumberInput } from "@/components/ui/clamped-number-input"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import { llmPickerPriceLabel, useLlmModelPrices } from "@/hooks/use-llm-price"
import { llmPricingMode, useLlmPricingMode } from "@/hooks/use-llm-pricing-mode"
import { llmModelFor, llmNodeFeature } from "@/lib/llm-price-ids"
import type { WorkflowEdge, WorkflowNode } from "@/types/nodes"
import {
  MODIFY_IMAGE_MODELS,
  UPSCALE_IMAGE_MODELS,
  VIDEO_V2V_MODELS,
  V2V_RESOLUTION_OPTIONS,
  EXTEND_VIDEO_MODELS,
  LIP_SYNC_MODELS,
  TTS_MODELS,
  DIALOGUE_MODELS,
  SUNO_MODELS,
  MOTION_TRANSFER_MODELS,
  VIDEO_DEPTH_MODELS,
  AI_AVATAR_ENGINE_OPTIONS,
  AI_AVATAR_RESOLUTION_OPTIONS,
  AI_AVATAR_SPEECH_MODES,
  AI_AVATAR_SOURCE_OPTIONS,
  CINEMATIC_ASPECT_RATIO_OPTIONS,
  CINEMATIC_RESOLUTION_OPTIONS,
  COLLAGE_ASPECT_RATIOS,
  COMPOSITION_RATIOS,
  IMAGE_GEN_MODELS,
  getAspectRatiosForModel,
  getSourcePhotoAspectRatios,
  IMAGE_RESOLUTION_OPTIONS,
  IMAGE_QUALITY_OPTIONS,
  REFERENCE_BOARD_PROVIDER_OPTIONS,
  VIDEO_GEN_MODELS,
  GVP_PROVIDERS,
  EVP_PROVIDERS,
  GENERATE_VIDEO_PRO_MAX_DURATION_FALLBACK,
  getAspectRatiosForVideoModel,
  getDurationsForVideoModel,
  getVideoResolutionOptions,
  VIDEO_RESOLUTION_OPTIONS,
} from "@/components/editor/config-panels/model-options"
import { availableReasoningEfforts, defaultReasoningEffort, DESCRIBE_TO_PICKER_MODELS, LLM_FEATURE_DEFAULTS, LLM_MODELS, type LlmFeature, type LlmModelDef, orderedLlmModels, VIDEO_ANALYSIS_TIER_ORDER, VIDEO_ANALYSIS_TIER_LABELS, DEFAULT_VIDEO_ANALYSIS_TIER } from "@nodaro/shared/llm-models"
import {
  isSeedanceVideoEditProvider,
  DEFAULT_TTS_PROVIDER,
  DEFAULT_DIALOGUE_PROVIDER,
  VOICE_CHANGER_MODELS,
  DEFAULT_VOICE_CHANGER_MODEL,
  SUNO_SEPARATE_TYPES,
} from "@nodaro/shared/models"
import { SUNO_SEPARATE_TYPE_LABEL_KEYS } from "@/lib/suno-separate-labels"
import {
  isSeedanceDraftCapable,
  SEEDANCE_DRAFT_RESOLUTION,
  IMAGE_MODEL_ROLE_DEFAULTS
} from "@nodaro/shared/model-catalog"
import { SHEET_TYPES, SHEET_SKINS, type SheetType, type SheetSkin } from "@nodaro/shared/entities"
import { SCENE3D_LIMITS } from "@nodaro/shared/scene3d"
import { VIDEO_OVERLAY_OUTPUT_ASPECTS } from "@nodaro/shared/video"
import { EFFORT_LABELS } from "@/components/editor/config-panels/reasoning-effort-select"
import { ALL_LANGUAGES } from "@/lib/audio-tags"
import { ttsModelSwitchPatch, type TtsSwitchFields } from "@/lib/tts-model-switch"
import { dialogueModelSwitchPatch, type DialogueSwitchFields } from "@/lib/dialogue-model-switch"
import {
  VIDEO_DEPTH_MODEL_SIZES,
  VIDEO_DEPTH_RESOLUTIONS,
  resolveVideoDepthProvider,
  videoDepthColormaps,
  videoDepthLevers,
  VIDEO_MASK_LIMITS,
  MASK_COMPOSITE_AUDIO_SOURCES,
  MASK_COMPOSITE_BACKGROUND_FITS,
  MASK_COMPOSITE_DEFAULTS,
  maskCompositeFillOf,
  maskCompositeUsesForeground
} from "@nodaro/shared/media"
import { MASK_COMPOSITE_AUDIO_LABEL_KEYS, MASK_COMPOSITE_FIT_LABEL_KEYS } from "@/components/editor/config-panels/mask-composite-config"
import { cachedFreeVideoLimits, lockedVideoDuration, lockedVideoModel, lockedVideoResolution, type FreeVideoLimits } from "@/lib/free-video-locks"

/**
 * Data-driven quick-config controls for {@link NodeQuickStrip}. Each AI node
 * type maps to the inline dropdown(s) shown between the Prompt button and Run
 * (the "configurations" middle of the strip). Options reuse the SAME lists the
 * full config panels use (`model-options.ts`), so they can't drift.
 */
export interface QuickConfigOption {
  readonly value: string
  readonly label: string
  /** Optional one-line explanation shown UNDER the label in the dropdown menu
   *  (not in the compact trigger). Use when the labels alone are ambiguous —
   *  e.g. SwitchX alpha modes (auto/fill/select/custom). */
  readonly description?: string
  /** Greyed rather than removed (Speaker View's Crossfade when no speaker change
   *  crosses a clock jump): the row stays in the menu and reachable by keyboard
   *  (`aria-disabled`, not the hard `disabled` that skips it), shows `reason` on
   *  hover and as visible text, and never writes its value. A stored value that
   *  is only greyed is NOT snapped away. Give it a `reason`. */
  readonly disabled?: boolean
  /** Why it is greyed, already localized. */
  readonly reason?: string
}

/** What an options function may read besides the node's own data (SV10):
 *  the graph it sits in. Additive — existing options functions ignore it. */
export interface QuickConfigContext {
  readonly nodeId: string
  readonly nodes: ReadonlyArray<WorkflowNode>
  readonly edges: ReadonlyArray<WorkflowEdge>
}

export interface QuickConfigControl {
  /** Node data field this dropdown writes. */
  readonly field: string
  readonly ariaLabel: string
  readonly icon?: LucideIcon
  /** Dropdown options. Pass a function to make the list provider-aware (it
   *  receives the node's `data`); return `[]` when the current provider has no
   *  such lever — {@link QuickConfigSelect} then HIDES the control and clears
   *  any stale value, so a provider switch can't leave an out-of-range value
   *  that the route's Zod enum would reject (the recurring provider-sync trap).
   *  The valid set must come from the SAME source the config panel uses
   *  (model-options.ts) so the two can't drift. */
  readonly options:
    | ReadonlyArray<QuickConfigOption>
    | ((data: Record<string, unknown>, ctx?: QuickConfigContext) => ReadonlyArray<QuickConfigOption>)
  /** The option list reads the GRAPH around the node (SV10: Speaker View's valid
   *  layouts depend on the edit wired into it). Set it so the strip hands the
   *  options function a {@link QuickConfigContext}; without it the strip does
   *  not subscribe to the graph at all. */
  readonly needsGraph?: boolean
  /** Values a stored node may carry that the menu no longer OFFERS but that
   *  still run (a retired LLM model): never snapped away, labelled on the
   *  trigger, accepted on an app run, and never listed. Static on purpose, so a
   *  static `options` list stays one an app publisher can restrict. */
  readonly retainedOptions?: ReadonlyArray<QuickConfigOption>
  /** Which option a stale stored value snaps to. Default: the first option. A
   *  control whose valid set has a better answer than "first" (Speaker View's
   *  layout twin: side by side → stacked) names it here. Must return one of the
   *  options' values. */
  readonly snap?: (value: string, data: Record<string, unknown>, ctx?: QuickConfigContext) => string
  /** Write the chosen value as a number (option values are strings). */
  readonly numeric?: boolean
  /** Additional node-data fields to set to `undefined` whenever this control's
   *  value changes. Use when selecting a new value must invalidate a sibling
   *  field (e.g. provider change on generate-image must clear `providers` so the
   *  multi-provider array doesn't override the new single choice). */
  readonly additionalClear?: readonly string[]
  /** When `true`, returning `[]` from {@link options} HIDES the control WITHOUT
   *  clearing the stored value. Use for fields whose value is preserved across
   *  modes and re-applied when the lever returns (e.g. ai-avatar `engine`: hidden
   *  in image-source mode but the data type still requires it, and billing pins
   *  to a neutral rate regardless). Default behaviour (flag absent) clears the
   *  field on hide — the provider-sync trap fix for enum fields like
   *  v2v-resolution. */
  readonly preserveOnHide?: boolean
  /** Write the chosen value as a boolean (`"true"`/`"false"` option values). For
   *  boolean node-data fields surfaced as a 2-option dropdown (suno `instrumental`).
   *  Mutually exclusive with `numeric`. */
  readonly boolean?: boolean
  /** When the chosen option value equals this string, write `undefined` instead —
   *  the sentinel "no value" choice (suno Vocal "auto" → undefined, since the API
   *  only accepts male/female). Make the sentinel the FIRST option so an unset
   *  field falls back to its label. */
  readonly sentinelUndefined?: string
  /** Displayed (and treated as selected) when the field is UNSET — for fields
   *  whose runtime default is a specific option that is NOT the list's first
   *  entry (gvp aspectRatio: the backend defaults to "adaptive", which sits
   *  LAST in the shared aspect list; without this the trigger showed "16:9"
   *  while runs were actually adaptive). Must be one of the options' values. */
  readonly defaultValue?: string
  /** Numeric free-entry range: appends a "Custom…" item that opens a popover
   *  with a slider + number input (the same pair the config panels use), so
   *  ANY in-range value is one tap away — not just the preset list. In-range
   *  values are also exempt from the stale-value snap and render on the
   *  trigger as `${value}${unit}`. Implies `numeric`. */
  readonly customRange?: { readonly min: number; readonly max: number; readonly step?: number; readonly unit?: string }
  /** Derive the dropdown's current value from the node data instead of reading
   *  `data[field]` — for a control that PROJECTS several fields into one choice
   *  (image-collage "Badges": `numbered` + `badgePosition` → none/top-left/top-right).
   *  Must return one of the option values. Pairs with {@link write}. */
  readonly read?: (data: Record<string, unknown>) => string
  /** Build the whole node-data patch for a chosen value instead of writing
   *  `data[field]`; the fail-safe snap uses it too, so a projected control can
   *  never write its virtual `field` into the data. Pairs with {@link read}.
   *  `data` is the node's current data when the USER made the choice, and absent
   *  for the fail-safe snap (an effect must not clean up what it did not ask
   *  about) — a `write` that reads it must work without. */
  readonly write?: (value: string, data?: Record<string, unknown>) => Record<string, unknown>
  /** `false` keeps this control out of a published app. By default every
   *  control is also a field the publisher can expose on the app's input form
   *  (`presentation/exposable-fields.ts` derives it, with this same option list,
   *  write and snap). Opt out a control a stranger running the app must not set,
   *  or one the app cannot render, and say why:
   *   - a cost multiplier (`repeatCount`: a run's price ×N);
   *   - a VIRTUAL `field` that is not a node-data key (a `read`/`write`
   *     projection over other fields, e.g. collage `badges`);
   *   - a `needsGraph` control (the app card has no graph to read).
   *  A guard test holds the last two. */
  readonly exposable?: false
  /** An LLM model control: each model's estimated price beside it, while
   *  metered pricing is on (D7) — none under the tier-pricing rollback. The
   *  node's metered feature is read from its type (`llmNodeFeature`). */
  readonly llmModelPrices?: true
}

/** The strip's current value for a control — the projection when it has one,
 *  else the raw field (stringified; "" when unset). */
export function readQuickConfigValue(control: QuickConfigControl, data: Record<string, unknown>): string {
  if (control.read) return control.read(data)
  const v = data[control.field]
  return v != null ? String(v) : ""
}

/** Resolve a control's options against the node's current data. */
export function resolveQuickConfigOptions(
  control: QuickConfigControl,
  data: Record<string, unknown>,
  ctx?: QuickConfigContext,
): ReadonlyArray<QuickConfigOption> {
  return typeof control.options === "function" ? control.options(data, ctx) : control.options
}
const resolveOptions = resolveQuickConfigOptions

/** Coerce a dropdown's chosen string value to the node-data value, honoring the
 *  control's `sentinelUndefined` / `boolean` / `numeric` flags. Single source for
 *  BOTH the change-write and the fail-safe snap so they can't diverge. */
export function coerceQuickConfigValue(control: QuickConfigControl, v: string): unknown {
  if (control.sentinelUndefined !== undefined && v === control.sentinelUndefined) return undefined
  if (control.boolean) return v === "true"
  if (control.numeric) return Number(v)
  return v
}

/** Whether `v` is a numeric value inside the control's `customRange` (any
 *  such value is valid, listed or not). False for a control without one. */
export function isInQuickConfigRange(control: QuickConfigControl, v: string): boolean {
  const range = control.customRange
  if (!range) return false
  const n = Number(v)
  return Number.isFinite(n) && n >= range.min && n <= range.max
}

/** The node-data patch a USER's choice of `v` writes: the control's projection
 *  (given the node's data) or its coerced field, plus `additionalClear`. The
 *  strip and a published app's card both write through this. */
export function quickConfigChoicePatch(
  control: QuickConfigControl,
  v: string,
  data?: Record<string, unknown>,
): Record<string, unknown> {
  const patch: Record<string, unknown> = control.write
    ? control.write(v, data)
    : { [control.field]: coerceQuickConfigValue(control, v) }
  if (control.additionalClear) {
    for (const f of control.additionalClear) patch[f] = undefined
  }
  return patch
}

/** The option for a stored value the control keeps without offering it
 *  ({@link QuickConfigControl.retainedOptions}), else undefined. */
export function quickConfigRetainedOption(control: QuickConfigControl, v: string): QuickConfigOption | undefined {
  return control.retainedOptions?.find((o) => o.value === v)
}

/** The fail-safe for a stale value (mirrors the config panels' provider-change
 *  snap): `undefined` when there is nothing to do — the value is unset, valid,
 *  or an in-range custom numeric — else the patch that snaps it to a valid
 *  option (`snap`'s pick, else the first), or clears it when the current
 *  provider has no such lever (kept when `preserveOnHide`). Unlike a user's
 *  choice it calls `write` WITHOUT data and clears nothing else: an effect must
 *  not clean up what it did not ask about. */
export function quickConfigSnapPatch(
  control: QuickConfigControl,
  value: string,
  options: ReadonlyArray<QuickConfigOption>,
  data: Record<string, unknown>,
  ctx?: QuickConfigContext,
): Record<string, unknown> | undefined {
  if (value === "" || value == null) return undefined
  if (options.length === 0) {
    return control.preserveOnHide ? undefined : { [control.field]: undefined }
  }
  if (options.some((o) => o.value === value) || isInQuickConfigRange(control, value)) return undefined
  if (quickConfigRetainedOption(control, value)) return undefined
  const snapped = control.snap?.(value, data, ctx)
  // A fail-safe writes an OPEN option: the first that is not greyed (the
  // free-credit video limits), else the first.
  const next = snapped !== undefined && options.some((o) => o.value === snapped) ? snapped : (options.find((o) => !o.disabled) ?? options[0]!).value
  return quickConfigSnapWrite(control, next)
}

/** What a fail-safe move onto option `next` writes: the projection WITHOUT the
 *  node's data, or the coerced field — never `additionalClear`. */
export function quickConfigSnapWrite(control: QuickConfigControl, next: string): Record<string, unknown> {
  return control.write ? control.write(next) : { [control.field]: coerceQuickConfigValue(control, next) }
}

/** The value option `v` puts in the control's OWN field — what the node's data
 *  (and a run's inputs) carry for it: the projection's value for that field, or
 *  the coerced option. `undefined` means the option leaves the field unset (a
 *  sentinel, Draft's "full", Video Overlay's "source"). */
export function quickConfigOptionValue(control: QuickConfigControl, v: string): unknown {
  return control.write ? control.write(v)[control.field] : coerceQuickConfigValue(control, v)
}

/**
 * Greys the options the free-credit video limits would refuse (the account
 * never paid), with the reason — never removes them, never snaps a stored
 * value. Reads the limits from the cached balance; null = no locks.
 */
const withFreeVideoLocks = (
  options: readonly QuickConfigOption[],
  lockOf: (value: string, limits: FreeVideoLimits) => string | null,
): QuickConfigOption[] => {
  const limits = cachedFreeVideoLimits()
  if (!limits) return [...options]
  return options.map((o) => {
    const reason = lockOf(o.value, limits)
    return reason ? { ...o, disabled: true, reason } : o
  })
}

const toOptions = (
  list: ReadonlyArray<{ readonly value: string | number; readonly label: string }>,
): QuickConfigOption[] => list.map((o) => ({ value: String(o.value), label: o.label }))

/** A provider/model dropdown writing `data.provider`. `runsAs` is the model a
 *  node with NO stored provider actually runs on (its executor's fallback); pass
 *  it whenever that is not the list's first entry, or the strip shows one model
 *  while the node runs, prices and offers the levers of another (a fresh Video
 *  to Video node read "Seedance 2.5 Edit" while it ran Wan, so its Draft lever
 *  never appeared). */
const providerControl = (
  list: ReadonlyArray<{ readonly value: string | number; readonly label: string }>,
  runsAs?: string,
): QuickConfigControl => ({
  field: "provider",
  ariaLabel: tx("field.model"),
  icon: Sparkles,
  options: toOptions(list),
  ...(runsAs !== undefined ? { defaultValue: runsAs } : {}),
})

/** Text-to-speech model dropdown. The user's choice also clears the voice
 *  settings the new model does not honour and a language it is not offered in —
 *  exactly what the config panel's dropdown does (`ttsModelSwitchPatch`), so the
 *  two surfaces cannot disagree. The fail-safe snap calls `write` without data
 *  and so writes the provider alone. */
const ttsProviderControl = (): QuickConfigControl => ({
  field: "provider",
  ariaLabel: tx("field.model"),
  icon: Sparkles,
  options: toOptions(TTS_MODELS),
  // A node with no stored model runs on the default speech model — show that, not
  // whichever model happens to be listed first.
  defaultValue: DEFAULT_TTS_PROVIDER,
  write: (value, data) => ({ provider: value, ...ttsModelSwitchPatch(value, (data ?? {}) as TtsSwitchFields) }),
})

/** Suno model dropdown (writes `data.model`), shared by all Suno nodes that
 *  carry a `model: SunoModel`. */
const sunoModelControl = (): QuickConfigControl => ({
  field: "model",
  ariaLabel: tx("field.model"),
  icon: Sparkles,
  options: toOptions(SUNO_MODELS),
})

/** Suno Instrumental toggle as a 2-option dropdown (writes boolean `data.instrumental`).
 *  Undefined reads as "With vocals" — executor treats `instrumental ?? false`. */
const sunoInstrumentalControl = (): QuickConfigControl => ({
  field: "instrumental",
  ariaLabel: tx("audiocfg.instrumentalToggle"),
  icon: Music2,
  boolean: true,
  options: [
    { value: "false", label: tx("node.withVocals") },
    { value: "true", label: tx("node.instrumentalNoVocals") },
  ],
})

/** Suno Vocal gender (writes `data.vocalGender`); "Auto" → undefined (API accepts
 *  only male/female). Hidden when instrumental is on (no vocals to gender),
 *  preserving the stored value. Auto first so an unset field shows "Auto". */
const sunoVocalControl = (): QuickConfigControl => ({
  field: "vocalGender",
  ariaLabel: tx("audiocfg.vocal"),
  icon: Mic,
  sentinelUndefined: "auto",
  preserveOnHide: true,
  options: (data) =>
    data.instrumental
      ? []
      : [
          { value: "auto", label: tx("common.auto") },
          { value: "male", label: tx("audiocfg.male") },
          { value: "female", label: tx("audiocfg.female") },
        ],
})

/** LLM model dropdown (writes `data.llmModel`), shared by the LLM-backed nodes.
 *  Vendor-clustered + tier-ordered via the shared ordering (the strip's compact
 *  Select can't render group headers, but the clustering still scans). */
/** Retired LLM models: a saved node keeps (and runs) one, the strip never offers it. */
const retiredLlmOptions = (models: readonly LlmModelDef[]): ReadonlyArray<QuickConfigOption> =>
  models.filter((m) => m.retired).map((m) => ({ value: m.id, label: m.displayName }))

const llmModelControl = (): QuickConfigControl => ({
  field: "llmModel",
  ariaLabel: tx("field.model"),
  icon: Sparkles,
  options: orderedLlmModels().map((m) => ({ value: m.id, label: m.displayName })),
  retainedOptions: retiredLlmOptions(LLM_MODELS),
  llmModelPrices: true,
  // Clearing `advancedMode` on ANY model switch is deliberately blunt: the
  // registry's additionalClear is unconditional, so a Gemini→Gemini switch also
  // turns Advanced off and the user has to re-enable it. That is a visible,
  // recoverable annoyance. The alternative — leaving the flag set — strands the
  // node on a model with no direct lane, where the badge still looks right and
  // an orchestrated run fails with `advanced_mode_unsupported` and no visible
  // cause. Prefer the annoyance.
  additionalClear: ["advancedMode"],
})

/** Effort dropdown for reasoning-capable models (writes `data.reasoningEffort`).
 *  Provider-aware: options are derived from the CURRENTLY selected `llmModel`'s
 *  effort levels ON THE ACTIVE LANE — empty on non-reasoning models, so
 *  {@link QuickConfigSelect} self-hides the control. Its generic fail-safe
 *  `useEffect` (same mechanism every provider-aware control here relies on)
 *  snaps or clears a stale stored effort whenever the model switch changes
 *  this list — no bespoke onChange wiring needed.
 *
 *  `feature` is for a node whose run has a DEFAULT effort
 *  (`defaultReasoningEffort` — describe-to-picker's Opus 5.5 at high). The
 *  node stores neither its default model nor that effort, so without it the
 *  strip would hide the control on an untouched node and read Auto for a run
 *  that goes out at high. With it, an unset model reads as the feature's
 *  default model and an unset effort as the effort the run will use. On that
 *  model Auto is not offered (decided 2026-10-09): an omitted effort IS the
 *  default there, so Auto would be a second name for it, and a stale stored
 *  effort snaps to the default, as it did when it snapped to Auto. Nodes
 *  without a default effort pass no feature and keep the control as it was. */
const reasoningEffortControl = (feature?: LlmFeature): QuickConfigControl => {
  const modelOf = (data: Record<string, unknown>): string => {
    const stored = typeof data.llmModel === "string" ? data.llmModel : ""
    return stored || (feature ? LLM_FEATURE_DEFAULTS[feature] : "")
  }
  /** The effort an omitted one runs at on this node's model, if it has one. */
  const defaultFor = (data: Record<string, unknown>) => (feature ? defaultReasoningEffort(feature, modelOf(data)) : undefined)
  return {
    field: "reasoningEffort",
    ariaLabel: tx("node.effort"),
    icon: Gauge,
    sentinelUndefined: "auto",
    options: (data) => {
      // Lane-aware: Advanced mode runs the model on the vendor API, which
      // accepts a wider ladder than the aggregator. Reading the raw
      // `reasoningEfforts` here would hide levels the node can actually use
      // — and on gemini-3-flash would hide the control entirely.
      const levels = availableReasoningEfforts(modelOf(data), data.advancedMode === true)
      if (levels.length === 0) return []
      return [
        ...(defaultFor(data) === undefined ? [{ value: "auto", label: tx("common.auto") }] : []),
        ...levels.map((level) => ({ value: level, label: EFFORT_LABELS(llmPricingMode())[level] })),
      ]
    },
    ...(feature && {
      read: (data: Record<string, unknown>) =>
        typeof data.reasoningEffort === "string" ? data.reasoningEffort : (defaultFor(data) ?? ""),
      snap: (_value: string, data: Record<string, unknown>) => defaultFor(data) ?? "auto",
    }),
  }
}

/** Vision LLM model dropdown (writes `data.llmModel`). The describe-to-picker
 *  analyzer forces a schema over an image, so the strip offers exactly the
 *  vision models that can return guaranteed structured output and that the
 *  node offers — the shared {@link DESCRIBE_TO_PICKER_MODELS} list the route
 *  gate also enforces, so the picker and the gate can't drift. A stored model
 *  outside it (Claude Fable 5, withheld 2026-10-20) is snapped by the generic
 *  fail-safe to the first option — the default, see `snap` below. */
const visionModelControl = (): QuickConfigControl => ({
  field: "llmModel",
  ariaLabel: tx("field.model"),
  icon: Sparkles,
  options: orderedLlmModels(DESCRIBE_TO_PICKER_MODELS).map((m) => ({ value: m.id, label: m.displayName })),
  retainedOptions: retiredLlmOptions(DESCRIBE_TO_PICKER_MODELS),
  llmModelPrices: true,
  // A node with no stored model runs on the analyzer's default model — show
  // that, not whichever vision model happens to be listed first.
  defaultValue: LLM_FEATURE_DEFAULTS["describe-to-picker"],
  // A stale model the node no longer offers snaps to the analyzer's default,
  // the model the run would use anyway — not to the first listed vendor's —
  // and choosing or snapping to the default leaves the field UNSET: the
  // default is never stored (DescribeToPickerData), so a later default move
  // reaches the node, exactly as the config panel's clear does.
  snap: () => LLM_FEATURE_DEFAULTS["describe-to-picker"],
  write: (v) => ({ llmModel: v === LLM_FEATURE_DEFAULTS["describe-to-picker"] ? undefined : v }),
  // Same rationale as llmModelControl: a stranded advancedMode fails an
  // orchestrated run invisibly, so clear it on any model switch.
  additionalClear: ["advancedMode"],
})

// NOTE: the lists below mirror INLINE `<SelectItem>`s in the referenced config
// panels (not yet exported). Several are single-option today (others are
// commented out in the panel). Cleanup: lift each into `model-options.ts` and
// import in both places (as done for EXTEND_VIDEO_MODELS) to remove the mirror.

/** transcribe provider — mirrors audio-configs.tsx (~L887). */
const sttProviderControl = (): QuickConfigControl => ({
  field: "provider", ariaLabel: tx("field.provider"), icon: Sparkles,
  options: [{ value: "elevenlabs-stt", label: "ElevenLabs STT" }],
})
/** generate-music provider — mirrors music-config.tsx (~L75). */
const musicProviderControl = (): QuickConfigControl => ({
  field: "provider", ariaLabel: tx("field.provider"), icon: Sparkles,
  options: [{ value: "minimax", label: "MiniMax Music" }],
})
/** text-to-audio provider — mirrors audio-configs.tsx (~L229). */
const audioSfxProviderControl = (): QuickConfigControl => ({
  field: "provider", ariaLabel: tx("field.provider"), icon: Sparkles,
  options: [{ value: "elevenlabs-sfx", label: "ElevenLabs SFX v2" }],
})
/** voice-design model — mirrors audio-configs.tsx (~L1518). */
const voiceDesignModelControl = (): QuickConfigControl => ({
  field: "model", ariaLabel: tx("field.model"), icon: Sparkles,
  options: [
    { value: "eleven_multilingual_ttv_v2", label: "ElevenLabs Multilingual v2" },
    { value: "eleven_ttv_v3", label: "ElevenLabs v3" },
  ],
})
/** video-upscale provider — mirrors video-configs.tsx (~L1554, dynamic credit labels there). */
const videoUpscaleProviderControl = (): QuickConfigControl => ({
  field: "provider", ariaLabel: tx("field.provider"), icon: Sparkles,
  options: (_data) => withFreeVideoLocks([
    { value: "topaz", label: "Topaz" },
    { value: "veo-1080p", label: "VEO 1080p" },
    { value: "veo-4k", label: "VEO 4K" },
    { value: "seedance-2-5-hd", label: "Seedance 2.5 HD (from draft)" },
  ], (v, limits) => lockedVideoModel(limits, v)),
})
/** Video Depth levers. The valid set per provider comes from the shared
 *  contract (`videoDepthLevers` / `videoDepthColormaps`) — the same functions
 *  the config panel, the route and the payload builder read — so a provider
 *  without a lever returns `[]` and the strip hides it and clears the value. */
const videoDepthProviderOf = (data: Record<string, unknown>) => resolveVideoDepthProvider(data.provider)
const videoDepthSizeControl = (): QuickConfigControl => ({
  field: "modelSize", ariaLabel: tx("field.modelSize"), icon: Layers,
  options: VIDEO_DEPTH_MODEL_SIZES.map((v) => ({ value: v, label: tx(`vidcfg.depthSize.${v}`) })),
})
const videoDepthColormapControl = (): QuickConfigControl => ({
  field: "colormap", ariaLabel: tx("field.colormap"), icon: Palette,
  options: (data) => videoDepthColormaps(videoDepthProviderOf(data)).map((v) => ({ value: v, label: tx(`vidcfg.colormap.${v}`) })),
})
const videoDepthResolutionControl = (): QuickConfigControl => ({
  field: "resolution", ariaLabel: tx("field.resolution"), icon: Maximize2,
  options: (data) =>
    videoDepthLevers(videoDepthProviderOf(data)).has("resolution")
      ? VIDEO_DEPTH_RESOLUTIONS.map((v) => ({ value: v, label: v === "auto" ? tx("common.auto") : v }))
      : [],
})
const videoDepthSideBySideControl = (): QuickConfigControl => ({
  field: "sideBySide", ariaLabel: tx("field.sideBySide"), icon: LayoutGrid, boolean: true,
  options: (data) =>
    videoDepthLevers(videoDepthProviderOf(data)).has("sideBySide")
      ? [{ value: "false", label: tx("common.stateOff") }, { value: "true", label: tx("common.stateOn") }]
      : [],
})
/** Language dropdowns reuse the exported ALL_LANGUAGES list (no drift). */
const targetLanguageControl = (): QuickConfigControl => ({
  field: "targetLanguage", ariaLabel: tx("field.language"), icon: Languages, options: ALL_LANGUAGES,
})
const dialogueLanguageControl = (): QuickConfigControl => ({
  field: "languageCode", ariaLabel: tx("field.language"), icon: Languages, options: ALL_LANGUAGES,
})
/** Text to Dialogue model dropdown. The user's choice also snaps / clears what
 *  the new model does not take — exactly the panel's patch
 *  (`dialogueModelSwitchPatch`), so the two surfaces cannot disagree. The
 *  fail-safe snap calls `write` without data and writes the provider alone; an
 *  unset node shows v3 dialogue (what it runs as) without a write. */
const dialogueProviderControl = (): QuickConfigControl => ({
  field: "provider",
  ariaLabel: tx("field.model"),
  icon: Sparkles,
  options: toOptions(DIALOGUE_MODELS),
  defaultValue: DEFAULT_DIALOGUE_PROVIDER,
  write: (value, data) => ({ provider: value, ...dialogueModelSwitchPatch(value, (data ?? {}) as DialogueSwitchFields) }),
})
/** speech-to-video resolution — mirrors video-configs.tsx (dynamic credit labels there). */
const speechVideoResControl = (): QuickConfigControl => ({
  field: "resolution", ariaLabel: tx("field.resolution"), icon: Sparkles,
  options: [
    { value: "480p", label: "480p" },
    { value: "580p", label: "580p" },
    { value: "720p", label: "720p" },
  ],
})
/** face-swap provider — fixed to roop in the panel today. */
const faceSwapProviderControl = (): QuickConfigControl => ({
  field: "provider", ariaLabel: tx("field.provider"), icon: Sparkles,
  options: [{ value: "roop", label: "Roop" }],
})
/** video-to-video resolution. Provider-aware, three ways:
 *   - runway-aleph has no resolution lever (it uses an aspect-ratio control
 *     instead — see video-configs.tsx) → `[]`, so QuickConfigSelect hides the
 *     control AND clears the stale value.
 *   - the Seedance EDIT lane adds 480p, read straight off MODEL_CATALOG via
 *     `getVideoResolutionOptions` — the SAME source that panel's select and its
 *     fail-safe snap read, so the two can never drift.
 *   - every other route provider keeps V2V_RESOLUTION_OPTIONS (720p/1080p).
 *  A static superset here would be the Zod-reject trap CLAUDE.md calls out:
 *  480p written by the strip and then carried onto a Wan provider is rejected
 *  by the /v1/video-to-video enum at generate time. */
const v2vResolutionControl = (): QuickConfigControl => ({
  field: "v2vResolution", ariaLabel: tx("field.resolution"), icon: Sparkles,
  options: (data) => {
    const provider = typeof data.provider === "string" ? data.provider : "wan"
    if (provider === "runway-aleph") return []
    if (isSeedanceVideoEditProvider(provider)) return draftLockedResolutions(provider, data.draft, getVideoResolutionOptions(provider) ?? [])
    return toOptions(V2V_RESOLUTION_OPTIONS)
  },
})
/** A Seedance draft renders at 480p only: while Draft is on, the resolution
 *  lever offers just that (and the strip's snap moves a stale value onto it). */
export const draftLockedResolutions = (
  provider: string,
  draft: unknown,
  opts: ReadonlyArray<QuickConfigOption>,
): ReadonlyArray<QuickConfigOption> =>
  draft === true && isSeedanceDraftCapable(provider) ? opts.filter((o) => o.value === SEEDANCE_DRAFT_RESOLUTION) : opts
/** Seedance Draft lever (draft-capable models only — `[]` hides it and clears a
 *  stale flag). Turning it on also writes 480p into the node's resolution field,
 *  exactly like the config panel's toggle. */
export const seedanceDraftControl = (resolutionField: "resolution" | "v2vResolution", fallbackProvider: string): QuickConfigControl => ({
  field: "draft", ariaLabel: tx("vidcfg.seedanceDraft"), icon: Gauge,
  defaultValue: "full",
  read: (data) => (data.draft === true ? "draft" : data.draft === false ? "full" : ""),
  write: (value) => (value === "draft" ? { draft: true, [resolutionField]: SEEDANCE_DRAFT_RESOLUTION } : { draft: undefined }),
  options: (data) =>
    isSeedanceDraftCapable(typeof data.provider === "string" ? data.provider : fallbackProvider)
      ? [
          { value: "full", label: tx("vidcfg.seedanceDraftOff") },
          { value: "draft", label: tx("vidcfg.seedanceDraftShort") },
        ]
      : [],
})
/** cinematic-avatar duration (numeric, 4–15s). Provider-aware: when
 *  `data.autoDuration` is on, HeyGen picks the length, so there's no duration
 *  lever — return [] and QuickConfigSelect hides the control. preserveOnHide so
 *  the stored duration is kept and re-applied when auto-duration is turned off
 *  (matches the config panel, which hides the slider but keeps `data.duration`). */
const CINEMATIC_DURATION_OPTIONS: ReadonlyArray<QuickConfigOption> = Array.from(
  { length: 12 },
  (_, i) => ({ value: String(i + 4), label: `${i + 4}s` }),
)
const cinematicDurationControl = (): QuickConfigControl => ({
  field: "duration", ariaLabel: tx("field.duration"), numeric: true, preserveOnHide: true,
  options: (data) => (data.autoDuration === true ? [] : CINEMATIC_DURATION_OPTIONS),
})

/** generate-mask segmentation threshold (numeric — Grounded SAM confidence). */
/** generate-3d-scene aspect — the SAME COMPOSITION_RATIOS list the config
 *  panel renders (and the `/v1/3d-scene/generate` Zod enum accepts), labels
 *  compacted to the bare ratio for the pill. Deliberately NOT
 *  PRO3D_ASPECT_RATIOS: 21:9 is a 3D Render Pro capability this route refuses. */
const scene3dAspectControl = (): QuickConfigControl => ({
  field: "aspectRatio",
  ariaLabel: tx("node.aspect"),
  icon: Ratio,
  options: COMPOSITION_RATIOS.map((r) => ({ value: r.value, label: r.value })),
})

/** generate-3d-scene length — writes `durationSeconds` (the node's own field,
 *  not the video strip's `duration`). Presets cover the previz sweet spot and
 *  include the node default (4s); "Custom…" opens the slider/number popover
 *  for ANY value inside the route's SCENE3D_LIMITS bounds, so the strip can
 *  never offer a length the route rejects. */
const scene3dDurationControl = (): QuickConfigControl => ({
  field: "durationSeconds",
  ariaLabel: tx("field.duration"),
  icon: Clock,
  numeric: true,
  options: [2, 4, 6, 8, 10, 15, 20, 30].map((v) => ({ value: String(v), label: `${v}s` })),
  customRange: { min: SCENE3D_LIMITS.minDurationSeconds, max: SCENE3D_LIMITS.maxDurationSeconds, unit: "s" },
})

/** Suno Separate: vocals + instrumental, the full-stems split, or one
 *  instrument — the panel's modes, from the shared list (each prices
 *  differently; the run reads `type`). */
const sunoSeparateTypeControl = (): QuickConfigControl => ({
  field: "type", ariaLabel: tx("audiocfg.separationType"), icon: Layers,
  options: SUNO_SEPARATE_TYPES.map((type) => ({ value: type, label: tx(SUNO_SEPARATE_TYPE_LABEL_KEYS[type]) })),
})
/** Voice Changer / Voice Changer Pro speech-to-speech model — the shared list
 *  the panels render; an unset node runs the default model. */
const voiceChangerModelControl = (): QuickConfigControl => ({
  field: "model", ariaLabel: tx("field.model"), icon: Sparkles,
  options: VOICE_CHANGER_MODELS.map((m) => ({ value: m.value, label: m.label })),
  defaultValue: DEFAULT_VOICE_CHANGER_MODEL,
})
/** Audio Separation: mode + quality, exactly the panel's two selects. */
const audioSeparationQuickConfigs = (): ReadonlyArray<QuickConfigControl> => [
  {
    field: "mode", ariaLabel: tx("field.mode"), icon: Layers,
    options: [
      { value: "vocal_instrumental", label: tx("audiocfg.vocalInstrumental") },
      { value: "stems", label: tx("audiocfg.fullStems") },
    ],
  },
  {
    field: "quality", ariaLabel: tx("field.quality"), icon: Gauge,
    options: [
      { value: "auto", label: tx("audiocfg.phAuto") },
      { value: "fast", label: tx("audiocfg.fast") },
      { value: "best", label: tx("audiocfg.bestSlower") },
    ],
  },
]
/** Content Recipe / Content Ideas model — every LLM, as the panel's model
 *  select offers; an unset node runs the feature's default model. */
const contentModelControl = (feature: "content-recipe" | "content-ideas"): QuickConfigControl => ({
  ...llmModelControl(),
  defaultValue: LLM_FEATURE_DEFAULTS[feature],
})
/** Reference Board: model, then the aspect / resolution / quality the chosen
 *  model takes — the SAME per-model sources its config panel reads, so a model
 *  switch snaps a value the new model would reject. */
const referenceBoardProviderOf = (data: Record<string, unknown>): string =>
  typeof data.provider === "string" && data.provider ? data.provider : "gpt-image-2-5-sunburst"
const referenceBoardQuickConfigs = (): ReadonlyArray<QuickConfigControl> => [
  {
    field: "provider", ariaLabel: tx("field.model"), icon: Sparkles,
    options: toOptions(REFERENCE_BOARD_PROVIDER_OPTIONS),
  },
  {
    field: "aspectRatio", ariaLabel: tx("node.aspect"), icon: Ratio,
    options: (data) => toOptions(getAspectRatiosForModel(referenceBoardProviderOf(data))),
  },
  {
    field: "resolution", ariaLabel: tx("field.resolution"), icon: Maximize2,
    options: (data) => toOptions(IMAGE_RESOLUTION_OPTIONS[referenceBoardProviderOf(data)] ?? []),
  },
  {
    field: "quality", ariaLabel: tx("field.quality"), icon: Gauge,
    options: (data) => toOptions(IMAGE_QUALITY_OPTIONS[referenceBoardProviderOf(data)] ?? []),
  },
]

const maskThresholdControl = (): QuickConfigControl => ({
  field: "threshold", ariaLabel: tx("scriptcfg.threshold"), icon: Sparkles, numeric: true,
  options: [
    { value: "0.2", label: tx("node.thresholdLow") },
    { value: "0.3", label: tx("node.thresholdMed") },
    { value: "0.45", label: tx("node.thresholdHigh") },
  ],
})

/** video-mask detection threshold. Three presets around the shared default,
 *  plus "Custom…" for any value the panel slider can set — `customRange` (the
 *  route's own VIDEO_MASK_LIMITS bounds) also exempts in-range values from the
 *  stale-value snap, so the strip never overwrites a slider value. */
const videoMaskThresholdControl = (): QuickConfigControl => ({
  field: "threshold", ariaLabel: tx("scriptcfg.threshold"), icon: Sparkles, numeric: true,
  defaultValue: String(VIDEO_MASK_LIMITS.THRESHOLD_DEFAULT),
  options: [
    { value: "0.3", label: tx("node.thresholdLow") },
    { value: String(VIDEO_MASK_LIMITS.THRESHOLD_DEFAULT), label: tx("node.thresholdMed") },
    { value: "0.7", label: tx("node.thresholdHigh") },
  ],
  customRange: { min: VIDEO_MASK_LIMITS.THRESHOLD_MIN, max: VIDEO_MASK_LIMITS.THRESHOLD_MAX, step: VIDEO_MASK_LIMITS.THRESHOLD_STEP },
})

/** mask-composite's two enum levers — static lists straight from the shared
 *  enums (no provider lever), captions from the panel's own label maps. */
/** Background fit and Audio do nothing with a pixelate / blur fill (the background is the frame and
 *  the only sound), so both hide there — like the panel — keeping the stored value for the Video fill. */
const maskCompositeQuickConfigs = (): ReadonlyArray<QuickConfigControl> => {
  const fits = MASK_COMPOSITE_BACKGROUND_FITS.map((v) => ({ value: v, label: tx(MASK_COMPOSITE_FIT_LABEL_KEYS[v]) }))
  const sounds = MASK_COMPOSITE_AUDIO_SOURCES.map((v) => ({ value: v, label: tx(MASK_COMPOSITE_AUDIO_LABEL_KEYS[v]) }))
  const onVideoFill = (data: Record<string, unknown>) => maskCompositeUsesForeground(maskCompositeFillOf(data))
  return [
    {
      field: "backgroundFit", ariaLabel: tx("proccfg.maskCompositeBackgroundFit"), icon: Maximize2,
      defaultValue: MASK_COMPOSITE_DEFAULTS.backgroundFit,
      preserveOnHide: true,
      options: (data) => (onVideoFill(data) ? fits : []),
    },
    {
      field: "audioSource", ariaLabel: tx("proccfg.maskCompositeAudio"), icon: Volume2,
      defaultValue: MASK_COMPOSITE_DEFAULTS.audioSource,
      preserveOnHide: true,
      options: (data) => (onVideoFill(data) ? sounds : []),
    },
  ]
}

/** assemble-narrated-video's three ffmpeg-fit knobs. No provider lever exists
 *  on this node (pure ffmpeg logic — see assemble-narrated-video-config.tsx),
 *  so these are static option lists; every value is within the route's Zod
 *  bounds (voiceVolume/clipAudioVolume 0-200, maxSlowdown 1-2 — see
 *  backend/src/routes/assemble-narrated-video.ts), so the static-superset
 *  Zod-reject trap does not apply. trimStartFrames/trimEndFrames stay
 *  config-panel-only (fine-trim, not part of the quick-strip set). */
const ASSEMBLE_NARRATED_VIDEO_VOICE_VOLUME_OPTIONS: ReadonlyArray<QuickConfigOption> = [
  0, 25, 50, 75, 100, 125, 150, 200,
].map((v) => ({ value: String(v), label: `${v}%` }))
const ASSEMBLE_NARRATED_VIDEO_CLIP_VOLUME_OPTIONS: ReadonlyArray<QuickConfigOption> = [
  0, 10, 20, 30, 40, 60, 80, 100,
].map((v) => ({ value: String(v), label: `${v}%` }))
const ASSEMBLE_NARRATED_VIDEO_MAX_SLOWDOWN_OPTIONS: ReadonlyArray<QuickConfigOption> = [
  1, 1.1, 1.25, 1.5, 1.75, 2,
].map((v) => ({ value: String(v), label: `${v}×` }))

/** Sheet type / skin display keys — the SAME cfgext keys the config panel's
 *  TYPE_LABELS / SKIN_LABELS read. Exhaustive over SheetType / SheetSkin, so a
 *  new SHEET_TYPES / SHEET_SKINS entry is a compile error until it has a label. */
export const SHEET_TYPE_LABEL_KEYS: Readonly<Record<SheetType, MessageKey>> = {
  turnaround: "cfgext.refSheetTypeTurnaround",
  "variation-board": "cfgext.refSheetTypeVariationBoard",
  detail: "cfgext.refSheetTypeDetail",
  "full-reference": "cfgext.refSheetTypeFullReference",
}
export const SHEET_SKIN_LABEL_KEYS: Readonly<Record<SheetSkin, MessageKey>> = {
  studio: "cfgext.refSheetSkinStudio",
  cinematic: "cfgext.refSheetSkinCinematic",
  blueprint: "cfgext.refSheetSkinBlueprint",
  illustrated: "cfgext.refSheetSkinIllustrated",
}

/** A getter, not a module constant: option labels resolve through the live locale. */
export function NODE_QUICK_CONFIGS(): Readonly<Record<string, ReadonlyArray<QuickConfigControl>>> {
  return {
  // ── Speaker View: layout + switch, filtered by the wired edit (SV10) ──
  "speaker-view": speakerViewQuickConfigs(),
  // ── Generate Image (bespoke toolbar — model / aspect / resolution) ──
  "generate-image": [
    {
      field: "provider",
      ariaLabel: tx("field.model"),
      icon: Sparkles,
      // Clearing `providers` on change collapses multi-provider mode to single.
      additionalClear: ["providers"],
      options: toOptions(IMAGE_GEN_MODELS),
    },
    {
      field: "aspectRatio",
      ariaLabel: tx("node.aspect"),
      icon: Ratio,
      // Auto (keep a wired photo's shape) on every model; a stale ratio snaps to
      // the model's first LISTED ratio, never to that Auto tile.
      options: (data) => {
        const provider = typeof data.provider === "string" ? data.provider : IMAGE_MODEL_ROLE_DEFAULTS.general
        return getSourcePhotoAspectRatios(provider)
      },
      snap: (_value, data) => {
        const provider = typeof data.provider === "string" ? data.provider : IMAGE_MODEL_ROLE_DEFAULTS.general
        return getAspectRatiosForModel(provider)[0]?.value ?? "1:1"
      },
    },
    {
      field: "resolution",
      ariaLabel: tx("field.resolution"),
      icon: Maximize2,
      options: (data) => {
        const provider = typeof data.provider === "string" ? data.provider : IMAGE_MODEL_ROLE_DEFAULTS.general
        return IMAGE_RESOLUTION_OPTIONS[provider] ?? []
      },
    },
    {
      field: "repeatCount",
      ariaLabel: tx("node.runs"),
      // A cost multiplier (the run's price ×N): never a stranger's choice in an app.
      exposable: false,
      numeric: true,
      options: [
        { value: "1", label: "× 1" },
        { value: "2", label: "× 2" },
        { value: "3", label: "× 3" },
        { value: "4", label: "× 4" },
      ],
    },
  ],
  // ── Generate Video (bespoke toolbar — model / aspect / duration / resolution) ──
  "generate-video": [
    {
      field: "provider",
      ariaLabel: tx("field.model"),
      icon: Sparkles,
      options: (_data) => withFreeVideoLocks(toOptions(VIDEO_GEN_MODELS), (v, limits) => lockedVideoModel(limits, v)),
    },
    {
      field: "aspectRatio",
      ariaLabel: tx("node.aspect"),
      icon: Ratio,
      options: (data) => {
        const provider = typeof data.provider === "string" ? data.provider : "seedance-2-fast"
        return getAspectRatiosForVideoModel(provider)
      },
    },
    {
      field: "duration",
      ariaLabel: tx("field.duration"),
      icon: Clock,
      numeric: true,
      options: (data) => {
        const provider = typeof data.provider === "string" ? data.provider : "seedance-2-fast"
        return withFreeVideoLocks(
          getDurationsForVideoModel(provider).map((o) => ({ value: String(o.value), label: o.label })),
          (v, limits) => lockedVideoDuration(limits, provider, Number(v)),
        )
      },
    },
    {
      field: "resolution",
      ariaLabel: tx("field.resolution"),
      icon: Maximize2,
      options: (data) => {
        const provider = typeof data.provider === "string" ? data.provider : "seedance-2-fast"
        return withFreeVideoLocks(
          draftLockedResolutions(provider, data.draft, VIDEO_RESOLUTION_OPTIONS[provider] ?? []),
          (v, limits) => lockedVideoResolution(limits, provider, v),
        )
      },
    },
    seedanceDraftControl("resolution", "seedance-2-fast"),
    {
      field: "repeatCount",
      ariaLabel: tx("node.runs"),
      // A cost multiplier (the run's price ×N): never a stranger's choice in an app.
      exposable: false,
      numeric: true,
      options: [
        { value: "1", label: "× 1" },
        { value: "2", label: "× 2" },
        { value: "3", label: "× 3" },
        { value: "4", label: "× 4" },
      ],
    },
  ],
  // ── Generate Video Pro (model · aspect · duration · resolution — mirrors
  // generate-video's strip order; the config panel owns prompt/audio) ──
  "generate-video-pro": [
    {
      field: "provider",
      ariaLabel: tx("field.model"),
      icon: Sparkles,
      options: toOptions(GVP_PROVIDERS),
    },
    {
      field: "aspectRatio",
      ariaLabel: tx("node.aspect"),
      icon: Ratio,
      // PROVIDER-AWARE (2026-08-05): the pro node now offers models well past
      // the Seedance-2 family, and Seedance's set (21:9/4:3/3:4/adaptive) is a
      // strict superset of what VEO or Grok render. A static list here is the
      // Zod-reject trap CLAUDE.md calls out — it would let the strip write an
      // aspect the selected model rejects at generate time. Same source as the
      // config panel's selector + its fail-safe snap, so the two cannot drift.
      options: (data) =>
        getAspectRatiosForVideoModel(
          typeof data.provider === "string" ? data.provider : "seedance-2",
        ),
      // The runtime default (payload-builder/route both fall back to
      // "adaptive") sits LAST in the seedance list — without this the unset
      // trigger displayed the list's first entry ("16:9") instead.
      defaultValue: "adaptive",
    },
    {
      field: "duration",
      ariaLabel: tx("field.duration"),
      icon: Clock,
      numeric: true,
      // Long-form presets — the pro node spans 4–120s and splits into stitched
      // segments above 15s, so the single-segment catalog list
      // (getDurationsForVideoModel, 4–15s) is deliberately NOT used here.
      options: [8, 15, 20, 30, 45, 60, 90, 120].map((v) => ({ value: String(v), label: `${v}s` })),
      // "Custom…" → slider + number input popover for ANY 4–120s value (the
      // same pair the config panel's Duration field renders). In-range values
      // are exempt from the stale-value snap and label the trigger directly,
      // so a panel-slider value like 46s survives and displays.
      customRange: { min: 4, max: GENERATE_VIDEO_PRO_MAX_DURATION_FALLBACK, unit: "s" },
    },
    {
      field: "resolution",
      ariaLabel: tx("field.resolution"),
      icon: Maximize2,
      // Provider-aware: seedance-2 exposes 480p/720p/1080p/4k, fast/mini stop
      // at 720p. Same VIDEO_RESOLUTION_OPTIONS source the config panel's
      // fail-safe useEffect reads, so the two can't drift.
      options: (data) => {
        const provider = typeof data.provider === "string" ? data.provider : "seedance-2"
        return VIDEO_RESOLUTION_OPTIONS[provider] ?? []
      },
    },
  ],
  // ── Edit Video Pro (model only — no resolution lever, both are
  // source-derived by design; the config panel owns prompt/span/audio).
  // EVP_PROVIDERS, not GVP_PROVIDERS: EVP stays Seedance-only (minimax-h3 is
  // a generation-side blessing) ──
  "edit-video-pro": [
    {
      field: "provider",
      ariaLabel: tx("field.model"),
      icon: Sparkles,
      options: toOptions(EVP_PROVIDERS),
    },
  ],
  // ── Image Collage (layout · aspect · resolution · badges) ──
  // No provider/model — a local FFmpeg composite. Aspect values are single-sourced
  // from COMPOSITION_RATIOS (the same list the config panel renders) so the strip
  // and panel can't drift; labels are compacted to the bare ratio for the pill.
  "image-collage": [
    {
      field: "layout",
      ariaLabel: tx("proccfg.layout"),
      icon: LayoutGrid,
      options: [
        { value: "smart", label: tx("node.layoutSmart") },
        { value: "grid", label: tx("node.layoutGrid") },
      ],
    },
    {
      field: "aspectRatio",
      ariaLabel: tx("node.aspect"),
      icon: Ratio,
      options: COLLAGE_ASPECT_RATIOS.map((r) => ({ value: r.value, label: r.value })),
    },
    {
      field: "resolution",
      ariaLabel: tx("field.resolution"),
      icon: Maximize2,
      options: [
        { value: "2K", label: "2K" },
        { value: "4K", label: "4K" },
      ],
    },
    // Storyboard numbering as ONE choice — it projects two data fields
    // (`numbered` + `badgePosition`) so the strip stays one pill, while the
    // config panel keeps them as separate controls (the corner also applies to
    // labels-only badges). "None" only turns the numbers off: it leaves the
    // corner alone so any labels keep rendering where the user put them.
    {
      field: "badges",
      ariaLabel: tx("node.numbers"),
      icon: Hash,
      // A virtual field (a projection over `numbered` + `badgePosition`): an app
      // field must be a node-data key.
      exposable: false,
      options: [
        { value: "none", label: tx("common.none"), description: tx("node.noSequenceNumbers") },
        { value: "top-left", label: tx("node.topLeft"), description: tx("node.numbersTopLeftDesc") },
        { value: "top-right", label: tx("proccfg.topRight"), description: tx("node.numbersTopRightDesc") },
      ],
      read: (data) =>
        data.numbered === true ? (data.badgePosition === "top-right" ? "top-right" : "top-left") : "none",
      write: (v) =>
        v === "none"
          ? { numbered: undefined }
          : { numbered: true, badgePosition: v === "top-right" ? "top-right" : undefined },
    },
  ],
  // ── Video Overlay (output aspect only — every layer lever lives in the panel) ──
  // "Source" = no outputAspect: the video's own size and frame rate. The ratios
  // are the shared wire contract (VIDEO_OVERLAY_OUTPUT_ASPECTS, the panel's list
  // too), so the strip can never offer an aspect the route refuses. "Source"
  // clears baseFit and the padding colour WITH the aspect — exactly what the
  // panel's "Same as video" writes — because without an aspect they are refused
  // (fit_without_aspect, spec §3.5). Switching between two ratios keeps them.
  "video-overlay": [
    {
      field: "outputAspect",
      ariaLabel: tx("node.aspect"),
      icon: Ratio,
      options: [{ value: "source", label: "Source" }, ...VIDEO_OVERLAY_OUTPUT_ASPECTS.map((a) => ({ value: a, label: a }))],
      read: (data) => (typeof data.outputAspect === "string" && data.outputAspect !== "" ? data.outputAspect : "source"),
      write: (value) => (value === "source" ? { outputAspect: undefined, baseFit: undefined, backgroundColor: undefined } : { outputAspect: value }),
    },
  ],
  // ── Assemble Narrated Video (voice / ambient / max-slow — per original
  // design spec; trims stay config-panel-only) ──
  "assemble-narrated-video": [
    { field: "voiceVolume", ariaLabel: tx("node.voicePercent"), icon: Mic, numeric: true, options: ASSEMBLE_NARRATED_VIDEO_VOICE_VOLUME_OPTIONS },
    { field: "clipAudioVolume", ariaLabel: tx("node.ambientPercent"), icon: Volume2, numeric: true, options: ASSEMBLE_NARRATED_VIDEO_CLIP_VOLUME_OPTIONS },
    { field: "maxSlowdown", ariaLabel: tx("node.maxSlow"), icon: Gauge, numeric: true, options: ASSEMBLE_NARRATED_VIDEO_MAX_SLOWDOWN_OPTIONS },
  ],
  // `edit-image` / `image-to-image` are legacy types folded into `modify-image`
  // (not creatable, never mounted) — no quick-config entry; guard test enforces.
  "modify-image": [providerControl(MODIFY_IMAGE_MODELS, IMAGE_MODEL_ROLE_DEFAULTS.edit)],
  "upscale-image": [providerControl(UPSCALE_IMAGE_MODELS)],
  "video-to-video": [providerControl(VIDEO_V2V_MODELS, "wan"), v2vResolutionControl(), seedanceDraftControl("v2vResolution", "wan")],
  // SwitchX (Beeble) — mirrors Generate Video's strip: mode · keyframe (select-only)
  // · resolution · runs. The prompt button + Run come from NodeQuickStrip itself.
  "switchx": [
    {
      field: "alphaMode",
      ariaLabel: tx("node.mode"),
      icon: Wand2,
      options: [
        { value: "auto", label: tx("common.auto"), description: tx("node.alphaAutoDesc") },
        { value: "fill", label: tx("node.alphaFill"), description: tx("node.alphaFillDesc") },
        { value: "select", label: tx("common.select"), description: tx("node.youSupplyAMaskFor") },
        { value: "custom", label: tx("common.custom"), description: tx("node.youSupplyAFullPer") },
      ],
    },
    {
      field: "alphaKeyframeIndex",
      ariaLabel: tx("node.keyframe"),
      icon: Hash,
      numeric: true,
      // Only meaningful in select mode → return [] otherwise so QuickConfigSelect
      // hides the control AND clears the stale value (provider-sync trap fix).
      options: (data) =>
        data.alphaMode === "select"
          ? Array.from({ length: 10 }, (_, i) => ({ value: String(i), label: tx("node.frameN", { n: i }) }))
          : [],
    },
    {
      field: "maxResolution",
      ariaLabel: tx("field.resolution"),
      icon: Maximize2,
      numeric: true,
      options: [
        { value: "1080", label: "1080p" },
        { value: "720", label: "720p" },
      ],
    },
    {
      field: "repeatCount",
      ariaLabel: tx("node.runs"),
      // A cost multiplier (the run's price ×N): never a stranger's choice in an app.
      exposable: false,
      numeric: true,
      options: [
        { value: "1", label: "× 1" },
        { value: "2", label: "× 2" },
        { value: "3", label: "× 3" },
        { value: "4", label: "× 4" },
      ],
    },
  ],
  "extend-video": [providerControl(EXTEND_VIDEO_MODELS, "veo-extend")],
  "lip-sync": [providerControl(LIP_SYNC_MODELS, "kling-avatar")],
  "text-to-speech": [ttsProviderControl()],
  "motion-transfer": [providerControl(MOTION_TRANSFER_MODELS)],
  // ── Suno (model: SunoModel) ──
  "suno-generate": [sunoModelControl(), sunoInstrumentalControl(), sunoVocalControl()],
  "suno-cover": [sunoModelControl()],
  "suno-extend": [sunoModelControl()],
  "suno-mashup": [sunoModelControl()],
  "suno-upload-extend": [sunoModelControl()],
  "suno-add-instrumental": [sunoModelControl()],
  "suno-add-vocals": [sunoModelControl()],
  // Suno Separate's one lever is what it splits into. Lyrics, Style Boost, Replace
  // Section, Music Video and Convert to WAV take no model on the wire (KIE's
  // lyrics / boost-style / replace-section / mp4 / wav endpoints have none), so
  // they have no strip control: a model dropdown there moved nothing.
  "suno-separate": [sunoSeparateTypeControl()],
  // ── LLM-backed (llmModel) ──
  "generate-script": [llmModelControl(), reasoningEffortControl()],
  "qa-check": [llmModelControl(), reasoningEffortControl()],
  "image-to-text": [llmModelControl(), reasoningEffortControl()],
  "describe-to-picker": [visionModelControl(), reasoningEffortControl("describe-to-picker")],
  "image-critic": [llmModelControl(), reasoningEffortControl()],
  // forced-alignment is a fixed ElevenLabs feature (static "elevenlabs-forced-
  // alignment" credit id in forced-alignment-node.tsx) — ForcedAlignmentData
  // forced-alignment is deliberately ABSENT: it's a fixed-price ElevenLabs
  // feature — ForcedAlignmentData has no llmModel/reasoningEffort field, and a
  // model dropdown here wrote a field the node never reads.
  "motion-graphics": [llmModelControl(), reasoningEffortControl()],
  "3d-title": [llmModelControl(), reasoningEffortControl()],
  // Length + aspect sit on the strip like generate-image / generate-video —
  // they are the generation parameters a user reaches for on every run.
  "generate-3d-scene": [llmModelControl(), reasoningEffortControl(), scene3dAspectControl(), scene3dDurationControl()],
  "edit-3d-scene": [llmModelControl(), reasoningEffortControl()],
  // ── Audio / voice (inline-mirrored lists) ──
  "transcribe": [sttProviderControl()],
  // audio-isolation has no strip control: it runs one fixed model, and the
  // provider dropdown it used to show wrote a field the run never read.
  "generate-music": [musicProviderControl()],
  "text-to-audio": [audioSfxProviderControl()],
  "voice-design": [voiceDesignModelControl()],
  // voice-remix has no strip control: its endpoint takes no model, so the
  // model dropdown it used to show wrote a field the run never read.
  "video-upscale": [videoUpscaleProviderControl()],
  "video-depth": [providerControl(VIDEO_DEPTH_MODELS), videoDepthSizeControl(), videoDepthColormapControl(), videoDepthResolutionControl(), videoDepthSideBySideControl()],
  // ── Language / resolution (other dropdown configs) ──
  "dubbing": [targetLanguageControl()],
  // The speech-to-speech model (the run sends `model`); its old Language
  // dropdown wrote `targetLanguage`, which speech-to-speech does not take.
  "voice-changer": [voiceChangerModelControl()],
  "voice-changer-pro": [voiceChangerModelControl()],
  "audio-separation": audioSeparationQuickConfigs(),
  "content-recipe": [contentModelControl("content-recipe")],
  "content-ideas": [contentModelControl("content-ideas")],
  "reference-board": referenceBoardQuickConfigs(),
  "text-to-dialogue": [dialogueProviderControl(), dialogueLanguageControl()],
  "speech-to-video": [speechVideoResControl()],
  // ── Last holdouts (their only configurable field) ──
  "face-swap": [faceSwapProviderControl()],
  // remove-background has no strip control: one fixed model, and the motion
  // dropdown it used to show wrote a field the image node never declared or read.
  "generate-mask": [maskThresholdControl()],
  "video-mask": [videoMaskThresholdControl()],
  "mask-composite": maskCompositeQuickConfigs(),
  // ── Video Analysis — the two "how should this run" levers the config panel
  // exposes: Analysis quality (tier) + best-of-N Result selection. Both are
  // static enums (not provider-dependent), sourced from the SAME shared lists /
  // strings the panel renders so the strip and panel can't drift. `llmModel`
  // holds the TIER string (identical field the panel's quality <Select> writes);
  // `defaultValue: "pro"` makes an unset node show "Pro" without the strip
  // writing anything on mount (QuickConfigSelect skips the snap for unset
  // fields). The optional `analysisFocus` prompt stays reachable via the strip's
  // Prompt button (NODE_PROMPT_FIELDS); the translate-to-English toggles remain
  // in the config panel. Registering here also suppresses the fallback Settings
  // strip button. ──
  "video-analysis": [
    {
      field: "llmModel",
      ariaLabel: tx("vidcfg.analysisQuality"),
      icon: Gauge,
      defaultValue: DEFAULT_VIDEO_ANALYSIS_TIER,
      options: VIDEO_ANALYSIS_TIER_ORDER.map((t) => ({ value: t, label: VIDEO_ANALYSIS_TIER_LABELS[t] })),
    },
    {
      field: "selectionMode",
      ariaLabel: tx("vidcfg.resultSelection"),
      icon: Layers,
      defaultValue: "choose",
      options: [
        { value: "choose", label: tx("vidcfg.choose"), description: tx("node.keepTheStrongestPass") },
        { value: "combine", label: tx("vidcfg.combine"), description: tx("node.foldInEveryPass") },
      ],
    },
  ],
  // ── Reference Sheet — top-level `type` + `skin` (flat fields the strip can
  // address). `aspect`/`withText`/`showLabels` live under `flavour` (nested) so
  // they stay in the config panel. Registering entries also suppresses the
  // fallback "Settings" strip button (the node has its own on-body gear). ──
  "reference-sheet": [
    { field: "type", ariaLabel: tx("cfgext.refSheetSheetType"), icon: LayoutGrid, options: SHEET_TYPES.map((t) => ({ value: t, label: tx(SHEET_TYPE_LABEL_KEYS[t]) })) },
    { field: "skin", ariaLabel: tx("cfgext.refSheetSkinLabel"), icon: Palette, options: SHEET_SKINS.map((s) => ({ value: s, label: tx(SHEET_SKIN_LABEL_KEYS[s]) })) },
  ],
  // ── AI Avatar (HeyGen) ──
  "ai-avatar": [
    {
      // On-node source toggle (catalog avatar vs. raw image). Surfaced here so
      // users can flip to image mode without opening the config panel — the
      // Image input pip's disabled-gate (disabled={avatarSource!=="image"})
      // keys off this same field. Static list lifted to model-options.ts so the
      // panel Source radio and this toggle can't drift.
      field: "avatarSource",
      ariaLabel: tx("inputcfg.source"),
      icon: ImageIcon,
      options: AI_AVATAR_SOURCE_OPTIONS,
    },
    {
      field: "engine",
      ariaLabel: tx("node.engine"),
      icon: Sparkles,
      // Provider-aware: image-source mode has no IV/V engine lever (HeyGen's
      // type:"image" uses its own engine), so return [] there — QuickConfigSelect
      // then hides the control, matching the config panel which gates the engine
      // selector behind avatarSource==="avatar". Returning [] does NOT clear the
      // stored engine here because the engine value is preserved across modes
      // (the data type requires `engine`; image-mode billing pins to avatar-iv via
      // resolveAiAvatarCreditId regardless of the stored value).
      options: (data) =>
        data.avatarSource === "image" ? [] : AI_AVATAR_ENGINE_OPTIONS,
      preserveOnHide: true,
    },
    {
      // Resolution is per-engine but both engines share the same set today.
      // Provider-aware: if a future engine has no resolution lever, return []
      // and QuickConfigSelect hides + clears the stale value automatically.
      field: "resolution",
      ariaLabel: tx("field.resolution"),
      options: (data) =>
        (AI_AVATAR_RESOLUTION_OPTIONS[String(data.engine ?? "avatar-iv")] ??
         AI_AVATAR_RESOLUTION_OPTIONS["avatar-iv"]!) as ReadonlyArray<QuickConfigOption>,
    },
    {
      field: "speechMode",
      ariaLabel: tx("node.mode"),
      options: AI_AVATAR_SPEECH_MODES,
    },
  ],
  // ── Cinematic Avatar (HeyGen type:"cinematic_avatar") ──
  // Prompt-driven generative clip referencing 1–3 avatar looks. No engine /
  // speech / voice lever — just resolution, aspect ratio, and (optional)
  // duration. Option lists are the SAME CINEMATIC_* lists the config panel
  // renders, single-sourced from model-options.ts (mirrors the route Zod enums).
  "cinematic-avatar": [
    {
      field: "resolution",
      ariaLabel: tx("field.resolution"),
      options: CINEMATIC_RESOLUTION_OPTIONS,
    },
    {
      field: "aspectRatio",
      ariaLabel: tx("field.aspectRatio"),
      options: CINEMATIC_ASPECT_RATIO_OPTIONS,
    },
    cinematicDurationControl(),
  ],
  }
}

/** Quick-config controls for a node type (empty array when none registered). */
export function getQuickConfigs(nodeType: string | undefined): ReadonlyArray<QuickConfigControl> {
  return (nodeType && NODE_QUICK_CONFIGS()[nodeType]) || []
}

const NO_NODES: ReadonlyArray<WorkflowNode> = []
const NO_EDGES: ReadonlyArray<WorkflowEdge> = []

const ghostTriggerClass =
  "!h-6 !px-1.5 !gap-1 !border-0 !bg-transparent text-[11px] " +
  "text-neutral-900/85 hover:!bg-black/10 dark:text-white/85 dark:hover:!bg-white/10 " +
  "rounded-md min-w-0 w-auto whitespace-nowrap [&_svg]:!size-3 [&_svg]:opacity-70 " +
  "[&[data-state=open]]:bg-black/10 dark:[&[data-state=open]]:bg-white/10"

/** One inline ghost dropdown in the strip, bound to `data[control.field]`. */
export function QuickConfigSelect({
  nodeId,
  control,
  value,
  data,
  disabled,
  onOpenChange,
  wiredFrom,
}: {
  readonly nodeId: string
  readonly control: QuickConfigControl
  readonly value: string
  /** Full node data — drives provider-aware option lists (see {@link QuickConfigControl.options}). */
  readonly data: Record<string, unknown>
  readonly disabled?: boolean
  readonly onOpenChange?: (open: boolean) => void
  /** The label of the node that sets this field through a Settings input: the
   *  control shows its value, fixed, and never snaps the node's own field. */
  readonly wiredFrom?: string
}) {
  const t = useT()
  const localizeOption = useLocalizeOptionLabel()
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const [customOpen, setCustomOpen] = useState(false)
  // The Select trigger doubles as the popover ANCHOR (not a PopoverTrigger), so
  // Radix treats focus landing on it as "outside" — see onInteractOutside below.
  const anchorRef = useRef<HTMLSpanElement>(null)
  // The custom editor's open state MUST be counted by the host strip exactly
  // like the Select's: NodeQuickStrip pins the hover toolbar only while
  // `openCount > 0`, and choosing "Custom…" closes the Select (count → 0 a
  // macrotask later). Uncounted, the strip unpinned with the cursor still over
  // the just-closed menu, unmounted, and took the freshly opened popover with
  // it — the "shows for a second and hides" report (2026-09-16, verified with a
  // MutationObserver on staging). Reporting +1 here first keeps the count net
  // positive across the hand-off; the popover's own close reports the −1.
  const setCustomOpenCounted = (next: boolean) => {
    setCustomOpen(next)
    onOpenChange?.(next)
  }
  const Icon = control.icon
  // The graph is read only by a control that asks for it (Speaker View's
  // layouts); every other strip stays off the nodes/edges subscription.
  const graphNodes = useWorkflowStore((s) => (control.needsGraph ? s.nodes : NO_NODES))
  const graphEdges = useWorkflowStore((s) => (control.needsGraph ? s.edges : NO_EDGES))
  const ctx = useMemo<QuickConfigContext | undefined>(
    () => (control.needsGraph ? { nodeId, nodes: graphNodes, edges: graphEdges } : undefined),
    [control.needsGraph, nodeId, graphNodes, graphEdges],
  )
  // An option builder may word its labels by the server's LLM pricing mode (the
  // effort levels): re-resolved when an answer changes it.
  const pricingMode = useLlmPricingMode()
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const options = useMemo(() => resolveOptions(control, data, ctx), [control, data, ctx, pricingMode])
  // An LLM model control: each model's estimate beside it (metered pricing
  // only, D7), ONE batch for the list. A model switch here clears Advanced
  // (`additionalClear`), so only the current model is quoted with it.
  const llmNodeType = useWorkflowStore((s) => (control.llmModelPrices ? s.nodes?.find((n) => n.id === nodeId)?.type : undefined))
  const llmFeature = llmNodeType ? llmNodeFeature({ type: llmNodeType, data }) : undefined
  const llmOptionIds = useMemo(() => (llmFeature ? options.map((o) => o.value) : []), [llmFeature, options])
  const llmPrices = useLlmModelPrices(
    llmFeature ?? "",
    llmOptionIds,
    typeof data.reasoningEffort === "string" ? data.reasoningEffort : undefined,
    data.advancedMode === true,
    // The model the node runs now: the stored one, else its feature's default.
    llmFeature ? llmModelFor(llmFeature, typeof data.llmModel === "string" ? data.llmModel : undefined) : undefined,
  )
  const unitShort = t("credits.unitShort")
  const llmPriceOf = (value: string) => llmPickerPriceLabel(llmPrices.get(value), unitShort)
  const range = control.customRange
  const inRange = (v: string): boolean => isInQuickConfigRange(control, v)
  // Unset field → the control's declared default (e.g. gvp aspect "adaptive"),
  // both for the trigger label and for what reads as selected in the menu.
  const effectiveValue = value !== "" && value != null ? value : (control.defaultValue ?? "")

  // Fail-safe (mirrors the config panels' provider-change snap; valid set is
  // single-sourced from model-options): if the current provider invalidated
  // this field, snap a stale value to the first valid option, or clear it when
  // the provider has no such lever. Keeps the strip from leaving an
  // out-of-range value the route's Zod enum would reject. (For static option
  // lists `options` is a stable ref, so this only runs when `value` changes.)
  // A customRange control accepts ANY in-range numeric — never snap those.
  useEffect(() => {
    if (wiredFrom !== undefined) return
    // Hide-only fields (preserveOnHide) keep their stored value across modes;
    // others clear on hide to avoid an out-of-range value the route rejects.
    const patch = quickConfigSnapPatch(control, value, options, data, ctx)
    if (patch) updateNodeData(nodeId, patch)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, options, nodeId, control, updateNodeData, wiredFrom, data, ctx])

  // No lever for the current provider → render nothing (matches the panel,
  // which hides provider-irrelevant controls).
  if (options.length === 0) return null

  const current = options.find((o) => o.value === effectiveValue)
  const triggerLabel =
    current?.label ??
    // A retired value a saved node keeps (not listed, still runs) → its own name.
    quickConfigRetainedOption(control, effectiveValue)?.label ??
    // In-range custom numeric (customRange) → render it directly ("46s").
    (effectiveValue !== "" && inRange(effectiveValue) ? `${effectiveValue}${range?.unit ?? ""}` : undefined) ??
    // Fall back to the first option label when the field is unset — avoids
    // a blank dropdown when the node was created before this control existed.
    options[0]?.label ??
    effectiveValue
  const shownLabel = localizeOption(triggerLabel)
  const CUSTOM = "__custom__"
  const writeValue = (v: string) => updateNodeData(nodeId, quickConfigChoicePatch(control, v, data))
  const draft = inRange(effectiveValue) ? Number(effectiveValue) : range?.min ?? 0
  return (
    <Popover open={customOpen} onOpenChange={setCustomOpenCounted}>
      <PopoverAnchor asChild>
        <span ref={anchorRef} className="inline-flex">
          <Select
            value={current ? effectiveValue : undefined}
            onValueChange={(v) => {
              // The Custom… item never writes — it opens the slider+input
              // popover (the same pair the config panels' Duration field
              // renders) for any in-range manual value.
              if (v === CUSTOM) {
                setCustomOpenCounted(true)
                return
              }
              // A greyed row is explained, never chosen.
              if (options.find((o) => o.value === v)?.disabled) return
              writeValue(v)
            }}
            onOpenChange={onOpenChange}
            disabled={disabled || wiredFrom !== undefined}
          >
            <SelectTrigger className={ghostTriggerClass} aria-label={control.ariaLabel} title={wiredFrom !== undefined ? t("node.fromSource", { source: wiredFrom }) : control.ariaLabel}>
              {Icon && <Icon />}
              <SelectValue placeholder={shownLabel}>{shownLabel}</SelectValue>
            </SelectTrigger>
            <SelectContent className="node-menu-surface">
              {options.map((o) => {
                const price = llmPriceOf(o.value)
                const priceTag =
                  price ? <span className="ms-2 text-[11px] text-muted-foreground" data-testid={`quick-llm-price-${o.value}`}>{price}</span> : null
                // A greyed row explains itself in place of its description.
                const note = o.disabled ? o.reason : o.description
                return (
                  <SelectItem
                    key={o.value}
                    value={o.value}
                    className={o.disabled ? "text-xs opacity-60 cursor-not-allowed" : "text-xs"}
                    {...(o.disabled ? { "aria-disabled": true, title: o.reason } : {})}
                  >
                    {note ? (
                      <span className="flex flex-col gap-0.5">
                        <span>{localizeOption(o.label)}{priceTag}</span>
                        <span className="text-[11px] leading-tight text-muted-foreground">{note}</span>
                      </span>
                    ) : (
                      <>{localizeOption(o.label)}{priceTag}</>
                    )}
                  </SelectItem>
                )
              })}
              {range && (
                <SelectItem key={CUSTOM} value={CUSTOM} className="text-xs">
                  {t("node.customEllipsis")}
                </SelectItem>
              )}
            </SelectContent>
          </Select>
        </span>
      </PopoverAnchor>
      {range && (
        <PopoverContent
          side="bottom"
          align="start"
          sideOffset={6}
          className="node-menu-surface w-56 p-3"
          onOpenAutoFocus={(e) => e.preventDefault()}
          // Choosing "Custom…" closes the Select, which returns focus to its
          // trigger. That trigger lives inside PopoverAnchor, not PopoverTrigger,
          // so Radix's non-modal popover reads the focus-in as an OUTSIDE
          // interaction and dismissed the editor one frame after it opened
          // ("shows for a second and hides"). Anchor-internal interactions are
          // never "outside"; everything else (pane click, other controls) still
          // dismisses.
          onInteractOutside={(e) => {
            const target = e.target as Node | null
            if (target && anchorRef.current?.contains(target)) e.preventDefault()
          }}
        >
          <div className="flex flex-col gap-2">
            <span className="text-[11px] uppercase tracking-wide text-muted-foreground">
              {control.ariaLabel} — {range.min}–{range.max}
              {range.unit ?? ""}
            </span>
            <div className="flex items-center gap-2">
              <input
                type="range"
                min={range.min}
                max={range.max}
                step={range.step ?? 1}
                value={draft}
                onChange={(e) => writeValue(e.target.value)}
                className="flex-1 h-1.5 rounded-lg cursor-pointer accent-[#ff0073]"
                aria-label={t("node.customAria", { label: control.ariaLabel })}
              />
              {/* Commits on blur / Enter — clamping per keystroke made "12"
                  untypeable (the "1" snapped to the 4s floor first). */}
              <ClampedNumberInput
                min={range.min}
                max={range.max}
                step={range.step ?? 1}
                value={draft}
                onCommit={(n) => {
                  if (n !== undefined) writeValue(String(n))
                }}
                className="w-16 h-7 text-xs shrink-0"
                aria-label={t("node.customValueAria", { label: control.ariaLabel })}
              />
            </div>
          </div>
        </PopoverContent>
      )}
    </Popover>
  )
}
