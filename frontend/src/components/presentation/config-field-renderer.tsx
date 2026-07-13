import { useEffect, useRef } from "react"
import {
  IMAGE_GEN_MODELS,
  VIDEO_T2V_MODELS,
  VIDEO_GEN_MODELS,
  GVP_PROVIDERS,
  IMAGE_STYLE_PRESETS,
  getAspectRatiosForModel,
  getAspectRatiosForVideoModel,
  getVideoResolutionOptions,
  IMAGE_QUALITY_OPTIONS,
  IMAGE_RESOLUTION_OPTIONS,
  VIDEO_RATIOS,
} from "@/components/editor/config-panels/model-options"
// Single source of truth for the duration-slider cap — defined once in the
// config panel (frontend/src/components/editor/config-panels/video-configs.tsx)
// and imported here so the two never drift.
import { GENERATE_VIDEO_PRO_MAX_DURATION_FALLBACK } from "@/components/editor/config-panels/video-configs"
import { AspectRatioSelector } from "@/components/editor/config-panels/aspect-ratio-selector"
import { GlassCard } from "./output-cards/shared"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import { Switch } from "@/components/ui/switch"
import { Textarea } from "@/components/ui/textarea"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { cn } from "@/lib/utils"
import type { WorkflowNode } from "@/types/nodes"
import { FieldInputCard } from "./field-input-card"
import { findExposableField } from "./helpers"

interface ConfigFieldRendererProps {
  nodeType: string
  field: string
  value: unknown
  nodeData: Record<string, unknown>
  onChange: (value: unknown) => void
  allowedValues?: Array<string | number | boolean>
  readOnly?: boolean
  customLabel?: string
}

const LABEL_CLS =
  "text-xs font-medium text-muted-foreground uppercase tracking-wider"

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

type OptionEntry = { value: string; label: string; desc?: string }

// ---------------------------------------------------------------------------
// Auto-reset hook: when current value is not in available options, reset to first valid.
// Called unconditionally at top level of the sub-components that need it.
// ---------------------------------------------------------------------------

function useAutoReset(
  value: unknown,
  options: readonly { value: string }[],
  onChange: (v: unknown) => void,
  enabled = true,
) {
  const onChangeRef = useRef(onChange)
  onChangeRef.current = onChange

  useEffect(() => {
    if (!enabled || options.length === 0) return
    const str = String(value ?? "")
    if (!options.some((o) => o.value === str)) {
      onChangeRef.current(options[0].value)
    }
  }, [value, options, enabled])
}

// ---------------------------------------------------------------------------
// Sub-components — each one is a proper React component with hooks at top level
// ---------------------------------------------------------------------------

function AspectRatioField({
  label,
  options,
  value,
  onChange,
  allowedValues,
  readOnly,
  autoReset,
}: {
  label: string
  options: readonly { value: string; label: string }[]
  value: unknown
  onChange: (v: unknown) => void
  allowedValues?: Array<string | number | boolean>
  readOnly?: boolean
  autoReset?: boolean
}) {
  const filtered = allowedValues
    ? options.filter((o) =>
        allowedValues.some((av) => String(av) === o.value),
      )
    : options

  useAutoReset(value, filtered, onChange, autoReset ?? false)

  const strValue = String(value ?? "")

  return (
    <GlassCard>
      <Label className={cn(LABEL_CLS, "mb-2 block")}>{label}</Label>
      <div className={cn(readOnly && "opacity-70 pointer-events-none")}>
        <AspectRatioSelector
          options={filtered}
          value={strValue}
          onValueChange={(v) => onChange(v)}
        />
      </div>
    </GlassCard>
  )
}

function SliderField({
  label,
  value,
  onChange,
  min,
  max,
  step,
  readOnly,
}: {
  label: string
  value: unknown
  onChange: (v: unknown) => void
  min: number
  max: number
  step: number
  readOnly?: boolean
}) {
  const numValue = Number(value ?? min)

  return (
    <GlassCard>
      <div className="flex items-center justify-between mb-2">
        <Label className={LABEL_CLS}>{label}</Label>
        <span className="text-xs text-muted-foreground tabular-nums">
          {numValue}
        </span>
      </div>
      <div className="flex items-center gap-2">
        <input
          type="range"
          min={min}
          max={max}
          step={step}
          value={numValue}
          onChange={(e) => onChange(parseFloat(e.target.value))}
          disabled={readOnly}
          className={cn("flex-1", readOnly && "opacity-70 cursor-default")}
        />
      </div>
    </GlassCard>
  )
}

