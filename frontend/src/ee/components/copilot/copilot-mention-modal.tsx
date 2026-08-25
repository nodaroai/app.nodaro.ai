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
import { ChevronLeft, ChevronRight, Search, X } from "lucide-react"
import { COPILOT_STRINGS as S } from "@/ee/lib/copilot/strings"
import { filterMentions } from "@/ee/lib/copilot/mentions"
import type { CopilotMention, CopilotMentionVariant } from "@/ee/lib/copilot/types"
import { KIND_UI, MentionThumb, SECTION_TABS, VariantThumb, sectionOf } from "./copilot-mention-picker"

interface CopilotMentionModalProps {
  mentions: CopilotMention[]
  initialTab: string
  onPick: (mention: CopilotMention, variant?: CopilotMentionVariant) => void
  onClose: () => void
}

export function CopilotMentionModal({ mentions, initialTab, onPick, onClose }: CopilotMentionModalProps) {
  const [search, setSearch] = useState("")
  const [tab, setTab] = useState(initialTab)
  const [drill, setDrill] = useState<CopilotMention | null>(null)
  const inputRef = useRef<HTMLInputElement>(null)

  useEffect(() => {
    inputRef.current?.focus()
  }, [])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== "Escape") return
      e.preventDefault()
      e.stopPropagation()
      if (drill) setDrill(null)
      else onClose()
    }
    window.addEventListener("keydown", onKey, true)
    return () => window.removeEventListener("keydown", onKey, true)
  }, [drill, onClose])

  const counts = useMemo(() => {
    const map = new Map<string, number>(SECTION_TABS.map((t) => [t, 0]))
    for (const mention of mentions) map.set(sectionOf(mention), (map.get(sectionOf(mention)) ?? 0) + 1)
    return map
  }, [mentions])

  const items = useMemo(
    () => filterMentions(mentions.filter((m) => sectionOf(m) === tab), search),
    [mentions, tab, search],
  )

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center" role="dialog" aria-modal aria-label={S.pickerModalTitle}>
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
              onChange={(e) => setSearch(e.target.value)}
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
                    {section} <span className="text-[var(--copilot-dim)]">{counts.get(section) ?? 0}</span>
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

        <div className="flex-1 min-h-0 overflow-y-auto p-3">
          {drill ? (
            <div className="grid grid-cols-3 gap-2">
              <ModalTile onClick={() => onPick(drill)} label={S.pickerVariantDefault} sub={KIND_UI[drill.kind].chip}>
                <MentionThumb mention={drill} size={64} />
              </ModalTile>
              {(drill.variants ?? []).map((variant) => (
                <ModalTile
                  key={`${variant.bucket}:${variant.name}`}
                  onClick={() => onPick(drill, variant)}
                  label={variant.name}
                  sub={variant.bucketNoun}
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
                >
                  <MentionThumb mention={item} size={64} />
                </ModalTile>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

function ModalTile({
  children,
  label,
  sub,
  onClick,
  cornerAction,
}: {
  children: React.ReactNode
  label: string
  sub: string
  onClick: () => void
  cornerAction?: { label: string; onClick: () => void }
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={`${label} · ${sub}`}
      className="relative flex items-center gap-2.5 px-2.5 py-2.5 rounded-[10px] border border-border bg-[var(--copilot-surface)]/40 hover:bg-[var(--copilot-surface)] text-left transition-colors"
    >
      {children}
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
