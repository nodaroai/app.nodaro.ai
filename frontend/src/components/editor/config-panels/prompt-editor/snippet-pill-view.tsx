"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react"
import { Scissors, ChevronLeft, ChevronRight } from "lucide-react"
import { computeFlipPosition } from "./flip-position"
import type { SnippetPillAttrs } from "./snippet-pill-extension"

interface PoolEntry {
  id: string
  name: string
  text: string
  category: string
  source: "factory" | "user"
}

/**
 * Amber snippet pill. Hover = full text tooltip. Click = popover with:
 *   ◀ ▶  quick-cycle through same-category siblings (the compare loop),
 *   a sibling list (swap), "Edit as text" (unwrap to plain text), Remove.
 * Swap/cycle just rewrite the node's attrs — renderText() then serializes
 * the new fragment, so the stored prompt string updates atomically.
 */
export function SnippetPillView(props: NodeViewProps) {
  const attrs = props.node.attrs as SnippetPillAttrs
  const storage = props.editor.storage as unknown as Record<string, { snippets?: readonly PoolEntry[] }>
  const pool = storage.snippetPill?.snippets ?? []

  const current = useMemo(() => pool.find((s) => s.id === attrs.snippetId), [pool, attrs.snippetId])
  const siblings = useMemo(
    () => (current ? pool.filter((s) => s.category === current.category) : []),
    [pool, current],
  )

  const [menuAnchor, setMenuAnchor] = useState<DOMRect | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => () => setMenuAnchor(null), [])

  useEffect(() => {
    if (!menuAnchor) return
    function onDown(e: PointerEvent) {
      if (menuRef.current?.contains(e.target as Node)) return
      setMenuAnchor(null)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setMenuAnchor(null)
    }
    window.addEventListener("pointerdown", onDown, { capture: true })
    document.addEventListener("keydown", onKey)
    return () => {
      window.removeEventListener("pointerdown", onDown, { capture: true })
      document.removeEventListener("keydown", onKey)
    }
  }, [menuAnchor])

  const swapTo = useCallback((s: PoolEntry) => {
    props.updateAttributes({ snippetId: s.id, name: s.name, text: s.text })
  }, [props])

  const cycle = useCallback((dir: 1 | -1) => {
    if (siblings.length < 2) return
    const idx = siblings.findIndex((s) => s.id === attrs.snippetId)
    const next = siblings[(idx + dir + siblings.length) % siblings.length]
    if (next) swapTo(next)
  }, [siblings, attrs.snippetId, swapTo])

  const handleRemove = useCallback(() => {
    if (typeof props.getPos !== "function") return
    const pos = props.getPos()
    if (pos == null) return
    // Also consume a dangling leading separator (", " or " ") that snippet
    // insertion added, so Remove doesn't strand a comma (spec: "deletes the
    // fragment and a dangling leading separator").
    const before = props.editor.state.doc.textBetween(Math.max(0, pos - 2), pos, "\n", "\n")
    const sepLen = before.endsWith(", ") ? 2 : before.endsWith(" ") || before.endsWith(",") ? 1 : 0
    props.editor.chain().focus().deleteRange({ from: pos - sepLen, to: pos + props.node.nodeSize }).run()
  }, [props])

  const handleUnwrap = useCallback(() => {
    if (typeof props.getPos !== "function") return
    const pos = props.getPos()
    if (pos == null) return
    setMenuAnchor(null)
    props.editor
      .chain()
      .focus()
      .deleteRange({ from: pos, to: pos + props.node.nodeSize })
      .insertContentAt(pos, [{ type: "text", text: attrs.text }])
      .run()
  }, [props, attrs.text])

  return (
    <NodeViewWrapper
      as="span"
      data-snippet-pill=""
      title={attrs.text}
      className={
        "inline-flex items-center gap-1 align-baseline rounded-md border px-1.5 py-0 mx-0.5 text-[0.85em] leading-snug cursor-pointer select-none "
        + "border-amber-400/50 bg-amber-500/10 text-amber-800 dark:text-amber-200 "
        + (props.selected ? "ring-2 ring-amber-400/60 " : "")
      }
    >
      <Scissors className="w-3 h-3 shrink-0 opacity-70" aria-hidden />
      <button
        type="button"
        contentEditable={false}
        className="font-medium whitespace-nowrap"
        onMouseDown={(e) => {
          e.preventDefault()
          e.stopPropagation()
          setMenuAnchor(e.currentTarget.getBoundingClientRect())
        }}
        title="Click to swap, edit as text, or remove"
      >
        {attrs.name || "snippet"}
      </button>
      <button
        type="button"
        aria-label="Remove snippet"
        className="opacity-60 hover:opacity-100"
        onMouseDown={(e) => {
          e.preventDefault()
          handleRemove()
        }}
      >
        ×
      </button>
      {menuAnchor && createPortal(
        (() => {
          const MENU_W = 280
          const estH = Math.min(320, (Math.min(siblings.length, 7) + 3) * 34 + 16)
          // Shares the editor's flip-above-when-cramped math (left clamp + top).
          // The pill's `placeBelow` keys off its dynamic `estH` and keeps the
          // original `- MARGIN` on the secondary clause; maxHeight stays local.
          const { top, left } = computeFlipPosition(menuAnchor, {
            width: MENU_W,
            estHeight: estH,
            placeBelowThreshold: estH,
            secondaryClauseMargin: 4,
          })
          return (
            <div
              ref={menuRef}
              style={{ position: "fixed", top, left, width: MENU_W, maxHeight: 320, overflowY: "auto" }}
              className="z-[10000] rounded-lg border border-border bg-popover shadow-lg py-1"
              role="menu"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
            >
              {siblings.length > 1 && (
                <div className="flex items-center justify-between px-2 pb-1 border-b border-border/60">
                  <button type="button" aria-label="Previous variation" className="p-1 rounded hover:bg-muted" onClick={() => cycle(-1)}>
                    <ChevronLeft className="w-3.5 h-3.5" />
                  </button>
                  <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
                    {current?.category ?? "Variations"}
                  </span>
                  <button type="button" aria-label="Next variation" className="p-1 rounded hover:bg-muted" onClick={() => cycle(1)}>
                    <ChevronRight className="w-3.5 h-3.5" />
                  </button>
                </div>
              )}
              {siblings.map((s) => (
                <button
                  key={s.source + s.id}
                  type="button"
                  role="menuitem"
                  className={`w-full text-left px-2.5 py-1.5 transition-colors ${
                    s.id === attrs.snippetId
                      ? "bg-amber-500/15 text-amber-800 dark:text-amber-200"
                      : "hover:bg-muted text-foreground"
                  }`}
                  onClick={() => swapTo(s)}
                >
                  <span className="block text-[11px] font-medium truncate">{s.name}{s.id === attrs.snippetId ? " ✓" : ""}</span>
                  <span className="block text-[10px] text-muted-foreground truncate">{s.text}</span>
                </button>
              ))}
              <div className="my-1 border-t border-border/60" />
              <button type="button" role="menuitem" className="w-full text-left px-2.5 py-1.5 text-[11px] hover:bg-muted" onClick={handleUnwrap}>
                Edit as text
              </button>
              <button type="button" role="menuitem" className="w-full text-left px-2.5 py-1.5 text-[11px] text-destructive hover:bg-muted" onClick={() => { setMenuAnchor(null); handleRemove() }}>
                Remove
              </button>
            </div>
          )
        })(),
        document.body,
      )}
    </NodeViewWrapper>
  )
}
