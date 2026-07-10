"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { Film, Music } from "lucide-react"
import { sortCharacterEntriesForDisplay } from "@nodaro/shared"
import { optimizedImageUrl } from "@/lib/image"
import type { RefImageItem } from "../tag-textarea"
import { BODY_MENU_CLASS } from "./body-menu-class"
import { useBodyMenuDismiss } from "./use-body-menu-dismiss"
import { PROMPT_EDITOR_PORTAL_PROPS } from "./prompt-editor-portal"
import { RefPreviewPortal } from "./ref-preview-portal"

const MENU_W = 220
const ROW_H = 40

/** A reference is media (no still image) → show an icon instead of a thumbnail. */
function isMediaRef(item: RefImageItem): boolean {
  return item.source === "video" || item.source === "audio"
}

/** Stable-ish React key for a reference row (source + slugs + index). */
function rowKey(item: RefImageItem, i: number): string {
  return `${item.source}:${item.index}:${item.characterSlug ?? ""}:${item.locationSlug ?? ""}:${item.variantSlug ?? item.locationVariantSlug ?? ""}:${i}`
}

/**
 * The thumbnail SWAP picker: a body-portaled list of every attached reference
 * (images + character/location/object/animal assets), opened by clicking a
 * chip's thumbnail. Clicking a row fires `onSelect` so the chip can replace
 * itself in place (cross-type). Mirrors the chip role-menu's body-portal +
 * dismiss plumbing.
 *
 * The menu OWNS its keyboard (it auto-focuses on open): Escape closes, ↑/↓
 * move the active row (so ProseMirror never swallows the keys), Enter selects.
 * A large side-preview follows the active row — driven by `selectedIndex` so
 * the FIRST row's image shows immediately on open (not only after hovering).
 * The height is capped to the available viewport space so a long list scrolls
 * inside the menu instead of running off-screen.
 */
