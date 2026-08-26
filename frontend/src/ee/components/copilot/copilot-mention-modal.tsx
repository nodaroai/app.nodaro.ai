/**
 * The full-size reference browser behind the picker's expand button — the
 * Studio pattern, ported: search across everything, kind tabs with counts,
 * large tiles you can actually judge, and a variant pane inside a character.
 *
 * Picking here feeds the SAME onPick as the inline list; the modal closes and
 * the composer inserts. No fetches of its own — it renders the mentions the
 * picker already holds (variants included, from the characters list payload).
 */
import { useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { ChevronLeft, ChevronRight, Search, X } from "lucide-react"
import { COPILOT_STRINGS as S } from "@/ee/lib/copilot/strings"
import { filterMentions } from "@/ee/lib/copilot/mentions"
import type { CopilotMention, CopilotMentionVariant } from "@/ee/lib/copilot/types"
import { KIND_UI, MentionThumb, PreviewableThumb, SECTION_TABS, VariantThumb, safeThumbUrl, scrolledNearBottom, sectionOf } from "./copilot-mention-picker"
import { MentionPreview, type MentionPreviewContent } from "./copilot-mention-preview"

interface CopilotMentionModalProps {
  /** The server-side total for FILES — what arrived is not what the user has. */
  fileTotal?: number | null
  /** More file pages exist on the server. */
  hasMoreFiles?: boolean
  /** Pull the next page. Called when the list is scrolled near its end. */
  onLoadMoreFiles?: () => void
  mentions: CopilotMention[]
  initialTab: string
  /**
   * Lifted to the composer, not held here: for FILES this string is a server
   * query, and the composer is what owns the fetch. Kept local, this box
   * would filter whatever 40 rows happened to be in memory and answer "no
   * match" about files the user owns.
   */
  search: string
  onSearchChange: (value: string) => void
  onPick: (mention: CopilotMention, variant?: CopilotMentionVariant) => void
  onClose: () => void
}

export function CopilotMentionModal({ mentions, initialTab, search, onSearchChange, fileTotal = null, hasMoreFiles = false, onLoadMoreFiles, onPick, onClose }: CopilotMentionModalProps) {
  const [tab, setTab] = useState(initialTab)
  const [drill, setDrill] = useState<CopilotMention | null>(null)
  const [preview, setPreview] = useState<(MentionPreviewContent & { insert: () => void }) | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return
      e.preventDefault()
      e.stopPropagation()
      if (preview) setPreview(null)
      else if (drill) setDrill(null)
      else onClose()
    }
    window.addEventListener("keydown", onKey, true)
    return () => window.removeEventListener("keydown", onKey, true)
  }, [preview, drill, onClose])

  /** The preview opener for one tile, or undefined when it has no image. */
  const previewOf = (
    src: string | null,
    label: string,
    sub: string,
    insert: () => void,
  ): (() => void) | undefined => (src ? () => setPreview({ src, label, sub, insert }) : undefined)

  const counts = useMemo(() => {
    const map = new Map<string, number>(SECTION_TABS.map((t) => [t, 0]))
    for (const mention of mentions) map.set(sectionOf(mention), (map.get(sectionOf(mention)) ?? 0) + 1)
    return map
  }, [mentions])

  const items = useMemo(
    () => filterMentions(mentions.filter((m) => sectionOf(m) === tab), search),
    [mentions, tab, search],
  )

  // PORTALED: both composers sit inside containing blocks for fixed
  // positioning (the home dock's backdrop-filter glass, the picker card's
  // overflow-hidden), which trapped and clipped this overlay when it rendered
  // in place — the "expand does nothing" bug. document.body has neither.
  return createPortal(
    <div className="fixed inset-0 z-[80] flex items-center justify-center" role="dialog" aria-modal aria-label={S.pickerModalTitle}>
      <div className="absolute inset-0 bg-black/55" onClick={onClose} aria-hidden />
      <div className="relative w-[680px] max-w-[94vw] max-h-[78vh] flex flex-col bg-[var(--copilot-card)] border border-[var(--copilot-strong)] rounded-xl shadow-[0_16px_40px_rgba(0,0,0,0.5)]">
        <div className="px-4 pt-3.5 pb-3 border-b border-border flex flex-col gap-2.5">
          <div className="flex items-center gap-2">
            <span className="text-[13.5px] font-semibold text-foreground">{S.pickerModalTitle}</span>
            <button
              type="button"
              onClick={onClose}
              aria-label={S.close}
              className="ml-auto w-[26px] h-[26px] rounded-[7px] border border-border text-[var(--copilot-muted)] hover:text-foreground flex items-center justify-center"
            >
              <X className="w-3 h-3" strokeWidth={2.2} />
            </button>
          </div>
          <div className="text-[11.5px] text-[var(--copilot-muted)]">{S.pickerModalBlurb}</div>
          <div className="flex items-center gap-2 px-2.5 py-2 bg-[var(--copilot-surface)] border border-border rounded-lg focus-within:border-[var(--copilot-strong)]">
            <Search className="w-3.5 h-3.5 text-[var(--copilot-dim)]" strokeWidth={2.2} aria-hidden />
            <input
              ref={inputRef}
              value={search}
              onChange={(e) => onSearchChange(e.target.value)}
              placeholder={S.pickerModalSearch}
              aria-label={S.pickerModalSearch}
              className="flex-1 bg-transparent border-none outline-none text-[12.5px] text-foreground placeholder:text-[var(--copilot-dim)]"
            />
          </div>
          {!drill && (
            <div className="flex flex-wrap gap-1" role="tablist" aria-label={S.pickerModalTitle}>
              {SECTION_TABS.map((section) => {
                const isActive = section === tab
                return (
                  <button
                    key={section}
                    type="button"
                    role="tab"
                    aria-selected={isActive}
                    onClick={() => setTab(section)}
                    className={`px-2.5 py-1 rounded-lg text-[11.5px] whitespace-nowrap border transition-colors ${
                      isActive
                        ? "bg-[var(--copilot-surface)] border-[var(--copilot-strong)] text-foreground"
                        : "border-transparent text-[var(--copilot-muted)] hover:text-foreground"
                    }`}
                  >
                    {section}{" "}
                    <span className="text-[var(--copilot-dim)]">
                      {section === S.sectionFiles && fileTotal !== null ? fileTotal : counts.get(section) ?? 0}
                    </span>
                  </button>
                )
              })}
            </div>
          )}
          {drill && (
            <button
              type="button"
              onClick={() => setDrill(null)}
              className="self-start flex items-center gap-1.5 text-[12px] text-[var(--copilot-muted)] hover:text-foreground"
            >
              <ChevronLeft className="w-3.5 h-3.5" strokeWidth={2.2} aria-hidden />
              <span className="font-medium text-foreground">{drill.name}</span>
              <span className="text-[var(--copilot-dim)]">· {S.pickerBack}</span>
            </button>
          )}
        </div>

        <div
          // Same trigger as the inline list, from the same helper — two
          // definitions of "near the bottom" is how one surface silently
          // stops loading.
          onScroll={
            tab === S.sectionFiles && hasMoreFiles && !drill
              ? (e) => {
                  if (scrolledNearBottom(e.currentTarget)) onLoadMoreFiles?.()
                }
              : undefined
          }
          className="flex-1 min-h-0 overflow-y-auto p-3"
        >
          {drill ? (
            <div className="grid grid-cols-3 gap-2">
              <ModalTile
                onClick={() => onPick(drill)}
                label={S.pickerVariantDefault}
                sub={KIND_UI[drill.kind].chip}
                onPreview={previewOf(safeThumbUrl(drill.imageUrl), drill.name, KIND_UI[drill.kind].chip, () => onPick(drill))}
                round={KIND_UI[drill.kind].round}
              >
                <MentionThumb mention={drill} size={64} />
              </ModalTile>
              {(drill.variants ?? []).map((variant) => (
                <ModalTile
                  key={`${variant.bucket}:${variant.name}`}
                  onClick={() => onPick(drill, variant)}
                  label={variant.name}
                  sub={variant.bucketNoun}
                  onPreview={previewOf(safeThumbUrl(variant.imageUrl), `${drill.name} — ${variant.name}`, variant.bucketNoun, () => onPick(drill, variant))}
                  round={false}
                >
                  <VariantThumb variant={variant} size={64} />
                </ModalTile>
              ))}
            </div>
          ) : items.length === 0 ? (
            <div className="px-2 py-6 text-center text-[12px] text-[var(--copilot-muted)]">{S.pickerNoMatch(search)}</div>
          ) : (
            <div className="grid grid-cols-3 gap-2">
              {items.map((item) => (
                <ModalTile
                  key={`${item.kind}:${item.id}`}
                  onClick={() => onPick(item)}
                  label={item.name}
                  sub={KIND_UI[item.kind].chip}
                  cornerAction={
                    item.variants?.length
                      ? { label: S.pickerVariantsOf(item.name), onClick: () => setDrill(item) }
                      : undefined
                  }
                  onPreview={previewOf(safeThumbUrl(item.imageUrl), item.name, KIND_UI[item.kind].chip, () => onPick(item))}
                  round={KIND_UI[item.kind].round}
                >
                  <MentionThumb mention={item} size={64} />
                </ModalTile>
              ))}
            </div>
          )}
        </div>
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
    </div>,
    document.body,
  )
}

