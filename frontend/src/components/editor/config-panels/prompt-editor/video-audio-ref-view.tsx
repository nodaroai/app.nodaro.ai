"use client"

import { useState, useCallback, useEffect, useRef } from "react"
import { createPortal } from "react-dom"
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react"
import { Film, Music } from "lucide-react"
import { BODY_MENU_CLASS } from "./body-menu-class"
import { useBodyMenuDismiss } from "./use-body-menu-dismiss"
import { PROMPT_EDITOR_PORTAL_PROPS } from "./prompt-editor-portal"
import { ReferencePickerMenu } from "./reference-picker-menu"
import { useReferenceSwapPicker } from "./use-reference-picker"

/**
 * React node view for the `{video:N:label}` / `{audio:N:label}` atomic pills —
 * the visual sibling of `image-ref-view.tsx`. It is NOT a reuse of the image
 * view because that one hardcodes `@image:` text and renders an `<img>`
 * thumbnail; video/audio slots have no inline thumbnail (the reference media is
 * a clip / audio track), so this view mirrors the image pill STRUCTURALLY —
 * icon + clickable monospace label + reveal-on-hover remove + a body-portaled
 * role menu (presets + custom) — while staying kind-aware (distinct icon +
 * accent driven by the `${kind}-ref-pill` CSS classes in globals.css).
 *
 * The pill is a pure display layer: it never changes `editor.getText()` beyond
 * the atomic node's `renderText`, which the extension owns. This view only
 * edits the node's `label` attribute and deletes the node.
 */

interface VideoAudioRefAttrs {
  refIndex: number
  label: string
}

type RefKind = "video" | "audio"

/** Role presets offered in the swap menu, per modality. Mirrors image's
 *  `LABEL_PRESETS`; users can also enter a free-form custom label. */
const PRESETS: Record<RefKind, readonly string[]> = {
  video: ["clip", "scene", "shot", "motion", "background", "style"],
  audio: ["music", "voice", "sfx", "ambience", "dialogue", "track"],
}

/**
 * Keep custom labels safe for the `{video:N:label}` / `{audio:N:label}` token
 * format (mirrors image's `sanitizeLabel`): trim, spaces → hyphens, strip
 * anything outside `[a-zA-Z0-9_-]`, cap length. Case is preserved so proper
 * nouns survive.
 */
function sanitizeLabel(raw: string): string {
  return raw
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-zA-Z0-9_-]/g, "")
    .slice(0, 32)
}

/** Derive the modality from the node's type name (`videoRef` / `audioRef`). */
function kindOf(props: NodeViewProps): RefKind {
  return props.node.type.name === "audioRef" ? "audio" : "video"
}

