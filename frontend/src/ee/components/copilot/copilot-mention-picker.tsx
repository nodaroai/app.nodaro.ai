/**
 * `@` picker over the user's own entities and files — now shaped like the
 * Studio's reference picker: kind TABS with counts, search within the active
 * tab (with a cross-tab hint so a match on another tab is never invisible),
 * a variant DRILL-IN on characters, and an expand button to the full-size
 * browser (`copilot-mention-modal.tsx`).
 *
 * A mention still travels to the model as a NAME plus an id — picking a
 * VARIANT changes only the inserted prose (`@Iris (the "back" angle)`); the
 * doctrine turns that phrase into an `@slug:N:variant` prompt token itself,
 * so no wire format changed for this feature.
 *
 * The list arrives as ONE array and is grouped here by kind. A prop per kind is
 * what let this surface sit at two kinds while the library had four.
 */
import { useEffect, useMemo, useRef, useState } from "react"
import { ChevronLeft, ChevronRight, Maximize2, ZoomIn } from "lucide-react"
import { CachedImage } from "@/components/ui/cached-image"
import { COPILOT_STRINGS as S } from "@/ee/lib/copilot/strings"
import { filterMentions } from "@/ee/lib/copilot/mentions"
import {
  MENTION_KINDS,
  type CopilotMention,
  type CopilotMentionVariant,
  type MentionKind,
} from "@/ee/lib/copilot/types"
import { MentionPreview, type MentionPreviewContent } from "./copilot-mention-preview"

/** The composer's `aria-controls` target. */
export const MENTION_LIST_ID = "copilot-mention-list"

/** Everything that differs per kind, one row each. Round for living things. */
export const KIND_UI: Record<MentionKind, { section: string; chip: string; round: boolean }> = {
  character: { section: S.sectionCharacters, chip: S.kindCharacter, round: true },
  object: { section: S.sectionObjects, chip: S.kindObject, round: false },
  creature: { section: S.sectionCreatures, chip: S.kindCreature, round: true },
  location: { section: S.sectionLocations, chip: S.kindLocation, round: false },
  image: { section: S.sectionFiles, chip: S.kindImage, round: false },
  video: { section: S.sectionFiles, chip: S.kindVideo, round: false },
  audio: { section: S.sectionFiles, chip: S.kindAudio, round: false },
}

/** Tab order = kind order; the three file kinds share one tab. */
export const SECTION_TABS: string[] = [...new Set(MENTION_KINDS.map((kind) => KIND_UI[kind].section))]

export function sectionOf(mention: CopilotMention): string {
  return KIND_UI[mention.kind].section
}

/** One navigable row of the drill-in pane. */
type DrillRow = { kind: "back" } | { kind: "default" } | { kind: "variant"; variant: CopilotMentionVariant }

interface CopilotMentionPickerProps {
  /** The server-side total for FILES — what arrived is not what the user has. */
  fileTotal?: number | null
  /** More file pages exist on the server. */
  hasMoreFiles?: boolean
  /** Pull the next page. Called when the list is scrolled near its end. */
  onLoadMoreFiles?: () => void
  query: string
  /** Every mentionable entity, any kind, any order — grouped here. */
  mentions: CopilotMention[]
  onPick: (mention: CopilotMention, variant?: CopilotMentionVariant) => void
  /** Reported up so the textarea's `aria-activedescendant` can follow the arrow keys. */
  onActiveChange: (optionId: string | undefined) => void
  onClose: () => void
  /**
   * The expand button hands the COMPOSER the active tab and the composer opens
   * the full-size browser itself. The browser must not be a child of this
   * picker: the picker unmounts the moment the composer's input blurs — which
   * the browser's own search-field autofocus causes — so a child modal died
   * within a frame of opening (the "expand does nothing" bug).
   */
  onExpand: (tab: string) => void
  /**
   * Horizontal inset, so the list lines up with the composer that owns it: the
   * editor rail insets its own padding, the home dock is flush with the glass.
   */
  insetClassName?: string
  /**
   * The lists are still arriving. Without this the picker would tell a user
   * with fifty characters that they have none — the home dock does not fetch
   * while it is collapsed, so expanding it and reaching straight for `@` is a
   * real path, not a theoretical one.
   */
  loading?: boolean
}

