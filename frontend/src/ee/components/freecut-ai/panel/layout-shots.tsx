/**
 * Where the speaker layout changes: one bar that says how much of the video is
 * shown each way, and the stretches in order. A stretch takes the editor's
 * playhead there, and "Change" shows it another way: the whole picture, one
 * person or parts, and who comes first. Read from the editor's timeline, so it
 * follows later cuts and an undo, and it is gone when the layout is.
 */
import { useEffect, useState } from "react"
import { formatNumber, useT, type MessageKey } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import type { EditorLink } from "@/ee/lib/freecut-ai/editor-link"
import { readTimelineView, type TimelineView } from "@/ee/lib/freecut-ai/edit-plan"
import { peopleInRow, type ShotChoice } from "@/ee/lib/freecut-ai/change-shot"
import { layoutRows, layoutShares, type LayoutRow, type ShotKind } from "@/ee/lib/freecut-ai/layout-rows"
import type { ShotTrackSet } from "@/ee/lib/freecut-ai/shot-layout"

const NAME: Record<ShotKind, MessageKey> = {
  close: "freecutAi.shot.close",
  whole: "freecutAi.shot.whole",
  two: "freecutAi.shot.two",
  three: "freecutAi.shot.three",
}
/** One colour per way of showing a shot, told apart by lightness as well as hue. */
const COLOR: Record<ShotKind, string> = { close: "#6ea0ff", whole: "#9db3d9", two: "#f2a53b", three: "#c79bff" }
const KINDS: readonly ShotKind[] = ["close", "whole", "two", "three"]
/** How many people a way of showing needs in the shot. */
const NEEDS: Record<ShotKind, number> = { close: 0, whole: 0, two: 2, three: 3 }
const SHOWN = 8

