/**
 * What was made from the video: clips and a trailer, each in its own tab of
 * the editor ("Open its tab"), and a chapter list to copy into the video's
 * description. They stay when the edit is undone.
 */
import { useState } from "react"
import { Check, Copy, ExternalLink, ListOrdered } from "lucide-react"
import { formatNumber, useT } from "@/lib/i18n"
import type { MadeResult } from "@/ee/lib/freecut-ai/run-ai-edit"

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, "0")}`

export function Results({ made, onOpen }: { readonly made: readonly MadeResult[]; readonly onOpen: (sequenceId: string) => void }) {
  const t = useT()
  const [copied, setCopied] = useState<string | null>(null)
  if (made.length === 0) return null
  const copy = async (result: MadeResult) => {
    const text = (result.chapters ?? []).map((c) => `${clock(c.seconds)} ${c.title}`).join("\n")
    try {
      await navigator.clipboard.writeText(text)
      setCopied(result.id)
    } catch {
      setCopied(null)
    }
  }
  return (
    <section aria-label={t("freecutAi.results")} className="flex flex-col gap-1.5">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-white/60">{t("freecutAi.results")}</p>
      {made.map((result) => (
        <div key={result.id} className="flex flex-col gap-1 rounded-lg border border-[#2D2D2D] bg-[#1E1E1E] px-3 py-2">
          <div className="flex items-center gap-2">
            <span className="me-auto text-xs font-medium text-white">{t(result.key, result.vars)}</span>
            {result.seconds !== undefined ? <span className="font-mono text-[11px] text-white/60">{t("freecutAi.seconds", { s: formatNumber(result.seconds, { maximumFractionDigits: 1 }) })}</span> : null}
            {result.sequenceId ? (
              <button type="button" onClick={() => onOpen(result.sequenceId!)} className="flex items-center gap-1 rounded-md border border-white/15 px-2 py-1 text-[11px] text-white/85 hover:bg-white/10">
                <ExternalLink className="h-3 w-3" aria-hidden />
                {t("freecutAi.openTab")}
              </button>
            ) : null}
            {result.chapters ? (
              <button type="button" onClick={() => void copy(result)} className="flex items-center gap-1 rounded-md border border-white/15 px-2 py-1 text-[11px] text-white/85 hover:bg-white/10">
                {copied === result.id ? <Check className="h-3 w-3 text-emerald-300" aria-hidden /> : <Copy className="h-3 w-3" aria-hidden />}
                {t(copied === result.id ? "freecutAi.copied" : "freecutAi.copyList")}
              </button>
            ) : null}
          </div>
          {result.chapters ? (
            <ol className="flex flex-col gap-0.5 text-[11px] text-white/75">
              {result.chapters.map((c) => (
                <li key={`${c.seconds}-${c.title}`} className="flex gap-2" dir="auto">
                  <ListOrdered className="mt-0.5 h-3 w-3 shrink-0 text-white/40" aria-hidden />
                  <span className="font-mono text-white/55">{clock(c.seconds)}</span>
                  <span>{c.title}</span>
                </li>
              ))}
            </ol>
          ) : null}
        </div>
      ))}
    </section>
  )
}
