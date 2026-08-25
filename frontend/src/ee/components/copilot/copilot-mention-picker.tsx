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
import { ChevronLeft, ChevronRight, Maximize2 } from "lucide-react"
import { COPILOT_STRINGS as S } from "@/ee/lib/copilot/strings"
import { filterMentions } from "@/ee/lib/copilot/mentions"
import {
  MENTION_KINDS,
  type CopilotMention,
  type CopilotMentionVariant,
  type MentionKind,
} from "@/ee/lib/copilot/types"
import { CopilotMentionModal } from "./copilot-mention-modal"

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
  query: string
  /** Every mentionable entity, any kind, any order — grouped here. */
  mentions: CopilotMention[]
  onPick: (mention: CopilotMention, variant?: CopilotMentionVariant) => void
  /** Reported up so the textarea's `aria-activedescendant` can follow the arrow keys. */
  onActiveChange: (optionId: string | undefined) => void
  onClose: () => void
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
  insetClassName = "left-3.5 right-3.5",
  loading = false,
}: CopilotMentionPickerProps) {
  const counts = useMemo(() => {
    const map = new Map<string, number>(SECTION_TABS.map((tab) => [tab, 0]))
    for (const mention of mentions) map.set(sectionOf(mention), (map.get(sectionOf(mention)) ?? 0) + 1)
    return map
  }, [mentions])

  const firstNonEmptyTab = SECTION_TABS.find((tab) => (counts.get(tab) ?? 0) > 0) ?? SECTION_TABS[0]!
  const [tab, setTab] = useState(firstNonEmptyTab)
  const [drill, setDrill] = useState<CopilotMention | null>(null)
  const [modalOpen, setModalOpen] = useState(false)
  const [active, setActive] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

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
      if (modalOpen) return // the full-size browser owns the keyboard while open
      // Capture phase + stopPropagation: React's own handlers (the textarea's
      // Enter-to-send) must never also see a key the picker just consumed.
      const consume = () => {
        e.preventDefault()
        e.stopPropagation()
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
  }, [rowCount, active, drill, tabItems, modalOpen, onClose])

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
          onClick={() => setModalOpen(true)}
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
            const count = counts.get(section) ?? 0
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

      <div ref={listRef} className="pt-1 pb-1.5 max-h-[280px] overflow-y-auto overflow-x-hidden">
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
            const base = `flex items-center gap-2.5 w-[calc(100%-10px)] mx-[5px] px-[11px] py-[7px] rounded-lg text-left ${isActive ? "bg-[var(--copilot-surface)]" : ""}`
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
                  <MentionThumb mention={drill} size={26} />
                  <span className="text-[12.5px] text-foreground truncate flex-1 min-w-0">{S.pickerVariantDefault}</span>
                </button>
              )
            }
            const { variant } = row
            return (
              <button key={`${variant.bucket}:${variant.name}`} id={optionId(`drill-${index}`)} type="button" role="option" aria-selected={isActive} aria-label={`${variant.name} ${variant.bucketNoun}`} onMouseDown={(e) => e.preventDefault()} onClick={() => onPick(drill, variant)} className={base}>
                <VariantThumb variant={variant} size={26} />
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
                  className={`flex items-center gap-2.5 w-[calc(100%-10px)] mx-[5px] px-[11px] py-[7px] rounded-lg text-left ${
                    isActive ? "bg-[var(--copilot-surface)]" : ""
                  }`}
                >
                  <MentionThumb mention={item} size={22} />
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

      {modalOpen && (
        <CopilotMentionModal
          mentions={mentions}
          initialTab={tab}
          onPick={(mention, variant) => {
            setModalOpen(false)
            if (variant) onPick(mention, variant)
            else onPick(mention)
          }}
          onClose={() => setModalOpen(false)}
        />
      )}
    </div>
  )
}

/**
 * Only http(s) reaches a `url()`. `JSON.stringify` already makes a breakout
 * impossible, but without a scheme check the browser would still fetch whatever
 * string sits in the row — a `data:` payload, or a third-party host that then
 * learns the user's IP and referrer just because the picker opened.
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

/** Round for living things, square for things and places — the shape
 *  carries the kind at a glance. */
export function MentionThumb({ mention, size }: { mention: CopilotMention; size: number }) {
  const radius = KIND_UI[mention.kind].round ? "50%" : "6px"
  const src = safeThumbUrl(mention.imageUrl)
  return (
    <span
      className="flex-none border border-border bg-[var(--copilot-surface)] bg-cover bg-center"
      style={{
        width: size,
        height: size,
        borderRadius: radius,
        ...(src ? { backgroundImage: `url(${JSON.stringify(src)})` } : {}),
      }}
      aria-hidden
    />
  )
}

export function VariantThumb({ variant, size }: { variant: CopilotMentionVariant; size: number }) {
  const src = safeThumbUrl(variant.imageUrl)
  return (
    <span
      className="flex-none border border-border bg-[var(--copilot-surface)] bg-cover bg-center rounded-[6px]"
      style={{ width: size, height: size, ...(src ? { backgroundImage: `url(${JSON.stringify(src)})` } : {}) }}
      aria-hidden
    />
  )
}
