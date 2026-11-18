/** What the agents did, line by line, with when: folded away under "Details" unless opened. */
import { useT } from "@/lib/i18n"
import { AGENT_COLORS } from "@/ee/lib/freecut-ai/run-ai-edit"
import { AGENT_NAME, type FeedLine } from "./use-edit-session"

const clock = (seconds: number) => {
  const s = Math.max(0, Math.floor(seconds))
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`
}

export function RunLog({ lines }: { readonly lines: readonly FeedLine[] }) {
  const t = useT()
  if (lines.length === 0) return null
  return (
    <details className="rounded-lg border border-[#262633] bg-[#121219] px-3 py-2 text-[11px]">
      <summary className="cursor-pointer select-none text-white/70">{t("freecutAi.details", { n: lines.length })}</summary>
      <ol className="mt-2 flex max-h-56 flex-col gap-1 overflow-y-auto" aria-live="polite">
        {lines.map((line) => (
          <li key={line.id} className="leading-snug">
            <span className="me-1.5 font-mono text-white/50">{clock(line.at)}</span>
            <span className="me-1.5 font-semibold" style={{ color: AGENT_COLORS[line.agent] }}>{t(AGENT_NAME[line.agent])}</span>
            <span className="text-white/80" dir="auto">{t(line.key, line.vars)}</span>
          </li>
        ))}
      </ol>
    </details>
  )
}