const optionId = (suffix: string) => `copilot-mention-${suffix}`

export function CopilotMentionPicker({
  query,
  mentions,
  onPick,
  onActiveChange,
  onClose,
  onExpand,
  insetClassName = "left-3.5 right-3.5",
  loading = false,
  fileTotal = null,
  hasMoreFiles = false,
  onLoadMoreFiles,
}: CopilotMentionPickerProps) {
  const counts = useMemo(() => {
    const map = new Map<string, number>(SECTION_TABS.map((tab) => [tab, 0]))
    for (const mention of mentions) map.set(sectionOf(mention), (map.get(sectionOf(mention)) ?? 0) + 1)
    return map
  }, [mentions])

  const firstNonEmptyTab = SECTION_TABS.find((tab) => (counts.get(tab) ?? 0) > 0) ?? SECTION_TABS[0]!
  const [tab, setTab] = useState(firstNonEmptyTab)
  const [drill, setDrill] = useState<CopilotMention | null>(null)
  const [preview, setPreview] = useState<(MentionPreviewContent & { insert: () => void }) | null>(null)
  const [active, setActive] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  /**
   * An `onPreview` for a row that HAS an image, and `undefined` for one that
   * does not — which is what makes the thumb render bare, with no magnifier
   * promising a picture there is none of. Same shape as the browser modal's.
   */
  const previewOf = (
    src: string | null,
    label: string,
    sub: string,
    insert: () => void,
  ): (() => void) | undefined => (src ? () => setPreview({ src, label, sub, insert }) : undefined)

  // A collection that loads after mount must not leave the picker on an empty
  // default tab while another tab has everything.
  useEffect(() => {
    if ((counts.get(tab) ?? 0) === 0 && (counts.get(firstNonEmptyTab) ?? 0) > 0) setTab(firstNonEmptyTab)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [firstNonEmptyTab])

  const tabItems = useMemo(
    () => filterMentions(mentions.filter((m) => sectionOf(m) === tab), query),
    [mentions, tab, query],
  )

  /** Matches the query finds on OTHER tabs — a hit must never be invisible. */
  const otherTabMatches = useMemo(() => {
    if (!query.trim()) return []
    const byTab = new Map<string, number>()
    for (const mention of filterMentions(mentions, query)) {
      const section = sectionOf(mention)
      if (section === tab) continue
      byTab.set(section, (byTab.get(section) ?? 0) + 1)
    }
    return SECTION_TABS.filter((t) => byTab.has(t)).map((t) => ({ tab: t, count: byTab.get(t)! }))
  }, [mentions, tab, query])

  const drillRows: DrillRow[] = useMemo(() => {
    if (!drill) return []
    return [
      { kind: "back" },
      { kind: "default" },
      ...(drill.variants ?? []).map((variant) => ({ kind: "variant" as const, variant })),
    ]
  }, [drill])

  const rowCount = drill ? drillRows.length : tabItems.length

  useEffect(() => {
    setActive(0)
  }, [query, tab, drill])

  useEffect(() => {
    const id = drill
      ? drillRows[active]
        ? optionId(`drill-${active}`)
        : undefined
      : tabItems[active]
        ? optionId(`${tabItems[active]!.kind}-${tabItems[active]!.id}`)
        : undefined
    onActiveChange(id)
    return () => onActiveChange(undefined)
  }, [drill, drillRows, tabItems, active, onActiveChange])

  const pickRow = (index: number) => {
    if (drill) {
      const row = drillRows[index]
      if (!row) return
      if (row.kind === "back") setDrill(null)
      else if (row.kind === "default") onPick(drill)
      else onPick(drill, row.variant)
      return
    }
    const item = tabItems[index]
    if (item) onPick(item)
  }

  // Arrow keys are handled by the composer's textarea (which keeps focus) and
  // routed here through the window so the caret never moves while picking.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Capture phase + stopPropagation: React's own handlers (the textarea's
      // Enter-to-send) must never also see a key the picker just consumed.
      const consume = () => {
        e.preventDefault()
        e.stopPropagation()
      }
      if (preview) {
        // The preview owns the keyboard: Escape closes IT (the component's own
        // listener also fires — same setState, harmless), everything else is
        // swallowed so the list cannot move underneath the image.
        consume()
        if (e.key === "Escape") setPreview(null)
        return
      }
      if (e.key === "ArrowDown") {
        consume()
        setActive((i) => (rowCount === 0 ? 0 : (i + 1) % rowCount))
      } else if (e.key === "ArrowUp") {
        consume()
        setActive((i) => (rowCount === 0 ? 0 : (i - 1 + rowCount) % rowCount))
      } else if (e.key === "ArrowRight" && !drill) {
        const item = tabItems[active]
        if (item?.variants?.length) {
          consume()
          setDrill(item)
        }
      } else if (e.key === "ArrowLeft" && drill) {
        consume()
        setDrill(null)
      } else if (e.key === "Enter" && rowCount > 0) {
        consume()
        pickRow(active)
      } else if (e.key === "Escape") {
        consume()
        if (drill) setDrill(null)
        else onClose()
      }
    }
    window.addEventListener("keydown", onKey, true)
    return () => window.removeEventListener("keydown", onKey, true)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rowCount, active, drill, tabItems, preview, onClose])

  const nothingAtAll = mentions.length === 0

  return (
    <div
      role="listbox"
      aria-label={S.mention}
      id={MENTION_LIST_ID}
      className={`absolute ${insetClassName} bottom-full mb-2 bg-[var(--copilot-card)] border border-[var(--copilot-strong)] rounded-xl shadow-[0_16px_40px_rgba(0,0,0,0.45)] overflow-hidden flex flex-col z-20`}
    >
      <div className="px-3 py-2 border-b border-border flex items-center gap-2">
        <span className="font-mono text-[11.5px] text-[var(--copilot-mention)]">@{query}</span>
        <span className="ml-auto text-[10.5px] text-[var(--copilot-dim)]">{S.pickerHintInsert}</span>
        <button
          type="button"
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onExpand(tab)}
          aria-label={S.pickerExpand}
          title={S.pickerExpand}
          className="w-[22px] h-[22px] rounded-md border border-border text-[var(--copilot-muted)] hover:text-foreground flex items-center justify-center"
        >
          <Maximize2 className="w-3 h-3" strokeWidth={2.2} />
        </button>
      </div>

      {!drill && !nothingAtAll && (
        <div className="px-2 pt-1.5 flex flex-wrap gap-1" role="tablist" aria-label={S.mention}>
          {SECTION_TABS.map((section) => {
            // Files are paged, so what arrived is not what the user has. The
            // server's exact count is the honest number; without it the tab
            // read "Files 40" to someone with five hundred, which is the same
            // lie the entity lists used to tell at 100.
            const count = section === S.sectionFiles && fileTotal !== null ? fileTotal : counts.get(section) ?? 0
            const isActive = section === tab
            return (
              <button
                key={section}
                type="button"
                role="tab"
                aria-selected={isActive}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => setTab(section)}
                className={`px-2 py-[3px] rounded-lg text-[11px] whitespace-nowrap border transition-colors ${
                  isActive
                    ? "bg-[var(--copilot-surface)] border-[var(--copilot-strong)] text-foreground"
                    : "border-transparent text-[var(--copilot-muted)] hover:text-foreground"
                }`}
              >
                {section} <span className="text-[var(--copilot-dim)]">{count}</span>
              </button>
            )
          })}
        </div>
      )}

      {drill && (
        <div className="px-3 py-1.5 flex items-center gap-2 text-[12px] text-foreground">
          <ChevronLeft className="w-3 h-3 text-[var(--copilot-dim)]" strokeWidth={2.2} aria-hidden />
          <span className="font-medium truncate">{drill.name}</span>
          <span className="ml-auto text-[10.5px] text-[var(--copilot-dim)]">{S.pickerVariantsHint}</span>
        </div>
      )}

      <div
        ref={listRef}
        // Only the Files tab pages: every other kind is fully in memory, and
        // asking for "more" there would be a request for nothing.
        onScroll={
          tab === S.sectionFiles && hasMoreFiles
            ? (e) => {
                if (scrolledNearBottom(e.currentTarget)) onLoadMoreFiles?.()
              }
            : undefined
        }
        className="pt-1 pb-1.5 max-h-[280px] overflow-y-auto overflow-x-hidden"
      >
        {nothingAtAll && loading ? (
          <div className="px-3.5 py-[18px] text-center text-xs text-[var(--copilot-muted)]">{S.pickerLoading}</div>
        ) : nothingAtAll ? (
          <div className="px-3.5 py-4 text-center">
            <div className="text-xs text-foreground">{S.pickerEmptyTitle}</div>
            <div className="mt-1 text-[11.5px] text-[var(--copilot-muted)]">{S.pickerEmptyBlurb}</div>
          </div>
        ) : drill ? (
          drillRows.map((row, index) => {
            const isActive = index === active
            // `group`: hovering anywhere on the row reveals the thumb's
            // magnifier, not only the 26px circle itself.
            const base = `group flex items-center gap-2.5 w-[calc(100%-10px)] mx-[5px] px-[11px] py-[7px] rounded-lg text-left ${isActive ? "bg-[var(--copilot-surface)]" : ""}`
            if (row.kind === "back") {
              return (
                <button key="back" id={optionId(`drill-${index}`)} type="button" role="option" aria-selected={isActive} onMouseDown={(e) => e.preventDefault()} onClick={() => setDrill(null)} className={base}>
                  <ChevronLeft className="w-3.5 h-3.5 text-[var(--copilot-dim)]" strokeWidth={2.2} aria-hidden />
                  <span className="text-[12px] text-[var(--copilot-muted)]">{S.pickerBack}</span>
                </button>
              )
            }
            if (row.kind === "default") {
              return (
                <button key="default" id={optionId(`drill-${index}`)} type="button" role="option" aria-selected={isActive} onMouseDown={(e) => e.preventDefault()} onClick={() => onPick(drill)} className={base}>
                  <PreviewableThumb
                    label={drill.name}
                    round={KIND_UI[drill.kind].round}
                    highlighted={isActive}
                    onPreview={previewOf(safeThumbUrl(drill.imageUrl), drill.name, KIND_UI[drill.kind].chip, () => onPick(drill))}
                  >
                    <MentionThumb mention={drill} size={26} />
                  </PreviewableThumb>
                  <span className="text-[12.5px] text-foreground truncate flex-1 min-w-0">{S.pickerVariantDefault}</span>
                </button>
              )
            }
            const { variant } = row
            return (
              <button key={`${variant.bucket}:${variant.name}`} id={optionId(`drill-${index}`)} type="button" role="option" aria-selected={isActive} aria-label={`${variant.name} ${variant.bucketNoun}`} onMouseDown={(e) => e.preventDefault()} onClick={() => onPick(drill, variant)} className={base}>
                <PreviewableThumb
                  label={`${drill.name} — ${variant.name}`}
                  round={false}
                  highlighted={isActive}
                  onPreview={previewOf(safeThumbUrl(variant.imageUrl), `${drill.name} — ${variant.name}`, variant.bucketNoun, () => onPick(drill, variant))}
                >
                  <VariantThumb variant={variant} size={26} />
                </PreviewableThumb>
                <span className="text-[12.5px] text-foreground truncate flex-1 min-w-0">{variant.name}</span>
                <span className="ml-auto text-[10.5px] text-[var(--copilot-dim)] whitespace-nowrap capitalize">{variant.bucketNoun}</span>
              </button>
            )
          })
        ) : tabItems.length === 0 && otherTabMatches.length === 0 ? (
          <div className="px-3.5 py-[18px] text-center text-xs text-[var(--copilot-muted)]">{S.pickerNoMatch(query)}</div>
        ) : (
          <>
            {tabItems.map((item, index) => {
              const isActive = index === active
              const hasVariants = Boolean(item.variants?.length)
              return (
                <button
                  key={`${item.kind}:${item.id}`}
                  id={optionId(`${item.kind}-${item.id}`)}
                  type="button"
                  role="option"
                  aria-selected={isActive}
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => onPick(item)}
                  className={`group flex items-center gap-2.5 w-[calc(100%-10px)] mx-[5px] px-[11px] py-[7px] rounded-lg text-left ${
                    isActive ? "bg-[var(--copilot-surface)]" : ""
                  }`}
                >
                  <PreviewableThumb
                    label={item.name}
                    round={KIND_UI[item.kind].round}
                    highlighted={isActive}
                    onPreview={previewOf(safeThumbUrl(item.imageUrl), item.name, KIND_UI[item.kind].chip, () => onPick(item))}
                  >
                    <MentionThumb mention={item} size={22} />
                  </PreviewableThumb>
                  <span className="text-[12.5px] text-foreground truncate flex-1 min-w-0">{item.name}</span>
                  <span className="ml-auto text-[10.5px] text-[var(--copilot-dim)] whitespace-nowrap">{KIND_UI[item.kind].chip}</span>
                  {hasVariants && (
                    <span
                      role="button"
                      tabIndex={-1}
                      aria-label={S.pickerVariantsOf(item.name)}
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={(e) => {
                        e.stopPropagation()
                        setDrill(item)
                      }}
                      className="w-[20px] h-[20px] rounded-md border border-border text-[var(--copilot-dim)] hover:text-foreground flex items-center justify-center"
                    >
                      <ChevronRight className="w-3 h-3" strokeWidth={2.2} aria-hidden />
                    </span>
                  )}
                </button>
              )
            })}
            {otherTabMatches.length > 0 && (
              <div className="px-[11px] pt-1.5 pb-1 flex flex-wrap items-center gap-1.5 text-[10.5px] text-[var(--copilot-dim)]">
                <span>{S.pickerOtherTabs}</span>
                {otherTabMatches.map(({ tab: otherTab, count }) => (
                  <button
                    key={otherTab}
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => setTab(otherTab)}
                    className="px-1.5 py-[2px] rounded-md border border-border text-[var(--copilot-muted)] hover:text-foreground"
                  >
                    {otherTab} {count}
                  </button>
                ))}
              </div>
            )}
          </>
        )}
      </div>

      {preview && (
        <MentionPreview
          content={preview}
          onClose={() => setPreview(null)}
          onInsert={() => {
            const { insert } = preview
            setPreview(null)
            insert()
          }}
        />
      )}
    </div>
  )
}

