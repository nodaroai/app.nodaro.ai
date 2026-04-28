import { Select, SelectContent, SelectTrigger, SelectValue, SelectItemWithMeta } from "@/components/ui/select"
import { LLM_MODELS, LLM_FEATURE_DEFAULTS } from "@nodaro/shared"
import type { LlmTier, LlmFeature } from "@nodaro/shared"
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
}

export function LlmModelSelect({ feature, value, onChange }: LlmModelSelectProps) {
  const defaultModel = LLM_FEATURE_DEFAULTS[feature]
  const currentValue = value || defaultModel

  return (
    <div className="space-y-1">
      <label className="text-xs font-medium text-muted-foreground">AI Model</label>
      <Select value={currentValue} onValueChange={onChange}>
        <SelectTrigger className="h-8 text-xs">
          <SelectValue />
        </SelectTrigger>
        <SelectContent>
          {LLM_MODELS.map((model) => (
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
