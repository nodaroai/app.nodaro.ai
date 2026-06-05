"use client"

import { useEffect } from "react"
import type { LucideIcon } from "lucide-react"
import { Sparkles, Languages } from "lucide-react"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { useWorkflowStore } from "@/hooks/use-workflow-store"
import {
  MODIFY_IMAGE_MODELS,
  UPSCALE_IMAGE_MODELS,
  VIDEO_V2V_MODELS,
  V2V_RESOLUTION_OPTIONS,
  EXTEND_VIDEO_MODELS,
  LIP_SYNC_MODELS,
  TTS_MODELS,
  SUNO_MODELS,
  MOTION_TRANSFER_MODELS,
  AI_AVATAR_ENGINE_OPTIONS,
  AI_AVATAR_RESOLUTION_OPTIONS,
  AI_AVATAR_SPEECH_MODES,
} from "@/components/editor/config-panels/model-options"
import { LLM_MODELS } from "@nodaro/shared"
import { ALL_LANGUAGES } from "@/lib/audio-tags"

/**
 * Data-driven quick-config controls for {@link NodeQuickStrip}. Each AI node
 * type maps to the inline dropdown(s) shown between the Prompt button and Run
 * (the "configurations" middle of the strip). Options reuse the SAME lists the
 * full config panels use (`model-options.ts`), so they can't drift.
 */
export interface QuickConfigOption {
  readonly value: string
  readonly label: string
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
    | ((data: Record<string, unknown>) => ReadonlyArray<QuickConfigOption>)
  /** Write the chosen value as a number (option values are strings). */
  readonly numeric?: boolean
  /** When `true`, returning `[]` from {@link options} HIDES the control WITHOUT
   *  clearing the stored value. Use for fields whose value is preserved across
   *  modes and re-applied when the lever returns (e.g. ai-avatar `engine`: hidden
   *  in image-source mode but the data type still requires it, and billing pins
   *  to a neutral rate regardless). Default behaviour (flag absent) clears the
   *  field on hide — the provider-sync trap fix for enum fields like
   *  v2v-resolution. */
  readonly preserveOnHide?: boolean
}

/** Resolve a control's options against the node's current data. */
function resolveOptions(
  control: QuickConfigControl,
  data: Record<string, unknown>,
): ReadonlyArray<QuickConfigOption> {
  return typeof control.options === "function" ? control.options(data) : control.options
}

const toOptions = (
  list: ReadonlyArray<{ readonly value: string | number; readonly label: string }>,
): QuickConfigOption[] => list.map((o) => ({ value: String(o.value), label: o.label }))

/** A provider/model dropdown writing `data.provider`. */
const providerControl = (
  list: ReadonlyArray<{ readonly value: string | number; readonly label: string }>,
): QuickConfigControl => ({
  field: "provider",
  ariaLabel: "Model",
  icon: Sparkles,
  options: toOptions(list),
})

/** Suno model dropdown (writes `data.model`), shared by all Suno nodes that
 *  carry a `model: SunoModel`. */
const sunoModelControl: QuickConfigControl = {
  field: "model",
  ariaLabel: "Model",
  icon: Sparkles,
  options: toOptions(SUNO_MODELS),
}

/** LLM model dropdown (writes `data.llmModel`), shared by the LLM-backed nodes.
 *  LLM_MODELS uses `id`/`displayName`. */
const llmModelControl: QuickConfigControl = {
  field: "llmModel",
  ariaLabel: "Model",
  icon: Sparkles,
  options: LLM_MODELS.map((m) => ({ value: m.id, label: m.displayName })),
}

// NOTE: the lists below mirror INLINE `<SelectItem>`s in the referenced config
// panels (not yet exported). Several are single-option today (others are
// commented out in the panel). Cleanup: lift each into `model-options.ts` and
// import in both places (as done for EXTEND_VIDEO_MODELS) to remove the mirror.