export function ReferencePickerMenu({
  items,
  anchor,
  onSelect,
  onClose,
}: {
  items: readonly RefImageItem[]
  anchor: DOMRect
  onSelect: (item: RefImageItem) => void
  onClose: () => void
}) {
  const menuRef = useRef<HTMLDivElement | null>(null)
  const activeRowRef = useRef<HTMLButtonElement | null>(null)
  const [selectedIndex, setSelectedIndex] = useState(0)

  // Boards-first display order within each character's run — DISPLAY ONLY
  // (item objects, and thus their payload indices, are untouched).
  const displayItems = useMemo(() => sortCharacterEntriesForDisplay(items), [items])

  useBodyMenuDismiss(menuRef, anchor, onClose)

  // Own the keyboard via a CAPTURE-phase document listener rather than the
  // menu's own focus. The menu is body-portaled: inside a Radix dialog the
  // focus-scope steals focus back, so a focused-menu `onKeyDown` never fires,
  // and ProseMirror/Radix swallow Escape on the way UP before a bubble-phase
  // document listener sees it. Capture on `document` fires FIRST, regardless of
  // where focus is, and `stopPropagation` keeps Escape/arrows from also
  // reaching the editor or closing the dialog. Latest state via refs so the
  // listener registers once.
  const stateRef = useRef({ items: displayItems, onClose, onSelect, selectedIndex })
  stateRef.current = { items: displayItems, onClose, onSelect, selectedIndex }
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const s = stateRef.current
      if (e.key === "Escape") {
        e.preventDefault(); e.stopPropagation(); s.onClose()
      } else if (e.key === "ArrowDown") {
        e.preventDefault(); e.stopPropagation()
        setSelectedIndex((i) => Math.min(i + 1, s.items.length - 1))
      } else if (e.key === "ArrowUp") {
        e.preventDefault(); e.stopPropagation()
        setSelectedIndex((i) => Math.max(i - 1, 0))
      } else if (e.key === "Enter") {
        e.preventDefault(); e.stopPropagation()
        const it = s.items[s.selectedIndex]
        if (it) s.onSelect(it)
      }
    }
    document.addEventListener("keydown", onKey, { capture: true })
    return () => document.removeEventListener("keydown", onKey, { capture: true })
  }, [])

  // Keep the active row scrolled into view as the selection moves.
  useEffect(() => {
    activeRowRef.current?.scrollIntoView({ block: "nearest" })
  }, [selectedIndex])

  const { top, left, maxHeight } = useMemo(() => {
    const MARGIN = 8
    const vh = window.innerHeight
    const vw = window.innerWidth
    const contentH = displayItems.length * ROW_H + 8
    const spaceBelow = vh - anchor.bottom - MARGIN
    const spaceAbove = anchor.top - MARGIN
    // Open toward the side with more room; the height is the content height
    // capped to that side's space so a long list scrolls INSIDE the menu.
    const placeBelow = spaceBelow >= spaceAbove
    const avail = Math.max(spaceBelow, spaceAbove)
    const mh = Math.max(96, Math.min(contentH, avail))
    const rawTop = placeBelow ? anchor.bottom + MARGIN : anchor.top - mh - MARGIN
    // Hard clamp: the whole box [top, top+mh] must stay within the viewport, no
    // matter where the anchor is (near an edge, scrolled, tiny viewport). This
    // is what guarantees a long menu never runs off-screen.
    const top = Math.max(MARGIN, Math.min(rawTop, vh - mh - MARGIN))
    const left = Math.min(Math.max(MARGIN, anchor.left), vw - MENU_W - MARGIN)
    return { top, left, maxHeight: mh }
  }, [anchor, displayItems.length])

  // Preview anchored to the MENU (not a row), so it shows the selected item's
  // image from the moment the menu opens. Media rows have no still → no preview.
  const menuRect = { top, left, right: left + MENU_W, bottom: top + maxHeight, width: MENU_W, height: maxHeight, x: left, y: top } as DOMRect
  const active = displayItems[selectedIndex]
  const previewUrl = active && !isMediaRef(active) ? active.url : undefined

  return createPortal(
    <>
      <div
        {...PROMPT_EDITOR_PORTAL_PROPS}
        ref={menuRef}
        style={{ position: "fixed", top, left, width: MENU_W, maxHeight, overflowY: "auto" }}
        className={BODY_MENU_CLASS}
        role="menu"
        aria-activedescendant={displayItems.length ? `ref-pick-${selectedIndex}` : undefined}
        data-testid="reference-picker-menu"
        onMouseDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        {items.length === 0 ? (
          <div className="px-2.5 py-2 text-[11px] text-muted-foreground italic">No references wired</div>
        ) : (
          displayItems.map((item, i) => (
            <button
              key={rowKey(item, i)}
              id={`ref-pick-${i}`}
              ref={i === selectedIndex ? activeRowRef : undefined}
              type="button"
              role="menuitem"
              className={`w-full text-left px-2 py-1.5 text-[11px] flex items-center gap-2 transition-colors ${
                i === selectedIndex ? "bg-muted text-foreground" : "hover:bg-muted text-foreground"
              }`}
              onMouseEnter={() => setSelectedIndex(i)}
              onClick={(e) => {
                e.stopPropagation()
                onSelect(item)
              }}
            >
              {isMediaRef(item) ? (
                item.source === "audio"
                  ? <Music className="w-6 h-6 shrink-0 opacity-70" aria-hidden />
                  : <Film className="w-6 h-6 shrink-0 opacity-70" aria-hidden />
              ) : (
                <img
                  src={optimizedImageUrl(item.url, { width: 48, quality: 80 })}
                  alt=""
                  className="w-6 h-6 rounded object-cover shrink-0"
                  draggable={false}
                />
              )}
              <span className="truncate">{item.label}</span>
              {item.bucket === "boards" && (
                <span className="ml-1 rounded bg-primary/15 px-1 py-px text-[9px] font-semibold uppercase tracking-wide text-primary">
                  board
                </span>
              )}
            </button>
          ))
        )}
      </div>
      <RefPreviewPortal url={previewUrl} anchor={previewUrl ? menuRect : null} placement="side" />
    </>,
    document.body,
  )
}