export function VideoAudioRefView(props: NodeViewProps) {
  const attrs = props.node.attrs as VideoAudioRefAttrs
  const kind = kindOf(props)
  const presets = PRESETS[kind]
  const [menuAnchor, setMenuAnchor] = useState<DOMRect | null>(null)
  const [customMode, setCustomMode] = useState(false)
  const [customText, setCustomText] = useState("")
  const customInputRef = useRef<HTMLInputElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)

  // Clean up any stuck menu when the node unmounts (deletion, etc.).
  useEffect(() => () => { setMenuAnchor(null) }, [])

  // Auto-focus the custom-label input when entering custom mode.
  useEffect(() => {
    if (customMode) customInputRef.current?.focus()
  }, [customMode])

  // Dismiss on outside-click / Escape + escape the modal scroll-lock so the
  // menu can scroll. Shared by all body-portaled pill views.
  useBodyMenuDismiss(menuRef, menuAnchor, () => {
    setMenuAnchor(null)
    setCustomMode(false)
  })

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

  // "Ref only": clear the label so the token is bare `{video:N}` / `{audio:N}`,
  // which the resolver injects as just "@video_N" / "@audio_N" (no wrapper).
  const clearLabel = useCallback(() => {
    props.updateAttributes({ label: "" })
    setMenuAnchor(null)
    setCustomMode(false)
    setCustomText("")
  }, [props])

  const Icon = kind === "audio" ? Music : Film

  // Icon click → the reference swap picker (issue 4). Video/audio chips have no
  // still thumbnail, so the modality icon is the swap target.
  const picker = useReferenceSwapPicker(props)

  return (
    <NodeViewWrapper
      as="span"
      className={`${kind}-ref-pill${props.selected ? ` ${kind}-ref-pill--selected` : ""}`}
      data-ref-kind={kind}
      data-ref-index={attrs.refIndex}
      data-ref-label={attrs.label}
      title={`${kind} ${attrs.refIndex}`}
    >
      <Icon
        className={`${kind}-ref-pill__icon`}
        aria-hidden
        style={{ cursor: "pointer" }}
        onMouseDown={(e) => {
          e.preventDefault()
          e.stopPropagation()
          picker.openPicker(e.currentTarget.getBoundingClientRect())
        }}
      />
      <button
        type="button"
        className={`${kind}-ref-pill__label`}
        contentEditable={false}
        onMouseDown={(e) => {
          // Stop ProseMirror from selecting the node so our menu wins the click.
          e.preventDefault()
          e.stopPropagation()
          setMenuAnchor(e.currentTarget.getBoundingClientRect())
        }}
        title="Click to change role"
      >
        @{kind}:{attrs.refIndex}{attrs.label && `:${attrs.label}`}
      </button>
      <button
        type="button"
        aria-label={`Remove ${kind} reference`}
        className={`${kind}-ref-pill__remove`}
        onMouseDown={(e) => {
          e.preventDefault()
          handleRemove()
        }}
      >
        ×
      </button>
      {menuAnchor && createPortal(
        (() => {
          const MENU_W = 180
          // Estimate menu height: presets list + separator + custom row,
          // ~32px per row. Used to flip the menu above when the viewport
          // doesn't have room below.
          const MENU_H_ESTIMATE = (presets.length + 3) * 32 + 16
          const MARGIN = 4
          const vh = window.innerHeight
          const vw = window.innerWidth
          const spaceBelow = vh - menuAnchor.bottom - MARGIN
          const spaceAbove = menuAnchor.top - MARGIN
          const placeBelow = spaceBelow >= MENU_H_ESTIMATE || spaceBelow >= spaceAbove
          const maxHeight = Math.max(120, placeBelow ? spaceBelow : spaceAbove)
          const top = placeBelow
            ? menuAnchor.bottom + MARGIN
            : Math.max(MARGIN, menuAnchor.top - Math.min(MENU_H_ESTIMATE, spaceAbove) - MARGIN)
          const left = Math.min(Math.max(MARGIN, menuAnchor.left), vw - MENU_W - MARGIN)
          return (
            <div
              {...PROMPT_EDITOR_PORTAL_PROPS}
              ref={menuRef}
              style={{ position: "fixed", top, left, width: MENU_W, maxHeight, overflowY: "auto" }}
              className={BODY_MENU_CLASS}
              role="menu"
              // Swallow mousedown/click at the boundary so the document-level
              // outside-click listener never sees clicks that originated inside
              // the menu.
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
            >
              <button
                key="__ref-only__"
                type="button"
                role="menuitem"
                className={`w-full text-left px-2.5 py-1.5 text-[11px] flex items-center justify-between transition-colors ${
                  attrs.label === ""
                    ? "bg-accent text-accent-foreground"
                    : "hover:bg-muted text-foreground"
                }`}
                onClick={(e) => {
                  e.stopPropagation()
                  clearLabel()
                }}
              >
                <span>Ref only</span>
                {attrs.label === "" && <span aria-hidden>✓</span>}
              </button>
              <div className="my-1 border-t border-border/60" />
              {presets.map((preset) => (
                <button
                  key={preset}
                  type="button"
                  role="menuitem"
                  className={`w-full text-left px-2.5 py-1.5 text-[11px] flex items-center justify-between transition-colors ${
                    attrs.label === preset
                      ? "bg-accent text-accent-foreground"
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
                    placeholder="intro  or  Sarah"
                    className="flex-1 min-w-0 text-[11px] px-2 py-1 rounded border border-border bg-background outline-none focus:ring-2 focus:ring-ring/50"
                    onClick={(e) => e.stopPropagation()}
                    onMouseDown={(e) => e.stopPropagation()}
                    onKeyDown={(e) => {
                      // Tiptap listens for keyboard events at document level —
                      // stopPropagation prevents Enter/Escape from leaking into
                      // the editor's keymap.
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
                    className="text-[11px] px-2 py-1 rounded bg-accent text-accent-foreground hover:opacity-90 disabled:opacity-40 disabled:cursor-not-allowed"
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
                    const isCustom = !!attrs.label && !presets.includes(attrs.label)
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
      {picker.pickerAnchor && (
        <ReferencePickerMenu
          items={picker.items}
          anchor={picker.pickerAnchor}
          onSelect={picker.swap}
          onClose={picker.closePicker}
        />
      )}
    </NodeViewWrapper>
  )
}
