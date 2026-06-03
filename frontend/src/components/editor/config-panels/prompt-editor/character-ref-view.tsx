"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react"
import {
  USAGE_MODES,
  usageModeLabel,
  type UsageMode,
} from "@nodaro/shared"
import { optimizedImageUrl } from "@/lib/image"
import type { CharacterRefAttrs } from "./character-ref-extension"

/** Subset of `RefImageItem` the pill needs to render. Loose shape because the
 *  extension stores the autocomplete list keyed by `characterSlug + variantSlug`
 *  but doesn't depend on the full RefImageItem type (avoids a circular type
 *  dependency between the editor and the config panels). */
interface RefEntry {
  url: string
  characterSlug?: string
  variantSlug?: string
  variantDisplayName?: string
  /** Character display name as it appears in the autocomplete (e.g. "Kira"). */
  label?: string
}

/**
 * Resolve a pill's `(characterSlug, variantSlug)` against the live list in
 * editor storage. Returns the closest match — exact variant match preferred,
 * otherwise the canonical entry for the same character, otherwise undefined
 * (broken pill).
 *
 * The fallback to canonical matters because users can attach a character
 * node, mention a specific variant, then later detach that variant — the
 * pill should still show the character's canonical thumbnail rather than
 * a broken "?" until they fix the slug.
 */
function resolveRef(list: readonly RefEntry[], attrs: CharacterRefAttrs): RefEntry | undefined {
  if (!attrs.characterSlug) return undefined
  // Exact variant match (or canonical when slug is null).
  for (const r of list) {
    if (r.characterSlug !== attrs.characterSlug) continue
    if (attrs.variantSlug) {
      if (r.variantSlug === attrs.variantSlug) return r
    } else {
      if (!r.variantSlug) return r
    }
  }
  // Fallback: canonical for this character (any entry without a variantSlug).
  for (const r of list) {
    if (r.characterSlug === attrs.characterSlug && !r.variantSlug) return r
  }
  // Last resort: any entry for this character (so the user at least sees a thumbnail).
  for (const r of list) {
    if (r.characterSlug === attrs.characterSlug) return r
  }
  return undefined
}

const LABEL_PRESETS_LIVE: readonly UsageMode[] = USAGE_MODES

