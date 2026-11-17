/**
 * After an edit: one line that says what the edit did ("3:02 → 2:31 · 23 cuts
 * · 148 captions · music 112 BPM"), the editor's own Original | Split | Edited,
 * Wide | Phone once there is a phone version, and Undo all, quietly.
 */
import { Columns2, Eye, Monitor, Play, Smartphone, Undo2 } from "lucide-react"
import { useT } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import type { CompareMode } from "@/ee/lib/freecut-ai/editor-link"
import type { RunSummary } from "@/ee/lib/freecut-ai/run-ai-edit"

const clock = (s: number) => `${Math.floor(s / 60)}:${String(Math.round(s % 60)).padStart(2, "0")}`

export interface ResultBarProps {
  readonly fromSeconds?: number
  readonly toSeconds?: number
  readonly summary?: RunSummary
  readonly busy: boolean
  /** The editor's own Original | Split | Edited; null when the editor cannot (the panel then shows the original itself). */
  readonly compare: CompareMode | null
  readonly onCompare: (mode: CompareMode) => void
  readonly onUndoAll: () => void
  /** Wide | Phone, once there is a phone version. */
  readonly format?: "wide" | "phone"
  readonly onFormat?: (to: "wide" | "phone") => void
}

function Segment<T extends string>({ value, options, onChange, label }: { readonly value: T; readonly options: ReadonlyArray<{ readonly id: T; readonly text: string; readonly icon: typeof Eye }>; readonly onChange: (v: T) => void; readonly label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="flex overflow-hidden rounded-lg bg-white/[0.05] p-0.5">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={value === o.id}
          onClick={() => onChange(o.id)}
          className={cn("flex items-center gap-1 rounded-md px-2 py-1 text-[11px]", value === o.id ? "bg-white/15 text-white" : "text-white/65 hover:text-white")}
        >
          <o.icon className="h-3 w-3" aria-hidden />
          {o.text}
        </button>
      ))}
    </div>
  )
}

/** The summary of what the edit did, in one line. */
function useSummaryLine(fromSeconds?: number, toSeconds?: number, s?: RunSummary): string | null {
  const t = useT()
  const parts: string[] = []
  if (fromSeconds !== undefined && toSeconds !== undefined) parts.push(toSeconds < fromSeconds - 0.05 ? t("freecutAi.summary.length", { from: clock(fromSeconds), to: clock(toSeconds) }) : clock(fromSeconds))
  if (s) {
    const cuts = s.pausesCut + s.fillersCut + s.mistakesCut
    if (cuts > 0) parts.push(t(cuts === 1 ? "freecutAi.summary.cutsOne" : "freecutAi.summary.cuts", { n: cuts }))
    if (s.captions > 0) parts.push(t(s.captions === 1 ? "freecutAi.summary.captionsOne" : "freecutAi.summary.captions", { n: s.captions }))
    if (s.music) parts.push(s.bpm ? t("freecutAi.summary.musicBpm", { bpm: Math.round(s.bpm) }) : t("freecutAi.summary.music"))
    if (s.broll > 0) parts.push(t("freecutAi.summary.broll", { n: s.broll }))
    if (s.titles > 0) parts.push(t(s.titles === 1 ? "freecutAi.summary.titlesOne" : "freecutAi.summary.titles", { n: s.titles }))
    if (s.phone) parts.push(t("freecutAi.summary.phone"))
    const made = s.clips + (s.trailer ? 1 : 0) + (s.chapters > 0 ? 1 : 0)
    if (made > 0) parts.push(t("freecutAi.summary.made", { n: made }))
  }
  return parts.length > 0 ? parts.join(t("freecutAi.summary.join")) : null
}

export function ResultBar({ fromSeconds, toSeconds, summary, busy, compare, onCompare, onUndoAll, format, onFormat }: ResultBarProps) {
  const t = useT()
  const line = useSummaryLine(fromSeconds, toSeconds, summary)
  return (
    <div className="flex flex-col gap-2 border-b border-white/10 px-4 py-3">
      {line ? <p className="font-mono text-[11.5px] text-white/80" dir="auto">{line}</p> : null}
      <div className="flex flex-wrap items-center gap-2">
        {compare ? (
          <Segment
            label={t("freecutAi.compare")}
            value={compare}
            onChange={onCompare}
            options={[
              { id: "source", text: t("freecutAi.view.original"), icon: Eye },
              { id: "split", text: t("freecutAi.view.split"), icon: Columns2 },
              { id: "program", text: t("freecutAi.view.edited"), icon: Play },
            ]}
          />
        ) : (
          <button type="button" onClick={() => onCompare("source")} className="flex items-center gap-1.5 rounded-lg bg-white/[0.05] px-2.5 py-1.5 text-[11px] text-white/85 hover:bg-white/10">
            <Eye className="h-3 w-3" aria-hidden />
            {t("freecutAi.compare")}
          </button>
        )}
        {format && onFormat ? (
          <Segment
            label={t("freecutAi.format.label")}
            value={format}
            onChange={(to) => !busy && onFormat(to)}
            options={[
              { id: "wide", text: t("freecutAi.format.wide"), icon: Monitor },
              { id: "phone", text: t("freecutAi.format.phone"), icon: Smartphone },
            ]}
          />
        ) : null}
        <button type="button" disabled={busy} onClick={onUndoAll} className="ms-auto flex items-center gap-1 text-[11px] text-white/55 hover:text-white disabled:opacity-50">
          <Undo2 className="h-3 w-3" aria-hidden />
          {t("freecutAi.undoAll")}
        </button>
      </div>
    </div>
  )
}
