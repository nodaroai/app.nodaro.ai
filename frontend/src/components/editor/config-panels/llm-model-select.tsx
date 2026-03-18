import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { LLM_MODELS, LLM_FEATURE_DEFAULTS, buildLlmCreditIdentifier } from "@nodaro-shared/llm-models"
import type { LlmTier, LlmFeature } from "@nodaro-shared/llm-models"
import { useModelCredits } from "@/hooks/use-model-credits"
import { hasCredits } from "@/lib/edition"

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
  feature: LlmFeature
  value?: string
  onChange: (modelId: string) => void
}

function ModelOption({ modelId, displayName, tier, feature }: { modelId: string; displayName: string; tier: LlmTier; feature: LlmFeature }) {
  const creditId = buildLlmCreditIdentifier(feature, modelId)
  const cost = useModelCredits(creditId, 0)
  const showCredits = hasCredits()

  return (
    <SelectItem key={modelId} value={modelId} className="text-xs">
      <span className="flex items-center gap-2">
        <span>{displayName}</span>
        <span className={`text-[10px] font-medium ${TIER_COLORS[tier]}`}>
          {TIER_LABELS[tier]}
        </span>
        {showCredits && cost > 0 && (
          <span className="text-[10px] text-muted-foreground">{cost} CR</span>
        )}
      </span>
    </SelectItem>
  )
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
            <ModelOption
              key={model.id}
              modelId={model.id}
              displayName={model.displayName}
              tier={model.tier}
              feature={feature}
            />
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