export function CharacterRefView(props: NodeViewProps) {
  const attrs = props.node.attrs as CharacterRefAttrs

  const storage = props.editor.storage as unknown as Record<string, {
    referenceImages?: readonly RefEntry[]
    revision?: number
  }>
  // Read the latest character/variant list straight from editor storage. The
  // parent `PromptEditor` keeps this in sync via the same mechanism used for
  // `imageRef.referenceImages` and dispatches a no-op transaction on change
  // to force a re-render of all node views.
  const list = storage.characterRef?.referenceImages ?? []
  const ref = useMemo(() => resolveRef(list, attrs), [list, attrs])
  const isBroken = !ref?.url

  const [hoverAnchor, setHoverAnchor] = useState<DOMRect | null>(null)
  const [menuAnchor, setMenuAnchor] = useState<DOMRect | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)

  // Clean up any stuck preview / menu on unmount (e.g. when the pill is deleted).
  useEffect(() => () => {
    setHoverAnchor(null)
    setMenuAnchor(null)
  }, [])

  // Close menu on outside click or Escape — mirrors image-ref-view.tsx.
  useEffect(() => {
    if (!menuAnchor) return
    function onDown(e: PointerEvent) {
      if (menuRef.current?.contains(e.target as Node)) return
      setMenuAnchor(null)
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setMenuAnchor(null)
    }
    // Capture-phase pointerdown intercepts before any inner stopPropagation
    // (e.g. ProseMirror's own mousedown handlers) hides the click from us.
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

  const setUsageMode = useCallback((mode: UsageMode | null) => {
    props.updateAttributes({ usageMode: mode })
    setMenuAnchor(null)
  }, [props])

  const characterDisplay = ref?.label ?? attrs.characterSlug
  const variantDisplay = attrs.variantSlug
    ? (ref?.variantDisplayName && ref.variantDisplayName !== "canonical"
        ? ref.variantDisplayName
        : attrs.variantSlug)
    : null

  const tooltip = [
    `@${attrs.characterSlug}:${attrs.imageIndex}`,
    attrs.variantSlug && `variant: ${attrs.variantSlug}`,
    attrs.usageMode && `mode: ${attrs.usageMode}`,
    isBroken && "no matching character is wired to this node",
  ]
    .filter(Boolean)
    .join(" • ")

  return (
    <NodeViewWrapper
      as="span"
      data-character-ref=""
      data-character-slug={attrs.characterSlug}
      data-variant-slug={attrs.variantSlug ?? ""}
      className={
        "character-ref-pill"
        + (props.selected ? " character-ref-pill--selected" : "")
        + (isBroken ? " character-ref-pill--broken" : "")
      }
      title={tooltip}
    >
      {ref?.url ? (
        <img
          src={optimizedImageUrl(ref.url, { width: 48, quality: 80 })}
          alt=""
          className="character-ref-pill__thumb"
          draggable={false}
          onMouseEnter={(e) => setHoverAnchor(e.currentTarget.getBoundingClientRect())}
          onMouseLeave={() => setHoverAnchor(null)}
        />
      ) : (
        <span className="character-ref-pill__thumb-broken" aria-hidden>?</span>
      )}
      <button
        type="button"
        className="character-ref-pill__label"
        contentEditable={false}
        onMouseDown={(e) => {
          // Stop ProseMirror from selecting the node so the menu wins the click.
          e.preventDefault()
          e.stopPropagation()
          setMenuAnchor(e.currentTarget.getBoundingClientRect())
        }}
        title="Click to change usage mode"
      >
        <span className="character-ref-pill__name">@{characterDisplay}</span>
        <span className="character-ref-pill__index">:{attrs.imageIndex}</span>
        {variantDisplay && (
          <span className="character-ref-pill__variant">/{variantDisplay}</span>
        )}
        {attrs.usageMode && (
          <span className="character-ref-pill__mode-badge">{usageModeLabel(attrs.usageMode)}</span>
        )}
      </button>
      <button
        type="button"
        aria-label="Remove character reference"
        className="character-ref-pill__remove"
        onMouseDown={(e) => {
          e.preventDefault()
          handleRemove()
        }}
      >
        ×
      </button>
      {ref?.url && hoverAnchor && createPortal(
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
                src={optimizedImageUrl(ref.url, { width: 480 })}
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
          const MENU_W = 200
          const MENU_H_ESTIMATE = (LABEL_PRESETS_LIVE.length + 2) * 32 + 16
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
              ref={menuRef}
              style={{ position: "fixed", top, left, width: MENU_W, maxHeight, overflowY: "auto" }}
              className="z-[10000] rounded-lg border border-border bg-popover shadow-lg py-1"
              role="menu"
              // Stop the document-level outside-click listener from seeing
              // clicks inside the menu (containment-checks can race with
              // re-renders during state updates).
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
            >
              {/* "Default" row — clears the mode override so the pill falls
                  back to the character node's defaultUsageMode at execution
                  time. Mirrors the autocomplete's no-mode insertion path. */}
              <button
                key="__default__"
                type="button"
                role="menuitem"
                className={`w-full text-left px-2.5 py-1.5 text-[11px] flex items-center justify-between transition-colors ${
                  attrs.usageMode == null
                    ? "bg-violet-500/15 text-violet-700 dark:text-violet-300"
                    : "hover:bg-muted text-foreground"
                }`}
                onClick={(e) => {
                  e.stopPropagation()
                  setUsageMode(null)
                }}
              >
                <span>Default (from character)</span>
                {attrs.usageMode == null && <span aria-hidden>✓</span>}
              </button>
              <div className="my-1 border-t border-border/60" />
              {LABEL_PRESETS_LIVE.map((m) => (
                <button
                  key={m}
                  type="button"
                  role="menuitem"
                  className={`w-full text-left px-2.5 py-1.5 text-[11px] flex items-center justify-between transition-colors ${
                    attrs.usageMode === m
                      ? "bg-violet-500/15 text-violet-700 dark:text-violet-300"
                      : "hover:bg-muted text-foreground"
                  }`}
                  onClick={(e) => {
                    e.stopPropagation()
                    setUsageMode(m)
                  }}
                >
                  <span>{usageModeLabel(m)}</span>
                  <span className="text-[10px] font-mono text-muted-foreground">:{m}</span>
                </button>
              ))}
            </div>
          )
        })(),
        document.body,
      )}
    </NodeViewWrapper>
  )
}
