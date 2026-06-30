"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react"
import {
  LOCATION_USAGE_MODES,
  locationUsageModeLabel,
  normalizeRoleSlug,
  type LocationUsageMode,
} from "@nodaro/shared"
import { optimizedImageUrl } from "@/lib/image"
import { IMAGE_REFERENCE_FORMAT } from "@/lib/image-reference-format"
import { BODY_MENU_CLASS } from "./body-menu-class"
import { useBodyMenuDismiss } from "./use-body-menu-dismiss"
import { PROMPT_EDITOR_PORTAL_PROPS } from "./prompt-editor-portal"
import { computeFlipPosition } from "./flip-position"
import {
  LOCATION_ROLE_PRESETS,
  locationSwapMenuRoles,
  roleToLocationRefSlots,
} from "./location-ref-roles"
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

  // Hybrid gate: in "hybrid" format the swap-menu offers curated ROLE presets
  // (+ a Default row, NO Custom input — the location parser is preset-gated);
  // in "legacy" it keeps the EXISTING usage-mode menu UNCHANGED.
  // `roleMenuPresets` is null in legacy. A location role lives in EITHER `role`
  // (genuine roles) OR `usageMode` (the two presets — layout/style — that are
  // also LocationUsageModes, whose parser-stable slot is `usageMode`). The
  // active role's PHRASE form (badge + menu highlight) maps from whichever slot
  // is set via `normalizeRoleSlug`.
  const roleMenuPresets = locationSwapMenuRoles(IMAGE_REFERENCE_FORMAT)
  const isHybrid = roleMenuPresets !== null
  const currentRolePhrase = useMemo<string | null>(() => {
    if (!isHybrid) return null
    if (attrs.role) return normalizeRoleSlug(attrs.role)
    // A usageMode that is also a role preset (layout / style) surfaces as that
    // role in hybrid — so a token round-tripped to `usageMode` still shows the
    // picked role. The non-role modes (identical / none) map to no role badge.
    if (attrs.usageMode && LOCATION_ROLE_PRESETS.includes(attrs.usageMode)) {
      return attrs.usageMode
    }
    return null
  }, [isHybrid, attrs.role, attrs.usageMode])

  // Clean up any stuck preview / menu on unmount (e.g. when the pill is deleted).
  useEffect(() => () => {
    setHoverAnchor(null)
    setMenuAnchor(null)
  }, [])

  // Dismiss on outside-click / Escape + escape the modal scroll-lock so the
  // menu can scroll. Shared by all body-portaled pill views.
  useBodyMenuDismiss(menuRef, menuAnchor, () => setMenuAnchor(null))

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

  // Hybrid role pick: route the role into its single token slot (a
  // LocationUsageMode → `usageMode`, else `role`) and CLEAR every sibling so
  // the slots stay mutually exclusive (never an invalid multi-segment token).
  const setRole = useCallback((rolePhrase: string) => {
    props.updateAttributes(roleToLocationRefSlots(rolePhrase))
    setMenuAnchor(null)
  }, [props])

  // Hybrid "Default" pick: clear ALL override slots so the pill falls back to
  // the location's canonical reference (a clean @loc:1) at execution time.
  const clearRole = useCallback(() => {
    props.updateAttributes({ role: null, usageMode: null, bucket: null, variant: null })
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
    // Hybrid surfaces the role (phrase form); legacy keeps the raw mode line.
    isHybrid
      ? currentRolePhrase && `role: ${currentRolePhrase}`
      : attrs.usageMode && `mode: ${attrs.usageMode}`,
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
          src={optimizedImageUrl(ref.url, { width: 48, quality: 80 })}
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
        {isHybrid
          ? currentRolePhrase && (
              <span className="location-ref-pill__mode-badge">{currentRolePhrase}</span>
            )
          : attrs.usageMode && (
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
          // Shares the editor's flip-above-when-cramped math; the preview div's
          // own maxWidth/maxHeight stay local. Threshold + secondary margin
          // reproduce the original `spaceBelow >= PREVIEW_MAX || spaceBelow >= (top - 8)`.
          const { top, left } = computeFlipPosition(hoverAnchor, {
            width: PREVIEW_MAX,
            estHeight: PREVIEW_MAX,
            margin: 8,
            placeBelowThreshold: PREVIEW_MAX,
            secondaryClauseMargin: 8,
          })
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
          const MENU_W = 220
          // Height estimate drives the flip-above-when-cramped math. In hybrid
          // the vocabulary is the role presets (no Custom row for location); in
          // legacy it's the usage-mode list — keeping the legacy estimate
          // byte-identical to before.
          const vocabCount = isHybrid
            ? (roleMenuPresets as readonly string[]).length
            : LOCATION_MODE_PRESETS_LIVE.length
          const MENU_H_ESTIMATE = (vocabCount + 2) * 32 + 16
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
              // Hybrid role menu gets its own test hook; legacy keeps the
              // original testid so the existing mode-menu test stays valid and
              // the legacy DOM is byte-identical.
              data-testid={isHybrid ? "location-ref-role-menu" : "location-ref-mode-menu"}
              // Stop the document-level outside-click listener from seeing
              // clicks inside the menu (containment-checks can race with
              // re-renders during state updates).
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
            >
              {isHybrid ? (
                <>
                  {/* "Default" row — clears every override slot so the pill
                      falls back to the location's canonical reference. */}
                  <button
                    key="__default__"
                    type="button"
                    role="menuitem"
                    className={`w-full text-left px-2.5 py-1.5 text-[11px] flex items-center justify-between transition-colors ${
                      currentRolePhrase == null
                        ? "bg-cyan-500/15 text-cyan-700 dark:text-cyan-300"
                        : "hover:bg-muted text-foreground"
                    }`}
                    onClick={(e) => {
                      e.stopPropagation()
                      clearRole()
                    }}
                  >
                    <span>Default (from location)</span>
                    {currentRolePhrase == null && <span aria-hidden>✓</span>}
                  </button>
                  <div className="my-1 border-t border-border/60" />
                  {(roleMenuPresets as readonly string[]).map((roleP) => (
                    <button
                      key={roleP}
                      type="button"
                      role="menuitem"
                      data-role={roleP}
                      className={`w-full text-left px-2.5 py-1.5 text-[11px] flex items-center justify-between transition-colors ${
                        currentRolePhrase === roleP
                          ? "bg-cyan-500/15 text-cyan-700 dark:text-cyan-300"
                          : "hover:bg-muted text-foreground"
                      }`}
                      onClick={(e) => {
                        e.stopPropagation()
                        setRole(roleP)
                      }}
                    >
                      <span>{roleP}</span>
                      {currentRolePhrase === roleP && <span aria-hidden>✓</span>}
                    </button>
                  ))}
                </>
              ) : (
                <>
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
                </>
              )}
            </div>
          )
        })(),
        document.body,
      )}
    </NodeViewWrapper>
  )
}
