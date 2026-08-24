/**
 * `@` picker over the user’s own entities — characters, objects, animals,
 * locations.
 *
 * Only entities appear here, not media files: a mention travels to the model as
 * a NAME plus an id, which it resolves with `list_characters` / `list_objects` /
 * `list_creatures` / `list_locations`. A media file has no such tool and would
 * have to travel as a URL — which `edit_workflow` refuses to let the model
 * write into a node. Attachments need server-side id resolution before they can
 * be offered honestly.
 *
 * The list arrives as ONE array and is grouped here by kind. A prop per kind is
 * what let this surface sit at two kinds while the library had four.
 */
import { useEffect, useMemo, useRef, useState } from "react"
import { COPILOT_STRINGS as S } from "@/ee/lib/copilot/strings"
import { filterMentions } from "@/ee/lib/copilot/mentions"
import { MENTION_KINDS, type CopilotMention, type MentionKind } from "@/ee/lib/copilot/types"

/** The composer's `aria-controls` target. */
export const MENTION_LIST_ID = "copilot-mention-list"

const optionId = (mention: CopilotMention) => `copilot-mention-${mention.kind}-${mention.id}`

/** Everything that differs per kind, one row each. Round for living things. */
const KIND_UI: Record<MentionKind, { section: string; chip: string; round: boolean }> = {
  character: { section: S.sectionCharacters, chip: S.kindCharacter, round: true },
  object: { section: S.sectionObjects, chip: S.kindObject, round: false },
  creature: { section: S.sectionCreatures, chip: S.kindCreature, round: true },
  location: { section: S.sectionLocations, chip: S.kindLocation, round: false },
  image: { section: S.sectionFiles, chip: S.kindImage, round: false },
  video: { section: S.sectionFiles, chip: S.kindVideo, round: false },
  audio: { section: S.sectionFiles, chip: S.kindAudio, round: false },
}

interface CopilotMentionPickerProps {
  query: string
  /** Every mentionable entity, any kind, any order — grouped here. */
  mentions: CopilotMention[]
  onPick: (mention: CopilotMention) => void
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

export function CopilotMentionPicker({
  query,
  mentions,
  onPick,
  onActiveChange,
  onClose,
  insetClassName = "left-3.5 right-3.5",
  loading = false,
}: CopilotMentionPickerProps) {
  const sections = useMemo(() => {
    // Grouped by SECTION rather than by kind: the three file kinds share one
    // header, so a library with two images and one clip is one "Files" list
    // instead of three near-empty ones.
    const order: string[] = []
    const byLabel = new Map<string, CopilotMention[]>()
    for (const kind of MENTION_KINDS) {
      const label = KIND_UI[kind].section
      if (!byLabel.has(label)) {
        byLabel.set(label, [])
        order.push(label)
      }
      byLabel.get(label)!.push(...mentions.filter((m) => m.kind === kind))
    }
    return order.map((label) => ({ label, items: filterMentions(byLabel.get(label) ?? [], query) }))
  }, [mentions, query])

  const flat = useMemo(() => sections.flatMap((s) => s.items), [sections])
  const [active, setActive] = useState(0)
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    setActive(0)
  }, [query])

  useEffect(() => {
    const current = flat[active]
    onActiveChange(current ? optionId(current) : undefined)
    return () => onActiveChange(undefined)
  }, [flat, active, onActiveChange])

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
      if (e.key === "ArrowDown") {
        consume()
        setActive((i) => (flat.length === 0 ? 0 : (i + 1) % flat.length))
      } else if (e.key === "ArrowUp") {
        consume()
        setActive((i) => (flat.length === 0 ? 0 : (i - 1 + flat.length) % flat.length))
      } else if (e.key === "Enter" && flat.length > 0) {
        consume()
        const picked = flat[active]
        if (picked) onPick(picked)
      } else if (e.key === "Escape") {
        consume()
        onClose()
      }
    }
    window.addEventListener("keydown", onKey, true)
    return () => window.removeEventListener("keydown", onKey, true)
  }, [flat, active, onPick, onClose])

  const nothingAtAll = mentions.length === 0
  let index = -1

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
      </div>

      <div ref={listRef} className="pt-1 pb-1.5 max-h-[260px] overflow-y-auto overflow-x-hidden">
        {nothingAtAll && loading ? (
          <div className="px-3.5 py-[18px] text-center text-xs text-[var(--copilot-muted)]">{S.pickerLoading}</div>
        ) : nothingAtAll ? (
          <div className="px-3.5 py-4 text-center">
            <div className="text-xs text-foreground">{S.pickerEmptyTitle}</div>
            <div className="mt-1 text-[11.5px] text-[var(--copilot-muted)]">{S.pickerEmptyBlurb}</div>
          </div>
        ) : flat.length === 0 ? (
          <div className="px-3.5 py-[18px] text-center text-xs text-[var(--copilot-muted)]">{S.pickerNoMatch(query)}</div>
        ) : (
          sections.map((section) =>
            section.items.length === 0 ? null : (
              <div key={section.label}>
                <div className="px-[11px] pt-2.5 pb-1 text-[9.5px] tracking-[0.12em] uppercase text-[var(--copilot-dim)] font-semibold">
                  {section.label}
                </div>
                {section.items.map((item) => {
                  index += 1
                  const isActive = index === active
                  return (
                    <button
                      key={`${item.kind}:${item.id}`}
                      id={optionId(item)}
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
                      <span className="ml-auto text-[10.5px] text-[var(--copilot-dim)] whitespace-nowrap">
                        {KIND_UI[item.kind].chip}
                      </span>
                    </button>
                  )
                })}
              </div>
            ),
          )
        )}
      </div>
    </div>
  )
}

/**
 * Only http(s) reaches a `url()`. `JSON.stringify` already makes a breakout
 * impossible, but without a scheme check the browser would still fetch whatever
 * string sits in the row — a `data:` payload, or a third-party host that then
 * learns the user's IP and referrer just because the picker opened.
 */
function safeThumbUrl(url: string | null | undefined): string | null {
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