/** Plain numeric input (as opposed to SliderField's range control) — used for
 *  fields with no natural fixed upper bound (e.g. edit-video-pro's span
 *  endpoints, which can legitimately exceed 120s for a long source video).
 *  Optional `helpText` renders a small muted caveat below the input. */
function NumberField({
  label,
  value,
  onChange,
  min,
  step,
  readOnly,
  helpText,
}: {
  label: string
  value: unknown
  onChange: (v: unknown) => void
  min?: number
  step?: number
  readOnly?: boolean
  helpText?: string
}) {
  const numValue = Number(value ?? min ?? 0)

  return (
    <GlassCard>
      <Label className={cn(LABEL_CLS, "mb-2 block")}>{label}</Label>
      <Input
        type="number"
        min={min}
        step={step ?? 0.1}
        value={numValue}
        onChange={(e) => {
          if (e.target.value === "") return
          const parsed = parseFloat(e.target.value)
          if (Number.isNaN(parsed)) return
          onChange(min !== undefined ? Math.max(min, parsed) : parsed)
        }}
        disabled={readOnly}
        className={cn(readOnly && "opacity-70 cursor-default")}
      />
      {helpText && (
        <p className="mt-2 text-[11px] leading-snug text-muted-foreground">
          {helpText}
        </p>
      )}
    </GlassCard>
  )
}

function ToggleField({
  label,
  value,
  onChange,
  readOnly,
}: {
  label: string
  value: unknown
  onChange: (v: unknown) => void
  readOnly?: boolean
}) {
  const checked = Boolean(value)

  return (
    <GlassCard>
      <div className="flex items-center justify-between">
        <Label className={LABEL_CLS}>{label}</Label>
        <Switch
          checked={checked}
          onCheckedChange={(v) => onChange(v)}
          disabled={readOnly}
          className={cn(readOnly && "opacity-70 cursor-default")}
        />
      </div>
    </GlassCard>
  )
}

function TextareaField({
  label,
  value,
  onChange,
  readOnly,
}: {
  label: string
  value: unknown
  onChange: (v: unknown) => void
  readOnly?: boolean
}) {
  const strValue = String(value ?? "")

  return (
    <GlassCard>
      <Label className={cn(LABEL_CLS, "mb-2 block")}>{label}</Label>
      <Textarea
        value={strValue}
        onChange={(e) => onChange(e.target.value)}
        placeholder={`Enter ${label.toLowerCase()}...`}
        readOnly={readOnly}
        className={cn(
          "min-h-[72px] resize-none",
          readOnly && "opacity-70 cursor-default",
        )}
      />
    </GlassCard>
  )
}