function ModalTile({
  children,
  label,
  sub,
  onClick,
  cornerAction,
  onPreview,
  round,
}: {
  children: React.ReactNode
  label: string
  sub: string
  onClick: () => void
  cornerAction?: { label: string; onClick: () => void }
  /** Clicking the IMAGE previews it large; the rest of the tile still inserts. */
  onPreview?: () => void
  /** The thumb's shape, so the magnifier badge matches it. */
  round: boolean
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`${label} · ${sub}`}
      // `group`: hovering the tile reveals the thumb's magnifier.
      className="group relative flex items-center gap-2.5 px-2.5 py-2.5 rounded-[10px] border border-border bg-[var(--copilot-surface)]/40 hover:bg-[var(--copilot-surface)] text-left transition-colors"
    >
      {/* The SAME wrapper the inline list uses, so the magnifier badge, the
          focus-preserving mousedown and the zoom cursor are one implementation.
          A tile that grew its own copy is how one surface ends up with an
          affordance the other quietly lost. */}
      <PreviewableThumb label={label} round={round} onPreview={onPreview}>
        {children}
      </PreviewableThumb>
      <span className="min-w-0 flex-1">
        <span className="block text-[12.5px] text-foreground truncate">{label}</span>
        <span className="block text-[10.5px] text-[var(--copilot-dim)] capitalize">{sub}</span>
      </span>
      {cornerAction && (
        <span
          role="button"
          tabIndex={-1}
          aria-label={cornerAction.label}
          onClick={(e) => {
            e.stopPropagation()
            cornerAction.onClick()
          }}
          className="absolute top-1.5 right-1.5 w-[20px] h-[20px] rounded-md border border-border bg-[var(--copilot-card)] text-[var(--copilot-dim)] hover:text-foreground flex items-center justify-center"
        >
          <ChevronRight className="w-3 h-3" strokeWidth={2.2} aria-hidden />
        </span>
      )}
    </button>
  )
}
