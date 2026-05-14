import { AiHelperButton } from "@/components/ui/ai-helper-button"
import { llmSuggestDescription, type LlmSuggestContext } from "@/lib/api"

interface SeedPromptTextareaProps {
  readonly value: string
  readonly onChange: (next: string) => void
  readonly suggestContext: LlmSuggestContext
}

export function SeedPromptTextarea({ value, onChange, suggestContext }: SeedPromptTextareaProps) {
  const suggest = async () => {
    const { text } = await llmSuggestDescription({ kind: "seed-prompt", context: suggestContext })
    return text
  }
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <label className="text-[9px] uppercase tracking-wide text-slate-500">Seed Prompt</label>
        <AiHelperButton onSuggest={suggest} onReplace={onChange} title="Suggest seed prompt" />
      </div>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder="A short identity description for the portrait — physical traits, demeanor, distinctive features"
        rows={4}
        maxLength={2000}
        className="block w-full text-[11px] bg-[#13161f] border border-[#334155] rounded px-2 py-1.5 text-slate-200"
      />
      <div className="text-right text-[9px] text-slate-500 tabular-nums">{value.length}/2000</div>
    </div>
  )
}
