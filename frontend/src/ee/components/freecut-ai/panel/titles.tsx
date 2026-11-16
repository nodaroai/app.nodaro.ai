/**
 * The texts on the screen, in order. A row takes the editor's playhead there,
 * and "Change" opens it: what it says, the words in color, where it sits, how
 * it comes in, the key color, and taking it off. Read from the editor's
 * timeline, so it follows later cuts and an undo.
 */
import { useState } from "react"
import { useT, type MessageKey } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import type { EditorLink } from "@/ee/lib/freecut-ai/editor-link"
import type { TitleChoiceChange } from "@/ee/lib/freecut-ai/run/titles"
import { recordOf, titleRows, type TitleRow } from "@/ee/lib/freecut-ai/title-rows"
import { TITLE_BACKGROUND_COLORS, TITLE_ENTRIES, TITLE_KEY_COLORS, TITLE_PLACES, TITLE_TEXT_COLORS, backgroundOf, keyColorOf, textColorOf, type TitleEntry, type TitleKind, type TitleLook, type TitlePlace, type TitleRecord } from "@/ee/lib/freecut-ai/title-style"
import { usePicturesView } from "./pictures"

const SHOWN = 8

const KIND_NAME: Record<TitleKind, MessageKey> = {
  headline: "freecutAi.titles.kind.headline",
  words: "freecutAi.titles.kind.words",
  number: "freecutAi.titles.kind.number",
  list: "freecutAi.titles.kind.list",
}
const KIND_MARK: Record<TitleKind, string> = { headline: "T", words: "A", number: "%", list: "1" }
const PLACE_NAME: Record<TitlePlace, MessageKey> = {
  top: "freecutAi.titles.place.top",
  middle: "freecutAi.titles.place.middle",
  low: "freecutAi.titles.place.low",
}
const ENTRY_NAME: Record<TitleEntry, MessageKey> = {
  pop: "freecutAi.titles.entry.pop",
  rise: "freecutAi.titles.entry.rise",
  type: "freecutAi.titles.entry.type",
  blur: "freecutAi.titles.entry.blur",
}

/** A color's name, for the ones the panel offers. */
const COLOR_NAME: Record<string, MessageKey> = {
  "#8FDC5C": "freecutAi.titles.color.green",
  "#FFD60A": "freecutAi.titles.color.yellow",
  "#FF0073": "freecutAi.titles.color.pink",
  "#4CC9F0": "freecutAi.titles.color.blue",
  "#3B5BDB": "freecutAi.titles.color.blue",
  "#FFFFFF": "freecutAi.titles.color.white",
  "#0B0B0C": "freecutAi.titles.color.black",
}
const same = (a: string | null, b: string | null) => (a ?? "").toLowerCase() === (b ?? "").toLowerCase()

/**
 * One color: the colors the panel offers, any other color from the browser's
 * own picker, and, where there can be none (a background), "None".
 */
function ColorField({ id, label, options, value, none = false, busy, onPick }: { readonly id: string; readonly label: string; readonly options: readonly string[]; readonly value: string | null; readonly none?: boolean; readonly busy: boolean; readonly onPick: (value: string | null) => void }) {
  const t = useT()
  const swatch = (on: boolean) => cn("flex h-11 w-11 shrink-0 items-center justify-center rounded-lg border bg-[#141417] disabled:opacity-40", on ? "border-white" : "border-[#2D2D2D]")
  const offered = options.some((option) => same(option, value))
  return (
    <>
      <p className="text-[11px] text-white/60">{label}</p>
      <div role="radiogroup" aria-label={label} className="flex flex-wrap gap-1">
        {none ? (
          <button type="button" role="radio" aria-checked={value === null} disabled={busy} onClick={() => onPick(null)} className={cn(swatch(value === null), "w-auto px-2.5 text-[11px] text-white/85")}>
            {t("freecutAi.titles.noBackground")}
          </button>
        ) : null}
        {options.map((option) => (
          <button key={option} type="button" role="radio" aria-checked={same(option, value)} aria-label={COLOR_NAME[option] ? t(COLOR_NAME[option]) : option} disabled={busy} onClick={() => onPick(option)} className={swatch(same(option, value))}>
            <span aria-hidden className="h-5 w-5 rounded-full border border-white/25" style={{ background: option }} />
          </button>
        ))}
        <label htmlFor={id} className={cn(swatch(value !== null && !offered), "relative cursor-pointer")}>
          <span className="sr-only">{t("freecutAi.titles.anyColor")}</span>
          <span aria-hidden className="h-5 w-5 rounded-full border border-white/25" style={{ background: value !== null && !offered ? value : "conic-gradient(#ff0073, #ffd60a, #8fdc5c, #4cc9f0, #3b5bdb, #ff0073)" }} />
          <input id={id} type="color" value={value ?? "#ffffff"} disabled={busy} onChange={(e) => onPick(e.target.value.toUpperCase())} className="absolute inset-0 h-full w-full cursor-pointer opacity-0" />
        </label>
      </div>
    </>
  )
}
/** The longest text the field takes: a text on the screen is a few words. */
const MOST_LETTERS = 120

