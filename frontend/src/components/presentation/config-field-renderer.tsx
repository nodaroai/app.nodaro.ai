import { useEffect, useRef } from "react"
import {
  IMAGE_GEN_MODELS,
  VIDEO_T2V_MODELS,
  VIDEO_GEN_MODELS,
  IMAGE_STYLE_PRESETS,
  getAspectRatiosForModel,
  IMAGE_QUALITY_OPTIONS,
  IMAGE_RESOLUTION_OPTIONS,
  VIDEO_RATIOS,
} from "@/components/editor/config-panels/model-options"
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
