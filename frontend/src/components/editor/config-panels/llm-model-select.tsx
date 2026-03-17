import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { LLM_MODELS, LLM_FEATURE_DEFAULTS } from "@nodaro-shared/llm-models"
import type { LlmTier } from "@nodaro-shared/llm-models"

const TIER_LABELS: Record<LlmTier, string> = {
  economy: "Economy",
  standard: "Standard",
  premium: "Premium",
}

const TIER_COLORS: Record<LlmTier, string> = {
  economy: "text-green-400",
  standard: "text-blue-400",
  premium: "text-amber-400",
}

interface LlmModelSelectProps {
  feature: string
  value?: string
  onChange: (modelId: string) => void
}

export function LlmModelSelect({ feature, value, onChange }: LlmModelSelectProps) {
  const defaultModel = LLM_FEATURE_DEFAULTS[feature] ?? "claude-sonnet-4.6"
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
            <SelectItem key={model.id} value={model.id} className="text-xs">
              <span className="flex items-center gap-2">
                <span>{model.displayName}</span>
                <span className={`text-[10px] font-medium ${TIER_COLORS[model.tier]}`}>
                  {TIER_LABELS[model.tier]}
                </span>
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
