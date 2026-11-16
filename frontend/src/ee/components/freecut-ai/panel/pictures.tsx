/**
 * The pictures on the words (b-roll): how many came from where, and each one
 * in order. A row takes the editor's playhead there, and "Change" opens it:
 * the words it illustrates, what it shows, and the ways to change it (made
 * again from other words, the person's own picture, or taken off). A picture
 * the image model would not make stays in the list, with the reason it gave.
 * Read from the editor's timeline, so it follows later cuts and an undo.
 */
import { useEffect, useRef, useState } from "react"
import { Minus, Plus } from "lucide-react"
import { formatNumber, useT, type MessageKey } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import type { EditorLink } from "@/ee/lib/freecut-ai/editor-link"
import { readTimelineView, type TimelineView } from "@/ee/lib/freecut-ai/edit-plan"
import { PICTURE_PLACES, placeOf, type PicturePlace } from "@/ee/lib/freecut-ai/picture-place"
import { pictureCounts, pictureRows, type PictureRecord, type PictureRow, type PictureSource } from "@/ee/lib/freecut-ai/picture-rows"
import { PICTURE_LONGEST_SECONDS, PICTURE_SHORTEST_SECONDS, type PictureChoice, type PictureSourceChoice } from "@/ee/lib/freecut-ai/run/change-picture"

const NAME: Record<PictureSource, MessageKey> = {
  made: "freecutAi.pictures.made",
  mine: "freecutAi.pictures.mine",
  none: "freecutAi.pictures.none",
}
/** One colour per source, told apart by lightness as well as hue. */
const COLOR: Record<PictureSource, string> = { made: "#8fdc5c", mine: "#6ea0ff", none: "#8a8a94" }
const SOURCES: readonly PictureSource[] = ["made", "mine", "none"]
const SHOWN = 8

