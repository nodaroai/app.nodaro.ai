import { MODEL_DESCRIPTIONS } from "./model-options"
import { LLM_MODELS } from "@nodaro/shared"
import { useLocalizeModelDescription } from "@/lib/i18n/labels"

const ALL_DESCRIPTIONS: Record<string, string> = {
  ...MODEL_DESCRIPTIONS,
  ...Object.fromEntries(LLM_MODELS.map(m => [m.id, m.desc])),
}

export function ModelDescriptionHint({ modelId }: { modelId: string | undefined }) {
  const localizeDesc = useLocalizeModelDescription()
  if (!modelId) return null
  const desc = ALL_DESCRIPTIONS[modelId]
  if (!desc) return null
  return <p className="text-xs text-muted-foreground">{localizeDesc(desc)}</p>
}