/**
 * Wraps a thumbnail so clicking the IMAGE previews it large while the rest of
 * the row or tile still inserts. Rows without an image render the bare thumb.
 *
 * The magnifier badge is the whole point of the wrapper being visible at all:
 * "the picture is a button" is not something a person can see, and the owner
 * reported exactly that — able to enlarge only AFTER picking, because after
 * picking there is a chip they know to click. It is the same badge in the
 * inline list and in the full-size browser because both render THIS component.
 * Two copies of an affordance is how one of them ends up missing.
 *
 * TWO ways it shows, because this list has two cursors. The parent row carries
 * Tailwind's `group`, so hovering anywhere on the row reveals it — not only
 * the 22px circle. And `highlighted` forces it on the arrow-key row: focus
 * NEVER moves here (every row preventDefaults its mousedown so the composer
 * keeps it, and the list is driven by `aria-activedescendant`), so a
 * `:focus-within` rule would look right in the source and never once fire.
 */
export function PreviewableThumb({
  label,
  round,
  highlighted,
  onPreview,
  children,
}: {
  label: string
  /** Matches the thumb's own shape, so the badge cannot square off a portrait. */
  round: boolean
  /** The arrow-key cursor is on this row — show the badge without a pointer. */
  highlighted?: boolean
  /** Absent when the row has no image: it renders as a bare thumb, as before. */
  onPreview?: () => void
  children: React.ReactNode
}) {
  if (!onPreview) return <>{children}</>
  return (
    <span
      role="button"
      tabIndex={-1}
      aria-label={S.pickerPreviewOf(label)}
      title={S.pickerPreviewOf(label)}
      // Focus must stay in the composer: its blur closes the picker, so a
      // thumbnail that stole focus would close the list it sits in.
      onMouseDown={(e) => e.preventDefault()}
      onClick={(e) => {
        e.stopPropagation()
        onPreview()
      }}
      className="relative flex-none cursor-zoom-in"
    >
      {children}
      <span
        aria-hidden
        className={`pointer-events-none absolute inset-0 flex items-center justify-center bg-black/55 text-white transition-opacity group-hover:opacity-100 ${
          highlighted ? "opacity-100" : "opacity-0"
        } ${round ? "rounded-full" : "rounded-[6px]"}`}
      >
        <ZoomIn className="w-1/2 h-1/2 max-w-[18px] max-h-[18px]" strokeWidth={2.4} />
      </span>
    </span>
  )
}