const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`

/** A small picture frame in its source's colour; one that was not made is an empty, dashed frame. */
function Glyph({ source }: { readonly source: PictureSource }) {
  return <span aria-hidden className={cn("h-7 w-[18px] shrink-0 rounded-[3px]", source === "none" && "border border-dashed")} style={source === "none" ? { borderColor: COLOR.none } : { background: COLOR[source] }} />
}

export function usePicturesView(link: () => EditorLink | null, refreshKey: string): TimelineView | null {
  const [view, setView] = useState<TimelineView | null>(null)
  useEffect(() => {
    let live = true
    let timer: ReturnType<typeof setTimeout> | undefined
    // Asked again until the editor answers: a panel opened on a saved edit comes up before the editor has loaded it.
    const read = async (attempt: number) => {
      let found = false
      try {
        const next = readTimelineView(await link()?.getTimeline())
        if (!live) return
        if (next) {
          found = true
          setView(next)
        }
      } catch {
        // The editor is closed or still opening.
      }
      if (live && !found && attempt < 20) timer = setTimeout(() => void read(attempt + 1), 1500)
    }
    void read(0)
    return () => {
      live = false
      clearTimeout(timer)
    }
  }, [link, refreshKey])
  return view
}

/** One picture, open: its words, what it shows, and the ways to change it. */
const PLACE_NAME: Record<PicturePlace, MessageKey> = {
  split: "freecutAi.pictures.place.split",
  window: "freecutAi.pictures.place.window",
  full: "freecutAi.pictures.place.full",
}

/** A small picture of the frame: where the picture (lit) shows, beside the speaker's part (dim). */
function PlaceGlyph({ place, tall }: { readonly place: PicturePlace; readonly tall: boolean }) {
  const lit = "rounded-[2px] bg-[#8fdc5c]"
  const dim = "rounded-[2px] bg-white/20"
  return (
    <span aria-hidden className={cn("relative flex shrink-0 gap-0.5", tall ? "h-9 w-5 flex-col" : "h-5 w-9")}>
      {place === "full" ? <span className={cn("flex-1", lit)} /> : null}
      {place === "split" ? (
        <>
          <span className={cn("flex-1", lit)} />
          <span className={cn("flex-1", dim)} />
        </>
      ) : null}
      {place === "window" ? (
        <>
          <span className={cn("flex-1", dim)} />
          <span className={cn("absolute", lit, tall ? "inset-x-[3px] top-[3px] h-[40%]" : "inset-y-[3px] start-[3px] w-[50%]")} />
        </>
      ) : null}
    </span>
  )
}

/** How long a picture stays: half a second shorter or longer at a tap. */
function PictureLength({ seconds, busy, onSeconds }: { readonly seconds: number; readonly busy: boolean; readonly onSeconds: (seconds: number) => void }) {
  const t = useT()
  const step = "flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border border-[#2D2D2D] bg-[#141417] text-white/85 transition-colors hover:bg-white/10 disabled:opacity-40"
  const shown = Math.round(seconds * 2) / 2
  return (
    <>
      <p className="text-[11px] text-white/60">{t("freecutAi.pictures.length")}</p>
      <div className="flex items-center gap-1.5">
        <button type="button" aria-label={t("freecutAi.pictures.shorter")} disabled={busy || shown <= PICTURE_SHORTEST_SECONDS} onClick={() => onSeconds(shown - 0.5)} className={step}>
          <Minus className="h-3.5 w-3.5" />
        </button>
        <p className="min-w-0 flex-1 text-center text-xs font-medium text-white" role="status">
          {t("freecutAi.pictures.seconds", { n: formatNumber(shown) })}
        </p>
        <button type="button" aria-label={t("freecutAi.pictures.longer")} disabled={busy || shown >= PICTURE_LONGEST_SECONDS} onClick={() => onSeconds(shown + 0.5)} className={step}>
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>
    </>
  )
}

/** A picture added by hand where the playhead is: what it shows in words, or a picture of the person's own. */
function AddPicture({ busy, price, onAdd }: { readonly busy: boolean; readonly price?: string; readonly onAdd: (choice: PictureSourceChoice) => void }) {
  const t = useT()
  const [open, setOpen] = useState(false)
  const [words, setWords] = useState("")
  const file = useRef<HTMLInputElement>(null)
  const other = "min-h-11 rounded-lg border border-white/15 px-3 text-xs font-medium text-white/85 hover:bg-white/10 disabled:opacity-50"
  const said = words.trim()
  const done = (choice: PictureSourceChoice) => {
    setOpen(false)
    setWords("")
    onAdd(choice)
  }
  if (!open) {
    return (
      <button type="button" disabled={busy} onClick={() => setOpen(true)} className={other}>
        {t("freecutAi.pictures.add")}
      </button>
    )
  }
  return (
    <div className="flex flex-col gap-2.5 rounded-lg border border-[#ff4f9a] bg-[#1E1E1E] p-3">
      <label htmlFor="ai-picture-add-words" className="text-[11px] text-white/60">{t("freecutAi.pictures.addHint")}</label>
      <textarea id="ai-picture-add-words" value={words} disabled={busy} rows={3} maxLength={600} dir="auto" onChange={(e) => setWords(e.target.value)} className="resize-none rounded-lg border border-[#2D2D2D] bg-[#141417] px-2.5 py-2 text-xs text-white outline-none focus:border-[#ff4f9a] disabled:opacity-50" />
      <input
        ref={file}
        id="ai-picture-add-file"
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(e) => {
          const picked = e.target.files?.[0]
          e.target.value = ""
          if (picked) done({ kind: "mine", file: picked })
        }}
      />
      <button type="button" disabled={busy || !said} onClick={() => done({ kind: "again", prompt: said })} className="min-h-11 rounded-lg bg-cta px-3 text-xs font-semibold text-white transition-colors hover:bg-cta-hover disabled:opacity-50">
        {price ? t("freecutAi.pictures.make", { price }) : t("freecutAi.pictures.makePlain")}
      </button>
      <button type="button" disabled={busy} onClick={() => file.current?.click()} className={other}>{t("freecutAi.pictures.own")}</button>
      <button type="button" disabled={busy} onClick={() => setOpen(false)} className={other}>{t("common.cancel")}</button>
    </div>
  )
}

function ChangePicture({ row, busy, price, place, tall, fps, onApply }: { readonly row: PictureRow; readonly busy: boolean; readonly price?: string; readonly place?: PicturePlace; readonly tall: boolean; readonly fps: number; readonly onApply: (choice: PictureChoice) => void }) {
  const t = useT()
  const record: PictureRecord | undefined = row.record
  const [prompt, setPrompt] = useState(record?.prompt ?? "")
  const file = useRef<HTMLInputElement>(null)
  const missing = row.source === "none"
  const words = prompt.trim()
  const main = "min-h-11 rounded-lg bg-cta px-3 text-xs font-semibold text-white transition-colors hover:bg-cta-hover disabled:opacity-50"
  const other = "min-h-11 rounded-lg border border-white/15 px-3 text-xs font-medium text-white/85 hover:bg-white/10 disabled:opacity-50"
  const again = missing ? (price ? t("freecutAi.pictures.tryWords", { price }) : t("freecutAi.pictures.tryWordsPlain")) : price ? t("freecutAi.pictures.again", { price }) : t("freecutAi.pictures.againPlain")
  return (
    <div className="flex flex-col gap-2.5 border-t border-white/10 px-3 pb-3 pt-2.5">
      {record?.url && !missing ? <img src={record.url} alt={t("freecutAi.pictures.now")} className="max-h-40 w-full rounded-lg object-cover" /> : null}
      {missing ? (
        <div className="flex flex-col gap-1 text-[11px] text-[#f5b84a]" role="status">
          <p>{t("freecutAi.pictures.notMade")}</p>
          {record?.reason ? <p dir="auto">{record.reason}</p> : null}
        </div>
      ) : null}
      {place ? (
        <>
          <p className="text-[11px] text-white/60">{t("freecutAi.pictures.where")}</p>
          <div className="grid grid-cols-3 gap-1.5">
            {PICTURE_PLACES.map((to) => (
              <button
                key={to}
                type="button"
                aria-pressed={place === to}
                disabled={busy}
                onClick={() => {
                  if (to !== place) onApply({ kind: "place", place: to })
                }}
                className={cn("flex min-h-[68px] flex-col items-center justify-center gap-1.5 rounded-lg border bg-[#141417] px-1.5 py-2 text-center text-[11px] transition-colors disabled:opacity-40", place === to ? "border-[#ff4f9a] text-white" : "border-[#2D2D2D] text-white/75 hover:bg-white/10")}
              >
                <PlaceGlyph place={to} tall={tall} />
                {t(PLACE_NAME[to])}
              </button>
            ))}
          </div>
        </>
      ) : null}
      {place ? <PictureLength seconds={(row.to - row.from) / fps} busy={busy} onSeconds={(seconds) => onApply({ kind: "length", seconds })} /> : null}
      {record?.said ? (
        <>
          <p className="text-[11px] text-white/60">{t("freecutAi.pictures.said")}</p>
          <p className="rounded-lg border border-[#2D2D2D] bg-[#141417] px-2.5 py-2 text-xs text-white/75" dir="auto">{record.said}</p>
        </>
      ) : null}
      <label htmlFor={`ai-picture-shows-${row.key}`} className="text-[11px] text-white/60">{t("freecutAi.pictures.shows")}</label>
      <textarea
        id={`ai-picture-shows-${row.key}`}
        value={prompt}
        disabled={busy}
        rows={3}
        dir="auto"
        onChange={(e) => setPrompt(e.target.value)}
        className="resize-none rounded-lg border border-[#2D2D2D] bg-[#141417] px-2.5 py-2 text-xs text-white outline-none focus:border-[#ff4f9a] disabled:opacity-50"
      />
      <input
        ref={file}
        id={`ai-picture-file-${row.key}`}
        type="file"
        accept="image/png,image/jpeg,image/webp"
        className="hidden"
        onChange={(e) => {
          const picked = e.target.files?.[0]
          e.target.value = ""
          if (picked) onApply({ kind: "mine", file: picked })
        }}
      />
      {missing ? (
        <>
          <button type="button" disabled={busy} onClick={() => file.current?.click()} className={main}>{t("freecutAi.pictures.own")}</button>
          <button type="button" disabled={busy || !words} onClick={() => onApply({ kind: "again", prompt: words })} className={other}>{again}</button>
          <button type="button" disabled={busy} onClick={() => onApply({ kind: "remove" })} className={other}>{t("freecutAi.pictures.leave")}</button>
        </>
      ) : (
        <>
          <button type="button" disabled={busy || !words} onClick={() => onApply({ kind: "again", prompt: words })} className={main}>{again}</button>
          <button type="button" disabled={busy} onClick={() => file.current?.click()} className={other}>{t("freecutAi.pictures.own")}</button>
          <button type="button" disabled={busy} onClick={() => onApply({ kind: "remove" })} className={other}>{t("freecutAi.pictures.remove")}</button>
        </>
      )}
    </div>
  )
}

export interface PicturesProps {
  readonly link: () => EditorLink | null
  readonly refreshKey: string
  /** What the b-roll run knows about its pictures. */
  readonly records: readonly PictureRecord[]
  readonly busy: boolean
  /** One picture's price, in words ("11 credits"), once known. */
  readonly price?: string
  readonly onChange: (row: PictureRow, choice: PictureChoice) => void
  /** A picture added by hand at the playhead. */
  readonly onAdd: (choice: PictureSourceChoice) => void
}

export function Pictures({ link, refreshKey, records, busy, price, onChange, onAdd }: PicturesProps) {
  const t = useT()
  const view = usePicturesView(link, refreshKey)
  const [all, setAll] = useState(false)
  const [open, setOpen] = useState<string | null>(null)
  const rows = view ? pictureRows(view, records) : []
  // With a video on the timeline a picture can always be added by hand, so the section shows before any were made.
  if (!view || !view.items.some((i) => i.type === "video")) return null
  const fps = view.fps
  const counts = pictureCounts(rows)
  const shown = all ? rows : rows.slice(0, SHOWN)
  const tall = (view.height ?? 0) > (view.width ?? 0)
  /** How a picture on the timeline shows now; a picture that was not made has no place yet. */
  const placeFor = (row: PictureRow): PicturePlace | undefined => {
    const item = row.itemId ? view.items.find((i) => i.id === row.itemId) : undefined
    return item ? placeOf(view, item) : undefined
  }
  return (
    <section aria-label={t("freecutAi.pictures.title")} className="flex flex-col gap-2">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-white/60">{t("freecutAi.pictures.title")}</p>
      {rows.length > 0 ? <div className="flex flex-col gap-2 rounded-lg border border-[#2D2D2D] bg-[#1E1E1E] px-3 py-2.5">
        <div aria-hidden className="flex h-2 gap-0.5 overflow-hidden rounded-full">
          {SOURCES.filter((source) => counts[source] > 0).map((source) => (
            <span key={source} style={{ background: COLOR[source], width: `${(counts[source] / rows.length) * 100}%` }} />
          ))}
        </div>
        <ul className="flex flex-col gap-1 text-[11px] text-white/75">
          {SOURCES.filter((source) => counts[source] > 0).map((source) => (
            <li key={source} className="flex items-center gap-2">
              <span aria-hidden className="h-2.5 w-2.5 rounded-[2px]" style={{ background: COLOR[source] }} />
              <span className="me-auto">{t(NAME[source])}</span>
              <span className="font-mono text-white">{counts[source]}</span>
            </li>
          ))}
        </ul>
      </div> : null}
      <ul className="flex flex-col gap-1">
        {shown.map((row) => (
          <li key={row.key} className={cn("rounded-lg border bg-[#1E1E1E]", open === row.key ? "border-[#ff4f9a]" : row.source === "none" ? "border-dashed border-[#8a8a94]" : "border-[#2D2D2D]")}>
            <div className="flex items-stretch">
              <button type="button" onClick={() => link()?.playback("seek", row.from)} className="flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-s-lg px-3 py-1.5 text-start transition-colors hover:bg-white/10">
                <Glyph source={row.source} />
                <span className="flex min-w-0 flex-col">
                  <span className="truncate text-xs font-medium text-white" dir="auto">{row.record?.label || t("freecutAi.pictures.unnamed")}</span>
                  <span className="font-mono text-[11px] text-white/60" dir="ltr">
                    {clock(row.from / fps)} – {clock(row.to / fps)}
                  </span>
                </span>
              </button>
              <button
                type="button"
                aria-expanded={open === row.key}
                disabled={busy}
                onClick={() => {
                  setOpen(open === row.key ? null : row.key)
                  link()?.playback("seek", row.from)
                }}
                className="my-1.5 me-2 min-h-8 shrink-0 self-center rounded-md border border-[#ff4f9a]/70 px-3 text-[11px] font-semibold text-[#ff8fbd] transition-colors hover:bg-[#ff0073]/15 hover:text-white disabled:opacity-50"
              >
                {t(open === row.key ? "freecutAi.shots.closeChange" : "freecutAi.shots.change")}
              </button>
            </div>
            {open === row.key ? (
              <ChangePicture
                row={row}
                busy={busy}
                price={price}
                place={placeFor(row)}
                tall={tall}
                fps={fps}
                onApply={(choice) => {
                  // A change of length keeps the picture open: it is often tapped more than once.
                  if (choice.kind !== "length") setOpen(null)
                  onChange(row, choice)
                }}
              />
            ) : null}
          </li>
        ))}
      </ul>
      <AddPicture busy={busy} price={price} onAdd={onAdd} />
      {rows.length > SHOWN ? (
        <button type="button" onClick={() => setAll(!all)} className="min-h-11 rounded-lg border border-white/15 text-xs font-medium text-white/85 hover:bg-white/10">
          {all ? t("freecutAi.shots.showLess") : t("freecutAi.pictures.showAll", { n: rows.length })}
        </button>
      ) : null}
    </section>
  )
}