const clock = (seconds: number) => `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, "0")}`

function Choice<T extends string>({ label, options, names, value, busy, onPick }: { readonly label: string; readonly options: readonly T[]; readonly names: Record<T, MessageKey>; readonly value: T; readonly busy: boolean; readonly onPick: (value: T) => void }) {
  const t = useT()
  return (
    <>
      <p className="text-[11px] text-white/60">{label}</p>
      <div role="radiogroup" aria-label={label} className="flex gap-1">
        {options.map((option) => (
          <button
            key={option}
            type="button"
            role="radio"
            aria-checked={value === option}
            disabled={busy}
            onClick={() => onPick(option)}
            className={cn("min-h-11 flex-1 rounded-lg border bg-[#141417] px-1 text-[11px] transition-colors disabled:opacity-40", value === option ? "border-[#ff4f9a] text-white" : "border-[#2D2D2D] text-white/75 hover:bg-white/10")}
          >
            {t(names[option])}
          </button>
        ))}
      </div>
    </>
  )
}

/** One text, open: what it says and how it shows. */
function ChangeTitle({ row, record, others, busy, onApply }: { readonly row: TitleRow; readonly record: TitleRecord; /** The other texts, for "the same colors on all". */ readonly others: readonly TitleRecord[]; readonly busy: boolean; readonly onApply: (change: TitleChoiceChange) => void }) {
  const t = useT()
  const [text, setText] = useState(record.text)
  const [key, setKey] = useState(record.key)
  const [sub, setSub] = useState(record.sub ?? "")
  const [place, setPlace] = useState(record.place)
  const [entry, setEntry] = useState(record.entry)
  const [color, setColor] = useState(keyColorOf(record))
  const [ink, setInk] = useState(textColorOf(record))
  const [behind, setBehind] = useState(backgroundOf(record))
  const field = "rounded-lg border border-[#2D2D2D] bg-[#141417] px-2.5 py-2 text-xs text-white outline-none focus:border-[#ff4f9a] disabled:opacity-50"
  const said = text.trim()
  const next: TitleRecord = { ...record, text: said, key: key.trim(), ...(record.kind === "number" ? { sub: sub.trim() } : {}), place, entry, color, textColor: ink, background: behind }
  return (
    <div className="flex flex-col gap-2.5 border-t border-white/10 px-3 pb-3 pt-2.5">
      <label htmlFor={`ai-title-text-${row.key}`} className="text-[11px] text-white/60">{t("freecutAi.titles.theText")}</label>
      <textarea id={`ai-title-text-${row.key}`} value={text} disabled={busy} rows={record.kind === "list" ? 4 : 2} maxLength={MOST_LETTERS} dir="auto" onChange={(e) => setText(e.target.value)} className={cn("resize-none", field)} />
      {record.kind === "number" ? (
        <>
          <label htmlFor={`ai-title-sub-${row.key}`} className="text-[11px] text-white/60">{t("freecutAi.titles.sub")}</label>
          <input id={`ai-title-sub-${row.key}`} value={sub} disabled={busy} maxLength={MOST_LETTERS} dir="auto" onChange={(e) => setSub(e.target.value)} className={field} />
        </>
      ) : null}
      {record.kind === "headline" || record.kind === "words" ? (
        <>
          <label htmlFor={`ai-title-key-${row.key}`} className="text-[11px] text-white/60">{t("freecutAi.titles.keyWords")}</label>
          <input id={`ai-title-key-${row.key}`} value={key} disabled={busy} maxLength={MOST_LETTERS} dir="auto" onChange={(e) => setKey(e.target.value)} className={field} />
        </>
      ) : null}
      <Choice label={t("freecutAi.titles.where")} options={TITLE_PLACES} names={PLACE_NAME} value={place} busy={busy} onPick={setPlace} />
      <Choice label={t("freecutAi.titles.entry")} options={TITLE_ENTRIES} names={ENTRY_NAME} value={entry} busy={busy} onPick={setEntry} />
      <ColorField id={`ai-title-ink-${row.key}`} label={t("freecutAi.titles.textColor")} options={TITLE_TEXT_COLORS} value={ink} busy={busy} onPick={(value) => setInk(value ?? ink)} />
      {record.kind === "list" ? null : <ColorField id={`ai-title-keycolor-${row.key}`} label={t("freecutAi.titles.keyColor")} options={TITLE_KEY_COLORS} value={color} busy={busy} onPick={(value) => setColor(value ?? color)} />}
      <ColorField id={`ai-title-behind-${row.key}`} label={t("freecutAi.titles.background")} options={TITLE_BACKGROUND_COLORS} value={behind} none busy={busy} onPick={setBehind} />
      <button type="button" disabled={busy || !said} onClick={() => onApply({ kind: "set", record: next })} className="min-h-11 rounded-lg bg-cta px-3 text-xs font-semibold text-white transition-colors hover:bg-cta-hover disabled:opacity-50">
        {t("freecutAi.titles.apply")}
      </button>
      {others.length > 0 ? (
        <button type="button" disabled={busy || !said} onClick={() => onApply({ kind: "set", record: next, also: others.map((other) => ({ ...other, color, textColor: ink, background: behind })) })} className="min-h-11 rounded-lg border border-white/15 px-3 text-xs font-medium text-white/85 hover:bg-white/10 disabled:opacity-50">
          {t("freecutAi.titles.applyAll")}
        </button>
      ) : null}
      <button type="button" disabled={busy} onClick={() => onApply({ kind: "remove" })} className="min-h-11 rounded-lg border border-white/15 px-3 text-xs font-medium text-white/85 hover:bg-white/10 disabled:opacity-50">
        {t("freecutAi.titles.remove")}
      </button>
    </div>
  )
}

