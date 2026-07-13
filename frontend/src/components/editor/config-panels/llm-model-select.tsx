import { Select, SelectContent, SelectTrigger, SelectValue, SelectItemWithMeta } from "@/components/ui/select"
import { LLM_MODELS, LLM_FEATURE_DEFAULTS } from "@nodaro/shared"
import type { LlmTier, LlmFeature, LlmModelDef } from "@nodaro/shared"
import { ModelDescriptionHint } from "./model-description-hint"

const TIER_LABELS: Record<LlmTier, string> = {
  economy: "Economy",
  standard: "Standard",
  premium: "Premium",
}

interface LlmModelSelectProps {
  feature: LlmFeature
  value?: string
  onChange: (modelId: string) => void
  /** Optional predicate to restrict the offered models (default: all models).
   *  e.g. describe-to-picker restricts to STRUCTURED_VISION_MODELS because its
   *  analyzer needs guaranteed schema-shaped output over an image. */
  filter?: (model: LlmModelDef) => boolean
}

export function LlmModelSelect({ feature, value, onChange, filter }: LlmModelSelectProps) {
  const defaultModel = LLM_FEATURE_DEFAULTS[feature]
  const currentValue = value || defaultModel
  const models = filter ? LLM_MODELS.filter(filter) : LLM_MODELS

  return (
    <div className="space-y-1">
      <label className="text-xs font-medium text-muted-foreground">AI Model</label>
      <Select value={currentValue} onValueChange={onChange}>
        <SelectTrigger className="h-8 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {models.map((model) => (
            <SelectItemWithMeta
              key={model.id}
              value={model.id}
              badge={TIER_LABELS[model.tier]}
              description={model.desc}
              className="text-xs"
            >
              {model.displayName}
            </SelectItemWithMeta>
          ))}
        </SelectContent>
      </Select>
      <ModelDescriptionHint modelId={currentValue} />
    </div>
  )
}
