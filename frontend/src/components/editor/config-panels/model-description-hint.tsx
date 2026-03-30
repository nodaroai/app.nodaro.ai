import { MODEL_DESCRIPTIONS } from "./model-options"
import { LLM_MODELS } from "@nodaro-shared/llm-models"

const ALL_DESCRIPTIONS: Record<string, string> = {
  ...MODEL_DESCRIPTIONS,
  ...Object.fromEntries(LLM_MODELS.map(m => [m.id, m.desc])),
}

export function ModelDescriptionHint({ modelId }: { modelId: string | undefined }) {
  if (!modelId) return null
  const desc = ALL_DESCRIPTIONS[modelId]
  if (!desc) return null
  return <p className="text-xs text-muted-foreground">{desc}</p>
}