export interface TitlesProps {
  readonly link: () => EditorLink | null
  readonly refreshKey: string
  /** What the run knows about the texts it laid. */
  readonly records: readonly TitleRecord[]
  /** The look a text is taken to have when the panel no longer remembers laying it. */
  readonly look: TitleLook
  readonly busy: boolean
  readonly onChange: (row: TitleRow, change: TitleChoiceChange) => void
}

export function Titles({ link, refreshKey, records, look, busy, onChange }: TitlesProps) {
  const t = useT()
  const view = usePicturesView(link, refreshKey)
  const [all, setAll] = useState(false)
  const [open, setOpen] = useState<string | null>(null)
  const rows = view ? titleRows(view, records) : []
  if (!view || rows.length === 0) return null
  const fps = view.fps
  const shown = all ? rows : rows.slice(0, SHOWN)
  return (
    <section aria-label={t("freecutAi.titles.title")} className="flex flex-col gap-2">
      <p className="text-[11px] font-semibold uppercase tracking-wide text-white/60">{t("freecutAi.titles.title")}</p>
      <ul className="flex flex-col gap-1">
        {shown.map((row) => {
          const record = recordOf(row, look)
          return (
            <li key={row.key} className={cn("rounded-lg border bg-[#1E1E1E]", open === row.key ? "border-[#ff4f9a]" : "border-[#2D2D2D]")}>
              <div className="flex items-stretch">
                <button type="button" onClick={() => link()?.playback("seek", row.from)} className="flex min-h-11 min-w-0 flex-1 items-center gap-3 rounded-s-lg px-3 py-1.5 text-start transition-colors hover:bg-white/10">
                  <span aria-hidden className="flex h-7 w-[18px] shrink-0 items-center justify-center rounded-[3px] bg-white/10 text-[11px] font-bold" style={{ color: keyColorOf(record) }}>
                    {KIND_MARK[record.kind]}
                  </span>
                  <span className="flex min-w-0 flex-col">
                    <span className="truncate text-xs font-medium text-white" dir="auto">{record.text.replace(/\n/g, " · ")}</span>
                    <span className="text-[11px] text-white/60">
                      {t(KIND_NAME[record.kind])}
                      <span className="ms-2 font-mono" dir="ltr">
                        {clock(row.from / fps)} – {clock(row.to / fps)}
                      </span>
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
                <ChangeTitle
                  row={row}
                  record={record}
                  others={rows.filter((other) => other.key !== row.key).map((other) => recordOf(other, look))}
                  busy={busy}
                  onApply={(change) => {
                    setOpen(null)
                    onChange(row, change)
                  }}
                />
              ) : null}
            </li>
          )
        })}
      </ul>
      {rows.length > SHOWN ? (
        <button type="button" onClick={() => setAll(!all)} className="min-h-11 rounded-lg border border-white/15 text-xs font-medium text-white/85 hover:bg-white/10">
          {all ? t("freecutAi.shots.showLess") : t("freecutAi.titles.showAll", { n: rows.length })}
        </button>
      ) : null}
    </section>
  )
}
