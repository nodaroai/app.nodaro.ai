import { useMemo } from "react"
import { useT } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import { templateResults, type TemplateResult } from "./template-results"

/** One playable result: native controls, sound on — the user starts playback. */
function ResultTile({ result }: { readonly result: TemplateResult }) {
  return (
    <figure className="flex w-[200px] flex-none flex-col gap-1.5">
      {result.kind === "video" ? (
        <video
          src={result.url}
          poster={result.posterUrl}
          controls
          playsInline
          preload="metadata"
          className="h-[112px] w-full rounded-[10px] bg-black object-contain"
        />
      ) : result.kind === "audio" ? (
        <div className="flex h-[112px] w-full items-center rounded-[10px] bg-[var(--home-raised)] px-2">
          <audio src={result.url} controls preload="metadata" className="w-full" />
        </div>
      ) : (
        <img src={result.url} alt={result.label} loading="lazy" className="h-[112px] w-full rounded-[10px] bg-black object-contain" />
      )}
      <figcaption className="truncate text-[11px] text-[var(--home-fg-2)]" title={result.label}>
        {result.label}
      </figcaption>
    </figure>
  )
}

interface TemplateResultsRailProps {
  readonly snapshotNodes: readonly unknown[]
  readonly className?: string
}

/**
 * The template's generated results as real players. The read-only canvas is
 * inert on purpose — nothing in it can be clicked — so a video there only
 * ever autoplays muted and a track never plays at all. This rail is where a
 * visitor hears the spot before cloning it.
 */
export function TemplateResultsRail({ snapshotNodes, className }: TemplateResultsRailProps) {
  const t = useT()
  const results = useMemo(() => templateResults(snapshotNodes), [snapshotNodes])
  if (results.length === 0) return null
  return (
    <section
      aria-label={t("templates.results")}
      className={cn("rounded-[14px] border border-[var(--home-line)] bg-[var(--home-panel)] p-3", className)}
    >
      <div className="mb-2 flex items-baseline gap-2">
        <span className="text-[11px] font-bold uppercase tracking-[1.4px] text-[var(--primary)]">{t("templates.results")}</span>
        <span className="text-[11px] text-[var(--home-muted)]">{t("templates.resultsHint")}</span>
      </div>
      <div className="flex gap-3 overflow-x-auto pb-1">
        {results.map((result) => (
          <ResultTile key={result.nodeId} result={result} />
        ))}
      </div>
    </section>
  )
}
