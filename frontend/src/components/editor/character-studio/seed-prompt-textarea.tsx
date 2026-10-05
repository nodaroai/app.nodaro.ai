import { flushSync } from "react-dom"
import { AiHelperButton } from "@/components/ui/ai-helper-button"
import { withRunInFlight } from "@/hooks/run-in-flight"
import { llmSuggestDescription, type LlmSuggestContext } from "@/lib/api"
import { useT } from "@/lib/i18n"

interface SeedPromptTextareaProps {
  /** The canvas node the Studio edits, which the Studio writes the seed prompt onto. */
  readonly nodeId: string
  readonly value: string
  readonly onChange: (next: string) => void
  readonly suggestContext: LlmSuggestContext
}

export function SeedPromptTextarea({ nodeId, value, onChange, suggestContext }: SeedPromptTextareaProps) {
  const t = useT()
  // A paid suggestion whose answer lands on the canvas node, so the node shows
  // a run in flight from before the request until the answer is written
  // (T100): a read-only freeze waits for it, and on a canvas already read-only
  // nothing is sent. The write sits inside the run for that reason. And it is
  // flushed: the Studio writes its fields onto the node inside a state updater
  // (`patch`), which React may run only at its next render, after this run's
  // mark has gone and the freeze has landed.
  const suggest = () =>
    withRunInFlight(nodeId, async () => {
      const { text } = await llmSuggestDescription({ kind: "seed-prompt", context: suggestContext })
      const next = text.trim()
      if (next.length > 0) flushSync(() => onChange(next))
    })
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <label className="text-[9px] uppercase tracking-wide text-slate-500">{t("studio.seedPrompt")}</label>
        <AiHelperButton onSuggest={suggest} title={t("studio.suggestSeedPrompt")} />
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
