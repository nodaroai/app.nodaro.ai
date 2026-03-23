import { useEffect, useRef } from "react"
import {
  IMAGE_GEN_MODELS,
  VIDEO_T2V_MODELS,
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
import { NODE_DEF_MAP } from "@/types/nodes"
import { FieldInputCard } from "./field-input-card"

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

/** Filter options by allowedValues (if any), preserving original order. */
function filterOptions(
  options: readonly OptionEntry[],
  allowedValues?: Array<string | number | boolean>,
): readonly OptionEntry[] {
  if (!allowedValues) return options
  return options.filter((o) =>
    allowedValues.some((av) => String(av) === o.value),
  )
}

// ---------------------------------------------------------------------------
// Auto-reset hook: when current value is not in available options, reset to first valid.
// Called unconditionally at top level of the sub-components that need it.
// ---------------------------------------------------------------------------

function useAutoReset(
  value: unknown,
  options: readonly { value: string }[],
  onChange: (v: unknown) => void,
  enabled: boolean,
) {
  const prevRef = useRef(value)

  useEffect(() => {
    if (!enabled || options.length === 0) return
    const str = String(value ?? "")
    if (!options.some((o) => o.value === str)) {
      onChange(options[0].value)
    }
    prevRef.current = value
  }, [value, options, onChange, enabled])
}

// ---------------------------------------------------------------------------
// Sub-components — each one is a proper React component with hooks at top level
// ---------------------------------------------------------------------------

function ModelSelect({
  label,
  models,
  value,
  onChange,
  allowedValues,
  readOnly,
  showDesc,
}: {
  label: string
  models: readonly OptionEntry[]
  value: unknown
  onChange: (v: unknown) => void
  allowedValues?: Array<string | number | boolean>
  readOnly?: boolean
  showDesc?: boolean
}) {
  const filtered = filterOptions(models, allowedValues)
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
    : [...options]

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
    : [...options]

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
              {opt.label}
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </GlassCard>
  )
}

// ---------------------------------------------------------------------------
// Node-specific renderers — pure dispatchers, no hooks.
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
        <ModelSelect
          label={customLabel ?? "Model"}
          models={IMAGE_GEN_MODELS}
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
      const styleOptions: { value: string; label: string }[] = [
        { value: "", label: "None" },
        ...IMAGE_STYLE_PRESETS.map((s) => ({ value: s.value, label: s.label })),
      ]
      return (
        <OptionSelect
          label={customLabel ?? "Style"}
          options={filterOptions(styleOptions, allowedValues)}
          value={value}
          onChange={onChange}
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
        <ModelSelect
          label={customLabel ?? "Model"}
          models={VIDEO_T2V_MODELS}
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

const TTS_MODELS: readonly OptionEntry[] = [
  { value: "elevenlabs-v3", label: "ElevenLabs v3 (recommended)" },
  { value: "elevenlabs-turbo", label: "ElevenLabs Turbo v2.5 (fast)" },
  { value: "elevenlabs-multilingual", label: "ElevenLabs Multilingual v2" },
]

function renderTextToSpeech(
  props: ConfigFieldRendererProps,
): React.ReactNode | null {
  const { field, value, onChange, allowedValues, readOnly, customLabel } = props

  switch (field) {
    case "provider":
      return (
        <ModelSelect
          label={customLabel ?? "Model"}
          models={TTS_MODELS}
          value={value}
          onChange={onChange}
          allowedValues={allowedValues}
          readOnly={readOnly}
        />
      )
    case "stability":
      return (
        <SliderField
          label={customLabel ?? "Stability"}
          value={value}
          onChange={onChange}
          min={0}
          max={1}
          step={0.01}
          readOnly={readOnly}
        />
      )
    case "similarity":
      return (
        <SliderField
          label={customLabel ?? "Similarity"}
          value={value}
          onChange={onChange}
          min={0}
          max={1}
          step={0.01}
          readOnly={readOnly}
        />
      )
    default:
      return null
  }
}

const VOICE_DESIGN_MODELS: readonly OptionEntry[] = [
  { value: "eleven_ttv_v3", label: "ElevenLabs v3 (recommended)" },
  { value: "eleven_multilingual_ttv_v2", label: "ElevenLabs Multilingual v2" },
]

function renderVoiceDesign(
  props: ConfigFieldRendererProps,
): React.ReactNode | null {
  const { field, value, onChange, allowedValues, readOnly, customLabel } = props

  switch (field) {
    case "model":
      return (
        <ModelSelect
          label={customLabel ?? "Model"}
          models={VOICE_DESIGN_MODELS}
          value={value}
          onChange={onChange}
          allowedValues={allowedValues}
          readOnly={readOnly}
        />
      )
    case "loudness":
      return (
        <SliderField
          label={customLabel ?? "Loudness"}
          value={value}
          onChange={onChange}
          min={-1}
          max={1}
          step={0.1}
          readOnly={readOnly}
        />
      )
    default:
      return null
  }
}

// ---------------------------------------------------------------------------
// Fallback: delegate to generic FieldInputCard using NODE_DEF_MAP metadata
// ---------------------------------------------------------------------------

function FallbackField(props: ConfigFieldRendererProps): React.ReactNode | null {
  const { nodeType, field, value, onChange, allowedValues, readOnly, customLabel } = props
  const def = NODE_DEF_MAP.get(nodeType)
  const fieldDef = def?.exposableFields?.find((f) => f.key === field)
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

/** Lookup: nodeType -> pure render function (no hooks). */
const NODE_RENDERERS: Record<
  string,
  (props: ConfigFieldRendererProps) => React.ReactNode | null
> = {
  "generate-image": renderGenerateImage,
  "text-to-video": renderTextToVideo,
  "text-to-speech": renderTextToSpeech,
  "voice-design": renderVoiceDesign,
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
