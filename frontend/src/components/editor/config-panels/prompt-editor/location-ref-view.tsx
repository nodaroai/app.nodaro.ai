"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react"
import { LOCATION_USAGE_MODES, locationUsageModeLabel, normalizeRoleSlug, type LocationUsageMode } from "@nodaro/shared"
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
  sanitizeLocationRole,
} from "./location-ref-roles"
import type { LocationRefAttrs } from "./location-ref-extension"
import { ReferencePickerMenu } from "./reference-picker-menu"
import { useReferenceSwapPicker } from "./use-reference-picker"

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
  const [customMode, setCustomMode] = useState(false)
  const [customText, setCustomText] = useState("")
  const customInputRef = useRef<HTMLInputElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)

  // Hybrid gate: in "hybrid" format the swap-menu offers curated ROLE presets
  // (+ a Custom… input + a Default row); in "legacy" it keeps the EXISTING
  // usage-mode menu UNCHANGED. `roleMenuPresets` is null in legacy. A location
  // role lives in EITHER `role` (genuine + custom roles) OR `usageMode` (the two
  // presets — layout/style — that are also LocationUsageModes, whose parser-
  // stable slot is `usageMode`). The active role's PHRASE form (badge + menu
  // highlight) maps from whichever slot is set via `normalizeRoleSlug` (custom
  // slugs pass through unchanged).
  const roleMenuPresets = locationSwapMenuRoles(IMAGE_REFERENCE_FORMAT)
  const isHybrid = roleMenuPresets !== null
  // Non-null in hybrid (the gate returned presets); `[]` in legacy — a single
  // local so the `readonly string[]` cast isn't repeated at each use site
  // (mirrors `rolePresets` in character-ref-view.tsx).
  const rolePresets: readonly string[] = roleMenuPresets ?? []
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
  // A role that isn't one of the curated presets (its phrase form isn't in the
  // list) is a CUSTOM role — prefills the Custom… input when reopened.
  const isCustomRole = !!currentRolePhrase && !LOCATION_ROLE_PRESETS.includes(currentRolePhrase)

  // Clean up any stuck preview / menu on unmount (e.g. when the pill is deleted).
  useEffect(() => () => {
    setHoverAnchor(null)
    setMenuAnchor(null)
  }, [])

  // Auto-focus the custom-role input when entering custom mode (hybrid only).
  useEffect(() => {
    if (customMode) customInputRef.current?.focus()
  }, [customMode])

  // Dismiss on outside-click / Escape + escape the modal scroll-lock so the
  // menu can scroll. Shared by all body-portaled pill views. Also resets the
  // hybrid custom-input state so it never reopens mid-typed.
  useBodyMenuDismiss(menuRef, menuAnchor, () => {
    setMenuAnchor(null)
    setCustomMode(false)
    setCustomText("")
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

  const setUsageMode = useCallback((mode: LocationUsageMode | null) => {
    props.updateAttributes({ usageMode: mode })
    setMenuAnchor(null)
  }, [props])

  // Hybrid role pick: route the role into its single token slot (a
  // LocationUsageMode → `usageMode`, else `role`) and CLEAR every sibling so
  // the slots stay mutually exclusive (never an invalid multi-segment token).
  // Presets pass through sanitizeLocationRole as a no-op; Custom values get
  // grammar-conformed to the bare-slug segment.
  const setRole = useCallback((rolePhrase: string) => {
    props.updateAttributes(roleToLocationRefSlots(rolePhrase))
    setMenuAnchor(null)
    setCustomMode(false)
    setCustomText("")
  }, [props])

  // Hybrid "Default" pick: clear ALL override slots so the pill falls back to
  // the location's canonical reference (a clean @loc:1) at execution time.
  const clearRole = useCallback(() => {
    props.updateAttributes({ role: null, usageMode: null, bucket: null, variant: null })
    setMenuAnchor(null)
    setCustomMode(false)
    setCustomText("")
  }, [props])

  // Hybrid identity-lock toggle (Task 4 + F4). Deliberately simple on/inherit:
  // ON sets `lock:true` (`~lock`), OFF clears to `undefined` (inherit — since
  // the editor source defaults lock off, inherit == off). The menu NEVER sets
  // `false` (that would pollute every off token with `~nolock`); the force-off
  // `~nolock` state (lock:false) is reachable only via a hand-typed/API token,
  // which still round-trips through parse → attr → renderText.
  const toggleLock = useCallback(() => {
    props.updateAttributes({ lock: attrs.lock === true ? undefined : true })
  }, [props, attrs.lock])

  // Bare location name for the @-label (same fix as the character pill):
  // `resolveRef` may return a VARIANT entry whose `label` is the composite
  // "Name / variant" (built in image-configs.tsx); using it verbatim duplicated
  // the variant — once in the name and once in the /variant segment. Prefer the
  // canonical (variant-less) entry's label; else strip a trailing " / variant".
  const canonicalNameEntry = list.find(
    (r) => r.locationSlug === attrs.locationSlug && !r.locationVariantBucket && r.label,
  )
  const locationDisplay =
    canonicalNameEntry?.label ?? ref?.label?.split(" / ")[0] ?? attrs.locationSlug
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
    isHybrid && attrs.lock && "identity lock: on",
    isBroken && "no matching location is wired to this node",
  ]
    .filter(Boolean)
    .join(" • ")

  // Thumbnail click → the reference swap picker (issue 4).
  const picker = useReferenceSwapPicker(props)

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
          style={{ cursor: "pointer" }}
          title="Click to swap reference"
          onMouseEnter={(e) => setHoverAnchor(e.currentTarget.getBoundingClientRect())}
          onMouseLeave={() => setHoverAnchor(null)}
          onMouseDown={(e) => {
            e.preventDefault()
            e.stopPropagation()
            setHoverAnchor(null)
            picker.openPicker(e.currentTarget.getBoundingClientRect())
          }}
        />
      ) : (
        <span
          className="location-ref-pill__thumb-broken"
          aria-hidden
          style={{ cursor: "pointer" }}
          title="Click to swap reference"
          onMouseDown={(e) => {
            e.preventDefault()
            e.stopPropagation()
            picker.openPicker(e.currentTarget.getBoundingClientRect())
          }}
        >?</span>
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
              <span className="location-ref-pill__mode-badge">
                {currentRolePhrase === "ref-only" ? "ref" : currentRolePhrase}
              </span>
            )
          : attrs.usageMode && (
              <span className="location-ref-pill__mode-badge">{locationUsageModeLabel(attrs.usageMode)}</span>
            )}
        {isHybrid && attrs.lock && (
          <span className="location-ref-pill__mode-badge" title="identity lock on">lock</span>
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
          // the vocabulary is the role presets (+1 for the Custom… row); in
          // legacy it's the usage-mode list — keeping the legacy estimate
          // byte-identical to before.
          const vocabCount = isHybrid
            ? rolePresets.length + 1
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
                  {rolePresets.map((roleP) => (
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
                  <div className="my-1 border-t border-border/60" />
                  {customMode ? (
                    <div className="px-2 py-1.5 flex items-center gap-1">
                      <input
                        ref={customInputRef}
                        value={customText}
                        onChange={(e) => setCustomText(e.target.value)}
                        placeholder="rooftop  or  courtyard"
                        data-testid="location-ref-role-custom-input"
                        className="flex-1 min-w-0 text-[11px] px-2 py-1 rounded border border-border bg-background outline-none focus:ring-2 focus:ring-cyan-400/50"
                        onClick={(e) => e.stopPropagation()}
                        onMouseDown={(e) => e.stopPropagation()}
                        onKeyDown={(e) => {
                          // Keep Enter/Escape out of the editor's keymap.
                          e.stopPropagation()
                          if (e.key === "Enter") {
                            e.preventDefault()
                            if (sanitizeLocationRole(customText)) setRole(customText)
                          } else if (e.key === "Escape") {
                            e.preventDefault()
                            setCustomMode(false)
                            setCustomText("")
                          }
                        }}
                      />
                      <button
                        type="button"
                        aria-label="Apply custom role"
                        className="text-[11px] px-2 py-1 rounded bg-cyan-500/15 text-cyan-700 hover:bg-cyan-500/25 dark:text-cyan-300 disabled:opacity-40 disabled:cursor-not-allowed"
                        disabled={sanitizeLocationRole(customText).length === 0}
                        onClick={(e) => {
                          e.stopPropagation()
                          setRole(customText)
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
                        setCustomMode(true)
                        setCustomText(isCustomRole ? (currentRolePhrase ?? "") : "")
                      }}
                    >
                      Custom…
                    </button>
                  )}
                  {/* Identity-lock toggle (Task 4) — per-mention `~lock`. Kept
                      open on click so the state change is visible. */}
                  <div className="my-1 border-t border-border/60" />
                  <button
                    type="button"
                    role="menuitemcheckbox"
                    aria-checked={!!attrs.lock}
                    data-testid="location-ref-lock-toggle"
                    className={`w-full text-left px-2.5 py-1.5 text-[11px] flex items-center justify-between transition-colors ${
                      attrs.lock
                        ? "bg-cyan-500/15 text-cyan-700 dark:text-cyan-300"
                        : "hover:bg-muted text-foreground"
                    }`}
                    onClick={(e) => {
                      e.stopPropagation()
                      toggleLock()
                    }}
                  >
                    <span>Identity lock</span>
                    {attrs.lock && <span aria-hidden>✓</span>}
                  </button>
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
