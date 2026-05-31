"use client"

import { useState, useCallback, useEffect, useRef } from "react"
import { createPortal } from "react-dom"
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react"
import { optimizedImageUrl } from "@/lib/image"

interface ImageRefAttrs {
  imageIndex: number
  label: string
}

interface RefLookup {
  url?: string
  defaultName?: string
}

const LABEL_PRESETS = ["object", "person", "background", "settings", "face", "texture", "style", "pose"] as const

/**
 * Keep custom labels safe for the {image:N:label} token format. Preserves
 * case so users can write proper nouns (e.g. "Danny", "Sarah") which the
 * prompt builder uses to drop the "the" article.
 */
function sanitizeLabel(raw: string): string {
  return raw
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9_-]/g, "")
    .slice(0, 32)
}

/**
 * Reads `referenceImages` from editor storage. The PromptEditor stores the
 * latest list there on every render so node views can resolve `imageIndex`
 * to the actual image data without prop drilling through Tiptap.
 */
function useRefLookup(props: NodeViewProps): RefLookup {
  const attrs = props.node.attrs as ImageRefAttrs
  const storage = props.editor.storage as unknown as Record<string, { referenceImages?: Array<{ url: string; defaultName?: string }> }>
  const list = storage.imageRef?.referenceImages ?? []
  const ref = list[attrs.imageIndex - 1]
  return { url: ref?.url, defaultName: ref?.defaultName }
}