const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`

/** A small picture of the frame: how the shot is laid in it. */
function Glyph({ kind, large = false }: { readonly kind: ShotKind; readonly large?: boolean }) {
  const fill = { background: COLOR[kind] }
  return (
    <span aria-hidden className={cn("flex shrink-0 flex-col gap-0.5", large ? "h-10 w-6" : "h-7 w-4")}>
      {kind === "close" ? <span className="h-full rounded-[3px]" style={fill} /> : null}
      {kind === "whole" ? (
        <span className="flex h-full items-center rounded-[3px] bg-white/15">
          <span className="h-1/3 w-full" style={fill} />
        </span>
      ) : null}
      {kind === "two" || kind === "three" ? <span className="h-[58%] rounded-[3px]" style={fill} /> : null}
      {kind === "two" ? <span className="flex-1 rounded-[2px]" style={fill} /> : null}
      {kind === "three" ? (
        <span className="flex flex-1 gap-0.5">
          <span className="flex-1 rounded-[2px]" style={fill} />
          <span className="flex-1 rounded-[2px]" style={fill} />
        </span>
      ) : null}
    </span>
  )
}

function useLayoutView(link: () => EditorLink | null, refreshKey: string): TimelineView | null {
  const [view, setView] = useState<TimelineView | null>(null)
  useEffect(() => {
    let live = true
    void (async () => {
      try {
        const read = readTimelineView(await link()?.getTimeline())
        if (live && read) setView(read)
      } catch {
        // The editor is closed or still opening: no list.
      }
    })()
    return () => {
      live = false
    }
  }, [link, refreshKey])
  return view
}

/** The choices for one stretch: how to show it, and who comes first. */
function ChangeShot({ row, people, alike, busy, onApply }: { readonly row: LayoutRow; readonly people: number; readonly alike: number; readonly busy: boolean; readonly onApply: (choice: ShotChoice, all: boolean) => void }) {
  const t = useT()
  const [as, setAs] = useState<ShotKind>(row.kind)
  const [first, setFirst] = useState(0)
  // Two people are left and right; three add the middle; more are counted from the left.
  const names = people === 2 ? [t("freecutAi.shots.left"), t("freecutAi.shots.right")] : people === 3 ? [t("freecutAi.shots.left"), t("freecutAi.shots.middle"), t("freecutAi.shots.right")] : Array.from({ length: people }, (_, i) => formatNumber(i + 1))
  const choice: ShotChoice = { as, first }
  const pressed = "border-[#ff4f9a] text-white"
  const idle = "border-[#262633] text-white/75 hover:bg-white/10"
  return (
    <div className="flex flex-col gap-2.5 border-t border-white/10 px-3 pb-3 pt-2.5">
      <p className="text-[11px] text-white/60">{t("freecutAi.shots.showAs")}</p>
      <div className="grid grid-cols-2 gap-1.5">
        {KINDS.map((kind) => (
          <button
            key={kind}
            type="button"
            aria-pressed={as === kind}
            disabled={busy || people < NEEDS[kind]}
            onClick={() => setAs(kind)}
            className={cn("flex min-h-[76px] flex-col items-center justify-center gap-1.5 rounded-lg border bg-[#0e0e15] px-2 py-2 text-[11px] transition-colors disabled:opacity-40", as === kind ? pressed : idle)}
          >
            <Glyph kind={kind} large />
            {t(NAME[kind])}
          </button>
        ))}
      </div>
      {people > 1 && as !== "whole" ? (
        <>
          <p className="text-[11px] text-white/60">{t("freecutAi.shots.first")}</p>
          <div className="flex flex-wrap gap-1.5">
            {names.map((name, i) => (
              <button key={name} type="button" aria-pressed={first === i} disabled={busy} onClick={() => setFirst(i)} className={cn("min-h-11 min-w-11 flex-1 rounded-lg border bg-[#0e0e15] px-2 text-[11px] transition-colors", first === i ? pressed : idle)}>
                {name}
              </button>
            ))}
          </div>
        </>
      ) : null}
      <button type="button" disabled={busy} onClick={() => onApply(choice, false)} className="min-h-11 rounded-lg bg-cta text-xs font-semibold text-white transition-colors hover:bg-cta-hover disabled:opacity-50">
        {t("freecutAi.shots.change")}
      </button>
      {alike > 1 ? (
        <button type="button" disabled={busy} onClick={() => onApply(choice, true)} className="min-h-11 rounded-lg border border-white/15 text-xs font-medium text-white/85 hover:bg-white/10 disabled:opacity-50">
          {t("freecutAi.shots.applyAll", { n: alike })}
        </button>
      ) : null}
    </div>
  )
}

export interface LayoutShotsProps {
  readonly link: () => EditorLink | null
  readonly refreshKey: string
  /** The face tracks the layout was made from; without them a stretch cannot be shown another way. */
  readonly faces?: ShotTrackSet
  readonly busy: boolean
  readonly onChange: (rows: readonly LayoutRow[], choice: ShotChoice) => void
}

export function LayoutShots({ link, refreshKey, faces, busy, onChange }: LayoutShotsProps) {
  const t = useT()
  const view = useLayoutView(link, refreshKey)
  const [all, setAll] = useState(false)
  const [open, setOpen] = useState<number | null>(null)
  const rows = view ? layoutRows(view) : []
  if (!view || rows.length === 0) return null
  const fps = view.fps
  const shares = layoutShares(rows)
  const total = KINDS.reduce((sum, kind) => sum + shares[kind], 0)
  const shown = all ? rows : rows.slice(0, SHOWN)
  return (
    <section aria-label={t("freecutAi.shots.title")} className="flex flex-col gap-2">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-white/60">{t("freecutAi.shots.title")}</p>
      <div className="flex flex-col gap-2 rounded-lg border border-[#262633] bg-[#121219] px-3 py-2.5">
        <div aria-hidden className="flex h-2 gap-0.5 overflow-hidden rounded-full">
          {KINDS.filter((kind) => shares[kind] > 0).map((kind) => (
            <span key={kind} style={{ background: COLOR[kind], width: `${(shares[kind] / total) * 100}%` }} />
          ))}
        </div>
        <ul className="flex flex-col gap-1 text-[11px] text-white/75">
          {KINDS.filter((kind) => shares[kind] > 0).map((kind) => (
            <li key={kind} className="flex items-center gap-2">
              <span aria-hidden className="h-2.5 w-2.5 rounded-[2px]" style={{ background: COLOR[kind] }} />
              <span className="me-auto">{t(NAME[kind])}</span>
              <span className="font-mono text-white">{clock(shares[kind] / fps)}</span>
            </li>
          ))}
        </ul>
      </div>
      <ul className="flex flex-col gap-1">
        {shown.map((row) => (
          <li key={row.from} className={cn("rounded-lg border bg-[#121219]", open === row.from ? "border-[#ff4f9a]" : "border-[#262633]")}>
            <div className="flex items-stretch">
              <button type="button" onClick={() => link()?.playback("seek", row.from)} className="flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-s-lg px-3 py-1.5 text-start transition-colors hover:bg-white/10">
                <Glyph kind={row.kind} />
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-xs font-medium text-white">{t(NAME[row.kind])}</span>
                  <span className="font-mono text-[11px] text-white/60" dir="ltr">
                    {clock(row.from / fps)} – {clock(row.to / fps)}
                  </span>
                </span>
              </button>
              {faces ? (
                <button
                  type="button"
                  aria-expanded={open === row.from}
                  disabled={busy}
                  onClick={() => {
                    setOpen(open === row.from ? null : row.from)
                    link()?.playback("seek", row.from)
                  }}
                  className="my-1.5 me-2 min-h-8 shrink-0 self-center rounded-md border border-[#ff4f9a]/70 px-3 text-[11px] font-semibold text-[#ff8fbd] transition-colors hover:bg-[#ff0073]/15 hover:text-white disabled:opacity-50"
                >
                  {t(open === row.from ? "freecutAi.shots.closeChange" : "freecutAi.shots.change")}
                </button>
              ) : null}
            </div>
            {faces && open === row.from ? (
              <ChangeShot
                row={row}
                people={peopleInRow(view, row, faces)}
                alike={rows.filter((r) => r.kind === row.kind).length}
                busy={busy}
                onApply={(choice, everywhere) => {
                  setOpen(null)
                  onChange(everywhere ? rows.filter((r) => r.kind === row.kind) : [row], choice)
                }}
              />
            ) : null}
          </li>
        ))}
      </ul>
      {rows.length > SHOWN ? (
        <button type="button" onClick={() => setAll(!all)} className="min-h-11 rounded-lg border border-white/15 text-xs font-medium text-white/85 hover:bg-white/10">
          {all ? t("freecutAi.shots.showLess") : t("freecutAi.shots.showAll", { n: rows.length })}
        </button>
      ) : null}
    </section>
  )
}