/**
 * "Nearly at the bottom" — the trigger for pulling the next page of files.
 *
 * Deliberately generous: firing only at the exact bottom means a fast flick
 * lands past it with nothing loading, and the user sees an end that is not
 * the end. Exported so the inline list and the full-size browser cannot
 * drift into two different definitions of the same moment.
 */
export const NEAR_BOTTOM_PX = 120

export function scrolledNearBottom(el: HTMLElement): boolean {
  return el.scrollTop + el.clientHeight >= el.scrollHeight - NEAR_BOTTOM_PX
}

/**
 * Only http(s) reaches the browser. The CSS `url()` this once guarded is gone
 * — the thumb is an `<img>` now — and the check is worth every bit as much
 * there: without it the browser would fetch whatever string sits in the row,
 * a `data:` payload or a third-party host that then learns the user's IP and
 * referrer just because the picker opened.
 */
export function safeThumbUrl(url: string | null | undefined): string | null {
  if (typeof url !== "string" || url.length === 0) return null
  try {
    const { protocol } = new URL(url, window.location.origin)
    return protocol === "https:" || protocol === "http:" ? url : null
  } catch {
    return null
  }
}

/**
 * The frame a thumbnail lives in, and the ONE way it loads.
 *
 * This used to be a CSS `background-image` pointing at the raw asset URL, and
 * that is why the picker looked empty for a library that shows fine
 * everywhere else: every other surface in the app
 * shows an image through `CachedImage`, which asks the CDN for a small
 * transformed variant, keeps decoded images in memory across remounts, and
 * falls back to the image proxy for hosts the browser refuses to load
 * directly. A hand-rolled `url()` gets none of that — it asks for the
 * ORIGINAL, which for a character portrait is a multi-megabyte PNG, so a
 * fourteen-row list quietly started fourteen full-size downloads and painted
 * nothing for as long as they took.
 *
 * Two ways to show an image is the bug. There is one now.
 */