/** transcribe / audio-isolation provider — mirrors audio-configs.tsx (~L887). */
const sttProviderControl: QuickConfigControl = {
  field: "provider", ariaLabel: "Provider", icon: Sparkles,
  options: [{ value: "elevenlabs-stt", label: "ElevenLabs STT" }],
}
/** generate-music provider — mirrors music-config.tsx (~L75). */
const musicProviderControl: QuickConfigControl = {
  field: "provider", ariaLabel: "Provider", icon: Sparkles,
  options: [{ value: "minimax", label: "MiniMax Music" }],
}
/** text-to-audio provider — mirrors audio-configs.tsx (~L229). */
const audioSfxProviderControl: QuickConfigControl = {
  field: "provider", ariaLabel: "Provider", icon: Sparkles,
  options: [{ value: "elevenlabs-sfx", label: "ElevenLabs SFX v2" }],
}
/** voice-design / voice-remix model — mirrors audio-configs.tsx (~L1518). */
const voiceDesignModelControl: QuickConfigControl = {
  field: "model", ariaLabel: "Model", icon: Sparkles,
  options: [
    { value: "eleven_multilingual_ttv_v2", label: "ElevenLabs Multilingual v2" },
    { value: "eleven_ttv_v3", label: "ElevenLabs v3" },
  ],
}
/** video-upscale provider — mirrors video-configs.tsx (~L1554, dynamic credit labels there). */
const videoUpscaleProviderControl: QuickConfigControl = {
  field: "provider", ariaLabel: "Provider", icon: Sparkles,
  options: [
    { value: "topaz", label: "Topaz" },
    { value: "veo-1080p", label: "VEO 1080p" },
    { value: "veo-4k", label: "VEO 4K" },
  ],
}
/** Language dropdowns reuse the exported ALL_LANGUAGES list (no drift). */
const targetLanguageControl: QuickConfigControl = {
  field: "targetLanguage", ariaLabel: "Language", icon: Languages, options: ALL_LANGUAGES,
}
const dialogueLanguageControl: QuickConfigControl = {
  field: "languageCode", ariaLabel: "Language", icon: Languages, options: ALL_LANGUAGES,
}
/** speech-to-video resolution — mirrors video-configs.tsx (dynamic credit labels there). */
const speechVideoResControl: QuickConfigControl = {
  field: "resolution", ariaLabel: "Resolution", icon: Sparkles,
  options: [
    { value: "480p", label: "480p" },
    { value: "580p", label: "580p" },
    { value: "720p", label: "720p" },
  ],
}
/** face-swap provider — fixed to roop in the panel today. */
const faceSwapProviderControl: QuickConfigControl = {
  field: "provider", ariaLabel: "Provider", icon: Sparkles,
  options: [{ value: "roop", label: "Roop" }],
}
/** remove-background motion (enum field on the node data). */
const removeBgMotionControl: QuickConfigControl = {
  field: "motion", ariaLabel: "Motion", icon: Sparkles,
  options: [
    { value: "subtle", label: "Subtle" },
    { value: "moderate", label: "Moderate" },
    { value: "dynamic", label: "Dynamic" },
  ],
}
/** video-to-video resolution. Provider-aware: runway-aleph has no resolution
 *  lever (it uses an aspect-ratio control instead — see video-configs.tsx), so
 *  return `[]` there and QuickConfigSelect hides + clears the field. Options are
 *  the SAME V2V_RESOLUTION_OPTIONS the panel renders, so they can't drift. */
const v2vResolutionControl: QuickConfigControl = {
  field: "v2vResolution", ariaLabel: "Resolution", icon: Sparkles,
  options: (data) => (data.provider === "runway-aleph" ? [] : toOptions(V2V_RESOLUTION_OPTIONS)),
}
/** generate-mask segmentation threshold (numeric — Grounded SAM confidence). */
const maskThresholdControl: QuickConfigControl = {
  field: "threshold", ariaLabel: "Threshold", icon: Sparkles, numeric: true,
  options: [
    { value: "0.2", label: "Threshold: Low" },
    { value: "0.3", label: "Threshold: Med" },
    { value: "0.45", label: "Threshold: High" },
  ],
}