function OptionSelect({
  label,
  options,
  value,
  onChange,
  allowedValues,
  readOnly,
  autoReset,
  showDesc,
}: {
  label: string
  options: readonly OptionEntry[]
  value: unknown
  onChange: (v: unknown) => void
  allowedValues?: Array<string | number | boolean>
  readOnly?: boolean
  autoReset?: boolean
  showDesc?: boolean
}) {
  const filtered = allowedValues
    ? options.filter((o) =>
        allowedValues.some((av) => String(av) === o.value),
      )
    : options

  useAutoReset(value, filtered, onChange, autoReset ?? false)

  const strValue = String(value ?? "")

  return (
    <GlassCard>
      <Label className={cn(LABEL_CLS, "mb-2 block")}>{label}</Label>
      <Select
        value={strValue}
        onValueChange={(v) => onChange(v)}
        disabled={readOnly}
      >
        <SelectTrigger
          className={cn("w-full", readOnly && "opacity-70 cursor-default")}
          aria-label={label}
        >
          <SelectValue placeholder={`Select ${label.toLowerCase()}...`} />
        </SelectTrigger>
        <SelectContent>
          {filtered.map((opt) => (
            <SelectItem key={opt.value} value={opt.value}>
              <span>{opt.label}</span>
              {showDesc && opt.desc && (
                <span className="ml-1.5 text-xs text-muted-foreground">
                  - {opt.desc}
                </span>
              )}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </GlassCard>
  )
}

// ---------------------------------------------------------------------------
// Node-specific renderers — dispatch to sub-components that may use hooks.
// Auto-reset is handled by the sub-components via the autoReset prop.
// ---------------------------------------------------------------------------

function renderGenerateImage(
  props: ConfigFieldRendererProps,
): React.ReactNode | null {
  const { field, value, nodeData, onChange, allowedValues, readOnly, customLabel } = props
  const provider = String(nodeData.provider ?? "")

  switch (field) {
    case "provider":
      return (
        <OptionSelect
          label={customLabel ?? "Model"}
          options={IMAGE_GEN_MODELS}
          value={value}
          onChange={onChange}
          allowedValues={allowedValues}
          readOnly={readOnly}
          showDesc
        />
      )
    case "aspectRatio":
      return (
        <AspectRatioField
          label={customLabel ?? "Aspect Ratio"}
          options={getAspectRatiosForModel(provider)}
          value={value}
          onChange={onChange}
          allowedValues={allowedValues}
          readOnly={readOnly}
          autoReset
        />
      )
    case "quality": {
      const qualityOpts = IMAGE_QUALITY_OPTIONS[provider]
      if (!qualityOpts) return null
      return (
        <OptionSelect
          label={customLabel ?? "Quality"}
          options={qualityOpts}
          value={value}
          onChange={onChange}
          allowedValues={allowedValues}
          readOnly={readOnly}
          autoReset
        />
      )
    }
    case "resolution": {
      const resOpts = IMAGE_RESOLUTION_OPTIONS[provider]
      if (!resOpts) return null
      return (
        <OptionSelect
          label={customLabel ?? "Resolution"}
          options={resOpts}
          value={value}
          onChange={onChange}
          allowedValues={allowedValues}
          readOnly={readOnly}
          autoReset
        />
      )
    }
    case "style": {
      const styleOptions: readonly OptionEntry[] = [
        { value: "__none__", label: "None" },
        ...IMAGE_STYLE_PRESETS.map((s) => ({ value: s.value, label: s.label })),
      ]
      return (
        <OptionSelect
          label={customLabel ?? "Style"}
          options={styleOptions}
          value={value === "" ? "__none__" : value}
          onChange={(v) => onChange(v === "__none__" ? "" : v)}
          allowedValues={allowedValues}
          readOnly={readOnly}
        />
      )
    }
    case "negativePrompt":
      return (
        <TextareaField
          label={customLabel ?? "Negative Prompt"}
          value={value}
          onChange={onChange}
          readOnly={readOnly}
        />
      )
    default:
      return null
  }
}

function renderTextToVideo(
  props: ConfigFieldRendererProps,
): React.ReactNode | null {
  const { field, value, onChange, allowedValues, readOnly, customLabel } = props

  switch (field) {
    case "provider":
      return (
        <OptionSelect
          label={customLabel ?? "Model"}
          options={VIDEO_T2V_MODELS}
          value={value}
          onChange={onChange}
          allowedValues={allowedValues}
          readOnly={readOnly}
          showDesc
        />
      )
    case "aspectRatio":
      return (
        <AspectRatioField
          label={customLabel ?? "Aspect Ratio"}
          options={VIDEO_RATIOS}
          value={value}
          onChange={onChange}
          allowedValues={allowedValues}
          readOnly={readOnly}
          autoReset
        />
      )
    case "motion":
      return (
        <SliderField
          label={customLabel ?? "Motion Amount"}
          value={value}
          onChange={onChange}
          min={1}
          max={255}
          step={1}
          readOnly={readOnly}
        />
      )
    case "generateAudio":
      return (
        <ToggleField
          label={customLabel ?? "Generate Audio"}
          value={value}
          onChange={onChange}
          readOnly={readOnly}
        />
      )
    default:
      return null
  }
}

function renderGenerateVideo(
  props: ConfigFieldRendererProps,
): React.ReactNode | null {
  const { field, value, onChange, allowedValues, readOnly, customLabel } = props

  switch (field) {
    case "provider":
      return (
        <OptionSelect
          label={customLabel ?? "Model"}
          options={VIDEO_GEN_MODELS}
          value={value}
          onChange={onChange}
          allowedValues={allowedValues}
          readOnly={readOnly}
          showDesc
        />
      )
    case "aspectRatio":
      return (
        <AspectRatioField
          label={customLabel ?? "Aspect Ratio"}
          options={VIDEO_RATIOS}
          value={value}
          onChange={onChange}
          allowedValues={allowedValues}
          readOnly={readOnly}
          autoReset
        />
      )
    case "motion":
      return (
        <SliderField
          label={customLabel ?? "Motion Amount"}
          value={value}
          onChange={onChange}
          min={1}
          max={255}
          step={1}
          readOnly={readOnly}
        />
      )
    case "generateAudio":
      return (
        <ToggleField
          label={customLabel ?? "Generate Audio"}
          value={value}
          onChange={onChange}
          readOnly={readOnly}
        />
      )
    default:
      return null
  }
}

/**
 * Generate Video Pro — Seedance-2-family multi-segment stitch node (Task 13).
 * Trimmed sibling of renderGenerateVideo above: adds prompt/duration/resolution
 * cases (the trimmed config panel exposes fewer, simpler levers than the full
 * generate-video node) and drops "motion" (no motion-amount field on this
 * node). Provider set is GVP_PROVIDERS (the 3 Seedance-2-family ids only —
 * never the full VIDEO_GEN_MODELS superset). Aspect ratio + resolution read
 * the node's OWN current provider so options can never silently drift from
 * what the model actually supports (no hardcoded static superset lists).
 */
function renderGenerateVideoPro(
  props: ConfigFieldRendererProps,
): React.ReactNode | null {
  const { field, value, nodeData, onChange, allowedValues, readOnly, customLabel } = props
  const provider = String(nodeData.provider ?? "seedance-2")

  switch (field) {
    case "prompt":
      return (
        <TextareaField
          label={customLabel ?? "Prompt"}
          value={value}
          onChange={onChange}
          readOnly={readOnly}
        />
      )
    case "provider":
      return (
        <OptionSelect
          label={customLabel ?? "Model"}
          options={GVP_PROVIDERS}
          value={value}
          onChange={onChange}
          allowedValues={allowedValues}
          readOnly={readOnly}
          showDesc
        />
      )
    case "duration":
      return (
        <SliderField
          label={customLabel ?? "Duration (seconds)"}
          value={value}
          onChange={onChange}
          min={4}
          max={GENERATE_VIDEO_PRO_MAX_DURATION_FALLBACK}
          step={1}
          readOnly={readOnly}
        />
      )
    case "aspectRatio":
      return (
        <AspectRatioField
          label={customLabel ?? "Aspect Ratio"}
          options={getAspectRatiosForVideoModel(provider)}
          value={value}
          onChange={onChange}
          allowedValues={allowedValues}
          readOnly={readOnly}
          autoReset
        />
      )
    case "resolution": {
      const resOpts = getVideoResolutionOptions(provider)
      if (!resOpts) return null
      return (
        <OptionSelect
          label={customLabel ?? "Resolution"}
          options={resOpts}
          value={value}
          onChange={onChange}
          allowedValues={allowedValues}
          readOnly={readOnly}
          autoReset
        />
      )
    }
    case "generateAudio":
      return (
        <ToggleField
          label={customLabel ?? "Generate Audio"}
          value={value}
          onChange={onChange}
          readOnly={readOnly}
        />
      )
    default:
      return null
  }
}

/** Surfaced on both span fields (spanStart/spanEnd) so the caveat is visible
 *  regardless of which one an app curator chose to expose as a card — the two
 *  numeric fields render as independent cards in the app runner, so there's
 *  no single "group footer" slot to hang a one-time note on. */
const EDIT_VIDEO_PRO_SPAN_HELP_TEXT =
  "Span must fall within your video's length; an out-of-range span fails after reserving and auto-refunds."

/**
 * Edit Video Pro — span-replace sibling of Generate Video Pro (Task 14).
 * Mirrors renderGenerateVideoPro's structure: prompt + provider (same
 * GVP_PROVIDERS — the 3 Seedance-2-family ids) + generateAudio. Unlike gvp,
 * NO aspectRatio/resolution cases — both are source-derived by design (see
 * EditVideoProNodeData). Adds the two span fields (spanStart/spanEnd) as
 * plain numeric inputs (NumberField, not SliderField — no natural fixed
 * upper bound, mirrors the editor panel's own un-capped span inputs in
 * video-configs.tsx) plus the reserve/refund caveat help text.
 */
function renderEditVideoPro(
  props: ConfigFieldRendererProps,
): React.ReactNode | null {
  const { field, value, onChange, readOnly, customLabel, allowedValues } = props

  switch (field) {
    case "prompt":
      return (
        <TextareaField
          label={customLabel ?? "Prompt"}
          value={value}
          onChange={onChange}
          readOnly={readOnly}
        />
      )
    case "provider":
      return (
        <OptionSelect
          label={customLabel ?? "Model"}
          options={GVP_PROVIDERS}
          value={value}
          onChange={onChange}
          allowedValues={allowedValues}
          readOnly={readOnly}
          showDesc
        />
      )
    case "spanStart":
      return (
        <NumberField
          label={customLabel ?? "Span Start (seconds)"}
          value={value}
          onChange={onChange}
          min={0}
          step={0.1}
          readOnly={readOnly}
          helpText={EDIT_VIDEO_PRO_SPAN_HELP_TEXT}
        />
      )
    case "spanEnd":
      return (
        <NumberField
          label={customLabel ?? "Span End (seconds)"}
          value={value}
          onChange={onChange}
          min={0}
          step={0.1}
          readOnly={readOnly}
          helpText={EDIT_VIDEO_PRO_SPAN_HELP_TEXT}
        />
      )
    case "generateAudio":
      return (
        <ToggleField
          label={customLabel ?? "Generate Audio"}
          value={value}
          onChange={onChange}
          readOnly={readOnly}
        />
      )
    default:
      return null
  }
}

// ---------------------------------------------------------------------------
// Fallback: delegate to generic FieldInputCard using the shared exposable-field
// resolver (static NODE_DEFINITIONS fields + dynamic lottie slot fields)
// ---------------------------------------------------------------------------

function FallbackField(props: ConfigFieldRendererProps): React.ReactNode | null {
  const { nodeType, field, value, nodeData, onChange, allowedValues, readOnly, customLabel } = props
  // Static NODE_DEFINITIONS fields, plus dynamic lottie slot fields derived from
  // a motion-graphics plan — resolved through the shared single source of truth.
  const fieldDef = findExposableField(
    { type: nodeType, data: nodeData } as unknown as WorkflowNode,
    field,
  )
  if (!fieldDef) return null

  return (
    <FieldInputCard
      field={fieldDef}
      value={value}
      onChange={onChange}
      allowedValues={allowedValues}
      readOnly={readOnly}
      customLabel={customLabel}
    />
  )
}

// ---------------------------------------------------------------------------
// Main dispatcher
// ---------------------------------------------------------------------------

/** Lookup: nodeType -> render function that returns hook-using components. */
const NODE_RENDERERS: Record<
  string,
  (props: ConfigFieldRendererProps) => React.ReactNode | null
> = {
  "generate-image": renderGenerateImage,
  "text-to-video": renderTextToVideo,
  "generate-video": renderGenerateVideo,
  "generate-video-pro": renderGenerateVideoPro,
  "edit-video-pro": renderEditVideoPro,
}

export function ConfigFieldRenderer(
  props: ConfigFieldRendererProps,
): React.ReactNode | null {
  const renderer = NODE_RENDERERS[props.nodeType]
  if (renderer) {
    const result = renderer(props)
    // If the node-specific renderer handled this field, use it.
    // If it returned null (unrecognized field within that node type), fall back.
    if (result !== null) return result
  }
  return <FallbackField {...props} />
}