function ThumbFrame({
  src,
  size,
  round,
}: {
  src: string | null
  size: number
  round: boolean
}) {
  return (
    // Decorative: every row and tile already carries the name in text beside
    // it, and the preview wrapper carries its own label. An announced thumb
    // would say each name twice.
    <span
      aria-hidden
      className="flex-none overflow-hidden border border-border bg-[var(--copilot-surface)] block"
      style={{ width: size, height: size, borderRadius: round ? "50%" : "6px" }}
    >
      {src && (
        <CachedImage
          src={src}
          alt=""
          // Retina: ask for more pixels than the box, never fewer. Still two
          // orders of magnitude smaller than the original.
          thumbnail
          thumbnailWidth={Math.max(64, size * 3)}
          className="w-full h-full object-cover"
        />
      )}
    </span>
  )
}

/** Round for living things, square for things and places — the shape
 *  carries the kind at a glance. */
export function MentionThumb({ mention, size }: { mention: CopilotMention; size: number }) {
  return (
    <ThumbFrame
      src={safeThumbUrl(mention.imageUrl)}
      size={size}
      round={KIND_UI[mention.kind].round}
    />
  )
}

export function VariantThumb({ variant, size }: { variant: CopilotMentionVariant; size: number }) {
  return <ThumbFrame src={safeThumbUrl(variant.imageUrl)} size={size} round={false} />
}