export const NODE_QUICK_CONFIGS: Readonly<Record<string, ReadonlyArray<QuickConfigControl>>> = {
  // `edit-image` / `image-to-image` are legacy types folded into `modify-image`
  // (not creatable, never mounted) — no quick-config entry; guard test enforces.
  "modify-image": [providerControl(MODIFY_IMAGE_MODELS)],
  "upscale-image": [providerControl(UPSCALE_IMAGE_MODELS)],
  "video-to-video": [providerControl(VIDEO_V2V_MODELS), v2vResolutionControl],
  "extend-video": [providerControl(EXTEND_VIDEO_MODELS)],
  "lip-sync": [providerControl(LIP_SYNC_MODELS)],
  "text-to-speech": [providerControl(TTS_MODELS)],
  "motion-transfer": [providerControl(MOTION_TRANSFER_MODELS)],
  // ── Suno (model: SunoModel) ──
  "suno-generate": [sunoModelControl],
  "suno-cover": [sunoModelControl],
  "suno-extend": [sunoModelControl],
  "suno-music-video": [sunoModelControl],
  "suno-mashup": [sunoModelControl],
  "suno-convert-wav": [sunoModelControl],
  "suno-upload-extend": [sunoModelControl],
  "suno-add-instrumental": [sunoModelControl],
  "suno-add-vocals": [sunoModelControl],
  "suno-lyrics": [sunoModelControl],
  "suno-separate": [sunoModelControl],
  "suno-replace-section": [sunoModelControl],
  "suno-style-boost": [sunoModelControl],
  // ── LLM-backed (llmModel) ──
  "generate-script": [llmModelControl],
  "qa-check": [llmModelControl],
  "image-to-text": [llmModelControl],
  "image-critic": [llmModelControl],
  "forced-alignment": [llmModelControl],
  "motion-graphics": [llmModelControl],
  "3d-title": [llmModelControl],
  // ── Audio / voice (inline-mirrored lists) ──
  "transcribe": [sttProviderControl],
  "audio-isolation": [sttProviderControl],
  "generate-music": [musicProviderControl],
  "text-to-audio": [audioSfxProviderControl],
  "voice-design": [voiceDesignModelControl],
  "voice-remix": [voiceDesignModelControl],
  "video-upscale": [videoUpscaleProviderControl],
  // ── Language / resolution (other dropdown configs) ──
  "dubbing": [targetLanguageControl],
  "voice-changer": [targetLanguageControl],
  "text-to-dialogue": [dialogueLanguageControl],
  "speech-to-video": [speechVideoResControl],
  // ── Last holdouts (their only configurable field) ──
  "face-swap": [faceSwapProviderControl],
  "remove-background": [removeBgMotionControl],
  "generate-mask": [maskThresholdControl],
  // ── AI Avatar (HeyGen) ──
  "ai-avatar": [
    {
      field: "engine",
      ariaLabel: "Engine",
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
      ariaLabel: "Resolution",
      options: (data) =>
        (AI_AVATAR_RESOLUTION_OPTIONS[String(data.engine ?? "avatar-iv")] ??
         AI_AVATAR_RESOLUTION_OPTIONS["avatar-iv"]!) as ReadonlyArray<QuickConfigOption>,
    },
    {
      field: "speechMode",
      ariaLabel: "Mode",
      options: AI_AVATAR_SPEECH_MODES,
    },
  ],
}

/** Quick-config controls for a node type (empty array when none registered). */
export function getQuickConfigs(nodeType: string | undefined): ReadonlyArray<QuickConfigControl> {
  return (nodeType && NODE_QUICK_CONFIGS[nodeType]) || []
}

const ghostTriggerClass =
  "!h-6 !px-1.5 !gap-1 !border-0 !bg-transparent text-[10px] " +
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
}: {
  readonly nodeId: string
  readonly control: QuickConfigControl
  readonly value: string
  /** Full node data — drives provider-aware option lists (see {@link QuickConfigControl.options}). */
  readonly data: Record<string, unknown>
  readonly disabled?: boolean
  readonly onOpenChange?: (open: boolean) => void
}) {
  const updateNodeData = useWorkflowStore((s) => s.updateNodeData)
  const Icon = control.icon
  const options = resolveOptions(control, data)

  // Fail-safe (mirrors the config panels' provider-change snap; valid set is
  // single-sourced from model-options): if the current provider invalidated
  // this field, snap a stale value to the first valid option, or clear it when
  // the provider has no such lever. Keeps the strip from leaving an
  // out-of-range value the route's Zod enum would reject. (For static option
  // lists `options` is a stable ref, so this only runs when `value` changes.)
  useEffect(() => {
    if (value === "" || value == null) return
    if (options.length === 0) {
      // Hide-only fields (preserveOnHide) keep their stored value across modes;
      // others clear on hide to avoid an out-of-range value the route rejects.
      if (!control.preserveOnHide) {
        updateNodeData(nodeId, { [control.field]: undefined })
      }
    } else if (!options.some((o) => o.value === value)) {
      const next = options[0].value
      updateNodeData(nodeId, { [control.field]: control.numeric ? Number(next) : next })
    }
  }, [value, options, nodeId, control, updateNodeData])

  // No lever for the current provider → render nothing (matches the panel,
  // which hides provider-irrelevant controls).
  if (options.length === 0) return null

  const current = options.find((o) => o.value === value)
  return (
    <Select
      value={value || undefined}
      onValueChange={(v) => updateNodeData(nodeId, { [control.field]: control.numeric ? Number(v) : v })}
      onOpenChange={onOpenChange}
      disabled={disabled}
    >
      <SelectTrigger className={ghostTriggerClass} aria-label={control.ariaLabel} title={control.ariaLabel}>
        {Icon && <Icon />}
        <SelectValue>{current?.label ?? value}</SelectValue>
      </SelectTrigger>
      <SelectContent className="node-menu-surface">
        {options.map((o) => (
          <SelectItem key={o.value} value={o.value} className="text-xs">
            {o.label}
          </SelectItem>
        ))}
      </SelectContent>
    </Select>
  )
}
