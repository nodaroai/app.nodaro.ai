import { AiHelperButton } from "@/components/ui/ai-helper-button"
import { llmSuggestDescription, type LlmSuggestContext } from "@/lib/api"
import { useT } from "@/lib/i18n"

interface SeedPromptTextareaProps {
  readonly value: string
  readonly onChange: (next: string) => void
  readonly suggestContext: LlmSuggestContext
}

export function SeedPromptTextarea({ value, onChange, suggestContext }: SeedPromptTextareaProps) {
  const t = useT()
  const suggest = async () => {
    const { text } = await llmSuggestDescription({ kind: "seed-prompt", context: suggestContext })
    return text
  }
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <label className="text-[9px] uppercase tracking-wide text-slate-500">{t("studio.seedPrompt")}</label>
        <AiHelperButton onSuggest={suggest} onReplace={onChange} title={t("studio.suggestSeedPrompt")} />
      </div>
      <textarea
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={t("studio.seedPromptPh")}
        rows={4}
        maxLength={4000}
        className="block w-full text-[11px] bg-[#13161f] border border-[#334155] rounded px-2 py-1.5 text-slate-200"
      />
      <div className="text-end text-[9px] text-slate-500 tabular-nums">{value.length}/4000</div>
    </div>
  )
}
