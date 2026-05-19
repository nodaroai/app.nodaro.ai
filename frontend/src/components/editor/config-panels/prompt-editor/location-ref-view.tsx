"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react"
import {
  LOCATION_USAGE_MODES,
  locationUsageModeLabel,
  type LocationUsageMode,
} from "@nodaro/shared"
import type { LocationRefAttrs } from "./location-ref-extension"

/**
 * Subset of `RefImageItem` the location pill needs to render. Loose shape
 * because the extension stores the autocomplete list keyed by
 * `locationSlug + bucket + variant` but doesn't depend on the full
 * `RefImageItem` type (avoids a circular type dependency between the editor
 * and the config panels).
 */
interface RefEntry {
  url: string
  locationSlug?: string
  locationVariantBucket?: string
  locationVariantSlug?: string
  locationVariantDisplayName?: string
  /** Location display name as it appears in the autocomplete (e.g. "Old Library"). */
  label?: string
}

/**
 * Resolve a pill's `(locationSlug, bucket, variant)` against the live list
 * in editor storage. Returns the closest match — exact bucket+variant
 * preferred, otherwise the canonical entry for the same location, otherwise
 * undefined (broken pill).
 *
 * Mirrors `resolveRef` in `character-ref-view.tsx` — the fallback to
 * canonical matters because a user can attach a location node, mention a
 * specific variant, then later detach that variant; the pill should still
 * show the location's canonical thumbnail rather than a broken "?" until
 * they fix the slug.
 */
function resolveRef(list: readonly RefEntry[], attrs: LocationRefAttrs): RefEntry | undefined {
  if (!attrs.locationSlug) return undefined
  // Exact bucket+variant match (or canonical when both are null).
  for (const r of list) {
    if (r.locationSlug !== attrs.locationSlug) continue
    if (attrs.bucket && attrs.variant) {
      if (
        r.locationVariantBucket === attrs.bucket
        && r.locationVariantSlug === attrs.variant
      ) {
        return r
      }
    } else {
      // Canonical pill (no variant) — match an entry without a variant bucket.
      if (!r.locationVariantBucket && !r.locationVariantSlug) return r
    }
  }
  // Fallback: canonical entry for this location.
  for (const r of list) {
    if (r.locationSlug === attrs.locationSlug && !r.locationVariantBucket) return r
  }
  // Last resort: any entry for this location.
  for (const r of list) {
    if (r.locationSlug === attrs.locationSlug) return r
  }
  return undefined
}

const LOCATION_MODE_PRESETS_LIVE: readonly LocationUsageMode[] = LOCATION_USAGE_MODES

export function LocationRefView(props: NodeViewProps) {
  const attrs = props.node.attrs as LocationRefAttrs

  const storage = props.editor.storage as unknown as Record<string, {
    referenceImages?: readonly RefEntry[]
    revision?: number
  }>
  const list = storage.locationRef?.referenceImages ?? []
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

  // Close menu on outside click or Escape — mirrors character-ref-view.tsx.
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

  const setUsageMode = useCallback((mode: LocationUsageMode | null) => {
    props.updateAttributes({ usageMode: mode })
    setMenuAnchor(null)
  }, [props])

  const locationDisplay = ref?.label ?? attrs.locationSlug
  const variantDisplay = attrs.bucket && attrs.variant
    ? (ref?.locationVariantDisplayName && ref.locationVariantDisplayName !== "canonical"
        ? ref.locationVariantDisplayName
        : attrs.variant)
    : null

  const tooltip = [
    `@${attrs.locationSlug}:${attrs.imageIndex}`,
    attrs.bucket && attrs.variant && `variant: ${attrs.bucket}/${attrs.variant}`,
    attrs.usageMode && `mode: ${attrs.usageMode}`,
    isBroken && "no matching location is wired to this node",
  ]
    .filter(Boolean)
    .join(" • ")

  return (
    <NodeViewWrapper
      as="span"
      data-location-ref=""
      data-location-slug={attrs.locationSlug}
      data-location-bucket={attrs.bucket ?? ""}
      data-location-variant={attrs.variant ?? ""}
      className={
        "location-ref-pill"
        + (props.selected ? " location-ref-pill--selected" : "")
        + (isBroken ? " location-ref-pill--broken" : "")
      }
      title={tooltip}
    >
      {ref?.url ? (
        <img
          src={ref.url}
          alt=""
          className="location-ref-pill__thumb"
          draggable={false}
          onMouseEnter={(e) => setHoverAnchor(e.currentTarget.getBoundingClientRect())}
          onMouseLeave={() => setHoverAnchor(null)}
        />
      ) : (
        <span className="location-ref-pill__thumb-broken" aria-hidden>?</span>
      )}
      <button
        type="button"
        className="location-ref-pill__label"
        contentEditable={false}
        onMouseDown={(e) => {
          // Stop ProseMirror from selecting the node so the menu wins the click.
          e.preventDefault()
          e.stopPropagation()
          setMenuAnchor(e.currentTarget.getBoundingClientRect())
        }}
        title="Click to change usage mode"
      >
        <span className="location-ref-pill__name">@{locationDisplay}</span>
        <span className="location-ref-pill__index">:{attrs.imageIndex}</span>
        {variantDisplay && (
          <span className="location-ref-pill__variant">/{variantDisplay}</span>
        )}
        {attrs.usageMode && (
          <span className="location-ref-pill__mode-badge">{locationUsageModeLabel(attrs.usageMode)}</span>
        )}
      </button>
      <button
        type="button"
        aria-label="Remove location reference"
        className="location-ref-pill__remove"
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
                src={ref.url}
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
          const MENU_W = 220
          const MENU_H_ESTIMATE = (LOCATION_MODE_PRESETS_LIVE.length + 2) * 32 + 16
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
              data-testid="location-ref-mode-menu"
              // Stop the document-level outside-click listener from seeing
              // clicks inside the menu (containment-checks can race with
              // re-renders during state updates).
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
            >
              {/* "Default" row — clears the mode override so the pill falls
                  back to the location node's defaultUsageMode at execution
                  time. Mirrors the autocomplete's no-mode insertion path. */}
              <button
                key="__default__"
                type="button"
                role="menuitem"
                className={`w-full text-left px-2.5 py-1.5 text-[11px] flex items-center justify-between transition-colors ${
                  attrs.usageMode == null
                    ? "bg-cyan-500/15 text-cyan-700 dark:text-cyan-300"
                    : "hover:bg-muted text-foreground"
                }`}
                onClick={(e) => {
                  e.stopPropagation()
                  setUsageMode(null)
                }}
              >
                <span>Default (from location)</span>
                {attrs.usageMode == null && <span aria-hidden>✓</span>}
              </button>
              <div className="my-1 border-t border-border/60" />
              {LOCATION_MODE_PRESETS_LIVE.map((m) => (
                <button
                  key={m}
                  type="button"
                  role="menuitem"
                  data-mode={m}
                  className={`w-full text-left px-2.5 py-1.5 text-[11px] flex items-center justify-between transition-colors ${
                    attrs.usageMode === m
                      ? "bg-cyan-500/15 text-cyan-700 dark:text-cyan-300"
                      : "hover:bg-muted text-foreground"
                  }`}
                  onClick={(e) => {
                    e.stopPropagation()
                    setUsageMode(m)
                  }}
                >
                  <span>{locationUsageModeLabel(m)}</span>
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