export function ImageRefView(props: NodeViewProps) {
  const attrs = props.node.attrs as ImageRefAttrs
  const { url, defaultName } = useRefLookup(props)
  const [hoverAnchor, setHoverAnchor] = useState<DOMRect | null>(null)
  const [menuAnchor, setMenuAnchor] = useState<DOMRect | null>(null)
  const [customMode, setCustomMode] = useState(false)
  const [customText, setCustomText] = useState("")
  const customInputRef = useRef<HTMLInputElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)

  // Clean up any stuck preview/menu when the node unmounts (deletion, etc.).
  useEffect(() => () => {
    setHoverAnchor(null)
    setMenuAnchor(null)
  }, [])

  // Auto-focus the custom-label input when entering custom mode.
  useEffect(() => {
    if (customMode) customInputRef.current?.focus()
  }, [customMode])

  // Close the menu on outside click or Escape.
  useEffect(() => {
    if (!menuAnchor) return
    function onDown(e: PointerEvent) {
      if (menuRef.current?.contains(e.target as Node)) return
      setMenuAnchor(null)
      setCustomMode(false)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        setMenuAnchor(null)
        setCustomMode(false)
      }
    }
    // Capture phase + pointerdown: fires before any inner handler can call
    // stopPropagation (e.g. ProseMirror's mousedown handlers), and pointer
    // events cover both mouse and touch paths uniformly.
    window.addEventListener("pointerdown", onDown, { capture: true })
    document.addEventListener("keydown", onKey)
    return () => {
      window.removeEventListener("pointerdown", onDown, { capture: true })
      document.removeEventListener("keydown", onKey)
    }
  }, [menuAnchor])

  const handleRemove = useCallback(() => {
    if (typeof props.getPos !== "function") return
    const pos = props.getPos()
    if (pos == null) return
    props.editor
      .chain()
      .focus()
      .deleteRange({ from: pos, to: pos + props.node.nodeSize })
      .run()
  }, [props])

  const updateLabel = useCallback((newLabel: string) => {
    const cleaned = sanitizeLabel(newLabel)
    if (!cleaned) return
    props.updateAttributes({ label: cleaned })
    setMenuAnchor(null)
    setCustomMode(false)
    setCustomText("")
  }, [props])

  return (
    <NodeViewWrapper
      as="span"
      className={`image-ref-pill${props.selected ? " image-ref-pill--selected" : ""}`}
      data-image-index={attrs.imageIndex}
      data-image-label={attrs.label}
      title={defaultName ? `${defaultName} (image ${attrs.imageIndex})` : `image ${attrs.imageIndex}`}
    >
      {url && (
        <img
          src={optimizedImageUrl(url, { width: 48, quality: 80 })}
          alt=""
          className="image-ref-pill__thumb"
          draggable={false}
          onMouseEnter={(e) => setHoverAnchor(e.currentTarget.getBoundingClientRect())}
          onMouseLeave={() => setHoverAnchor(null)}
        />
      )}
      <button
        type="button"
        className="image-ref-pill__label"
        contentEditable={false}
        onMouseDown={(e) => {
          // Stop ProseMirror from selecting the node so our menu wins the click.
          e.preventDefault()
          e.stopPropagation()
          setMenuAnchor(e.currentTarget.getBoundingClientRect())
        }}
        title="Click to change role"
      >
        @image:{attrs.imageIndex}{attrs.label && `:${attrs.label}`}
      </button>
      <button
        type="button"
        aria-label="Remove image reference"
        className="image-ref-pill__remove"
        onMouseDown={(e) => {
          e.preventDefault()
          handleRemove()
        }}
      >
        ×
      </button>
      {url && hoverAnchor && createPortal(
        (() => {
          const PREVIEW_MAX = 220
          const MARGIN = 8
          const vh = window.innerHeight
          const vw = window.innerWidth
          const spaceBelow = vh - hoverAnchor.bottom - MARGIN
          const spaceAbove = hoverAnchor.top - MARGIN
          const placeBelow = spaceBelow >= PREVIEW_MAX || spaceBelow >= spaceAbove
          const top = placeBelow
            ? hoverAnchor.bottom + MARGIN
            : Math.max(MARGIN, hoverAnchor.top - PREVIEW_MAX - MARGIN)
          const left = Math.min(Math.max(MARGIN, hoverAnchor.left), vw - PREVIEW_MAX - MARGIN)
          return (
            <div
              style={{ position: "fixed", top, left }}
              className="z-[10000] pointer-events-none rounded-md shadow-xl bg-popover border border-border p-1"
              aria-hidden
            >
              <img
                src={optimizedImageUrl(url, { width: 480 })}
                alt=""
                className="block rounded object-contain"
                style={{ maxWidth: PREVIEW_MAX, maxHeight: PREVIEW_MAX }}
              />
            </div>
          )
        })(),
        document.body,
      )}
      {menuAnchor && createPortal(
        (() => {
          const MENU_W = 180
          // Estimate menu height: presets list + separator + custom button or
          // input, ~32px per row. Used to flip the menu above the anchor when
          // the viewport doesn't have room below.
          const MENU_H_ESTIMATE = (LABEL_PRESETS.length + 2) * 32 + 16
          const MARGIN = 4
          const vh = window.innerHeight
          const vw = window.innerWidth
          const spaceBelow = vh - menuAnchor.bottom - MARGIN
          const spaceAbove = menuAnchor.top - MARGIN
          const placeBelow = spaceBelow >= MENU_H_ESTIMATE || spaceBelow >= spaceAbove
          // Cap the height to whichever side we're rendering in so the list
          // stays scrollable inside the viewport.
          const maxHeight = Math.max(120, placeBelow ? spaceBelow : spaceAbove)
          const top = placeBelow
            ? menuAnchor.bottom + MARGIN
            : Math.max(MARGIN, menuAnchor.top - Math.min(MENU_H_ESTIMATE, spaceAbove) - MARGIN)
          const left = Math.min(Math.max(MARGIN, menuAnchor.left), vw - MENU_W - MARGIN)
          return (
            <div
              ref={menuRef}
              style={{ position: "fixed", top, left, width: MENU_W, maxHeight, overflowY: "auto" }}
              className="z-[10000] rounded-lg border border-border bg-popover shadow-lg py-1"
              role="menu"
              // Swallow mousedown at the menu boundary so the document-level
              // outside-click listener never sees clicks that originated inside
              // the menu (containment-checks via menuRef.contains can race with
              // re-renders during state updates).
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
            >
              {LABEL_PRESETS.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  role="menuitem"
                  className={`w-full text-left px-2.5 py-1.5 text-[11px] flex items-center justify-between transition-colors ${
                    attrs.label === preset
                      ? "bg-pink-500/15 text-pink-700 dark:text-pink-300"
                      : "hover:bg-muted text-foreground"
                  }`}
                  onClick={(e) => {
                    e.stopPropagation()
                    updateLabel(preset)
                  }}
                >
                  <span>{preset}</span>
                  {attrs.label === preset && <span aria-hidden>✓</span>}
                </button>
              ))}
              <div className="my-1 border-t border-border/60" />
              {customMode ? (
                <div className="px-2 py-1.5 flex items-center gap-1">
                  <input
                    ref={customInputRef}
                    value={customText}
                    onChange={(e) => setCustomText(e.target.value)}
                    placeholder="dragon  or  Danny"
                    className="flex-1 min-w-0 text-[11px] px-2 py-1 rounded border border-border bg-background outline-none focus:ring-2 focus:ring-pink-400/50"
                    onClick={(e) => e.stopPropagation()}
                    onMouseDown={(e) => e.stopPropagation()}
                    onKeyDown={(e) => {
                      // Tiptap listens for keyboard events at document level for
                      // its editor — stopPropagation here prevents Enter/Escape
                      // from leaking into the editor's keymap.
                      e.stopPropagation()
                      if (e.key === "Enter") {
                        e.preventDefault()
                        updateLabel(customText)
                      } else if (e.key === "Escape") {
                        e.preventDefault()
                        setCustomMode(false)
                        setCustomText("")
                      }
                    }}
                  />
                  <button
                    type="button"
                    aria-label="Apply custom label"
                    className="text-[11px] px-2 py-1 rounded bg-pink-500/15 text-pink-700 hover:bg-pink-500/25 dark:text-pink-300 disabled:opacity-40 disabled:cursor-not-allowed"
                    disabled={sanitizeLabel(customText).length === 0}
                    onClick={(e) => {
                      e.stopPropagation()
                      updateLabel(customText)
                    }}
                  >
                    OK
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  role="menuitem"
                  className="w-full text-left px-2.5 py-1.5 text-[11px] hover:bg-muted text-foreground italic"
                  onClick={(e) => {
                    e.stopPropagation()
                    const isCustom = attrs.label && !LABEL_PRESETS.includes(attrs.label as typeof LABEL_PRESETS[number])
                    setCustomMode(true)
                    setCustomText(isCustom ? attrs.label : "")
                  }}
                >
                  Custom…
                </button>
              )}
            </div>
          )
        })(),
        document.body,
      )}
    </NodeViewWrapper>
  )
}
