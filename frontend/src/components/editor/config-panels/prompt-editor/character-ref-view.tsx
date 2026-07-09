"use client"

import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { createPortal } from "react-dom"
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react"
import { USAGE_MODES, usageModeLabel, type UsageMode } from "@nodaro/shared"
import { optimizedImageUrl } from "@/lib/image"
import { IMAGE_REFERENCE_FORMAT } from "@/lib/image-reference-format"
import { BODY_MENU_CLASS } from "./body-menu-class"
import { useBodyMenuDismiss } from "./use-body-menu-dismiss"
import { PROMPT_EDITOR_PORTAL_PROPS } from "./prompt-editor-portal"
import { computeFlipPosition } from "./flip-position"
import {
  CHARACTER_ROLE_PRESETS,
  characterSwapMenuRoles,
  roleToCharacterRefSlots,
  sanitizeRole,
} from "./character-ref-roles"
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
  const [customMode, setCustomMode] = useState(false)
  const [customText, setCustomText] = useState("")
  const customInputRef = useRef<HTMLInputElement | null>(null)
  const menuRef = useRef<HTMLDivElement | null>(null)

  // Hybrid gate: in "hybrid" format the swap-menu offers curated ROLE presets
  // (+ a Custom… input + Default); in "legacy" it keeps the EXISTING usage-mode
  // menu unchanged. `roleMenuPresets` is null in legacy. The role lives in
  // exactly one token slot — `usageMode` XOR `variantSlug` — so the active role
  // is whichever slot is set (the D1 resolver reads `usageMode ?? variantSlug`).
  const roleMenuPresets = characterSwapMenuRoles(IMAGE_REFERENCE_FORMAT)
  const isHybrid = roleMenuPresets !== null
  // Non-null in hybrid (the gate returned presets); `[]` in legacy — a single
  // local so the `readonly string[]` cast isn't repeated at each use site.
  const rolePresets: readonly string[] = roleMenuPresets ?? []
  const currentRole = isHybrid ? (attrs.usageMode ?? attrs.variantSlug) : null
  const isCustomRole = !!currentRole && !CHARACTER_ROLE_PRESETS.includes(currentRole)

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

  const setUsageMode = useCallback((mode: UsageMode | null) => {
    props.updateAttributes({ usageMode: mode })
    setMenuAnchor(null)
  }, [props])

  // Hybrid role pick: route the role into its single token slot (UsageMode →
  // usageMode, else variantSlug) and CLEAR the sibling so the slots stay
  // mutually exclusive (never an invalid 4-part token). Presets pass through
  // sanitizeRole as a no-op; Custom values get grammar-conformed.
  const setRole = useCallback((role: string) => {
    props.updateAttributes(roleToCharacterRefSlots(role))
    setMenuAnchor(null)
    setCustomMode(false)
    setCustomText("")
  }, [props])

  // Hybrid "Default" pick: clear BOTH slots so the token falls back to the
  // source's default role at execution time (a clean @kira:1).
  const clearRole = useCallback(() => {
    props.updateAttributes({ usageMode: null, variantSlug: null })
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

  // The @-name must be the BARE character name. `resolveRef` may return a
  // VARIANT entry whose `label` is the composite "Name / variant" (built in
  // image-configs.tsx); using it verbatim duplicated the variant — once in the
  // name and once in the role/variant badge (the "@abi/walking:1 walking" bug).
  // Prefer the canonical (variant-less) entry's label; else strip a trailing
  // " / variant" off whatever resolved.
  const canonicalNameEntry = list.find(
    (r) => r.characterSlug === attrs.characterSlug && !r.variantSlug && r.label,
  )
  const characterDisplay =
    canonicalNameEntry?.label ?? ref?.label?.split(" / ")[0] ?? attrs.characterSlug
  // Legacy: variantSlug is a real character variant → show the "/variant"
  // segment. Hybrid: that slot holds a ROLE, surfaced via the badge below, so
  // the segment is suppressed (no duplicate "/clothes" + "clothes" badge).
  const variantDisplay = !isHybrid && attrs.variantSlug
    ? (ref?.variantDisplayName && ref.variantDisplayName !== "canonical"
        ? ref.variantDisplayName
        : attrs.variantSlug)
    : null

  const tooltip = [
    `@${attrs.characterSlug}:${attrs.imageIndex}`,
    isHybrid
      ? currentRole && `role: ${currentRole}`
      : attrs.variantSlug && `variant: ${attrs.variantSlug}`,
    !isHybrid && attrs.usageMode && `mode: ${attrs.usageMode}`,
    isHybrid && attrs.lock && "identity lock: on",
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
        {isHybrid
          ? currentRole && (
              <span className="character-ref-pill__mode-badge">
                {currentRole === "ref-only" ? "ref" : currentRole}
              </span>
            )
          : attrs.usageMode && (
              <span className="character-ref-pill__mode-badge">{usageModeLabel(attrs.usageMode)}</span>
            )}
        {isHybrid && attrs.lock && (
          <span className="character-ref-pill__mode-badge" title="identity lock on">lock</span>
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
          const MENU_W = 200
          // Height estimate drives the flip-above-when-cramped math. In hybrid
          // the vocabulary is the role presets (+1 for the Custom… row); in
          // legacy it's the usage-mode list — keeping the legacy estimate
          // byte-identical to before.
          const vocabCount = isHybrid
            ? rolePresets.length + 1
            : LABEL_PRESETS_LIVE.length
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
              // Test-only hook on the hybrid role menu; undefined in legacy so
              // the legacy menu DOM stays byte-identical.
              data-testid={isHybrid ? "character-ref-role-menu" : undefined}
              // Stop the document-level outside-click listener from seeing
              // clicks inside the menu (containment-checks can race with
              // re-renders during state updates).
              onMouseDown={(e) => e.stopPropagation()}
              onClick={(e) => e.stopPropagation()}
            >
              {isHybrid ? (
                <>
                  {/* "Default" row — clears BOTH role slots so the token falls
                      back to the source's default role at execution time. */}
                  <button
                    key="__default__"
                    type="button"
                    role="menuitem"
                    className={`w-full text-left px-2.5 py-1.5 text-[11px] flex items-center justify-between transition-colors ${
                      currentRole == null
                        ? "bg-violet-500/15 text-violet-700 dark:text-violet-300"
                        : "hover:bg-muted text-foreground"
                    }`}
                    onClick={(e) => {
                      e.stopPropagation()
                      clearRole()
                    }}
                  >
                    <span>Default (from character)</span>
                    {currentRole == null && <span aria-hidden>✓</span>}
                  </button>
                  <div className="my-1 border-t border-border/60" />
                  {rolePresets.map((role) => (
                    <button
                      key={role}
                      type="button"
                      role="menuitem"
                      data-role={role}
                      className={`w-full text-left px-2.5 py-1.5 text-[11px] flex items-center justify-between transition-colors ${
                        currentRole === role
                          ? "bg-violet-500/15 text-violet-700 dark:text-violet-300"
                          : "hover:bg-muted text-foreground"
                      }`}
                      onClick={(e) => {
                        e.stopPropagation()
                        setRole(role)
                      }}
                    >
                      <span>{role}</span>
                      {currentRole === role && <span aria-hidden>✓</span>}
                    </button>
                  ))}
                  <div className="my-1 border-t border-border/60" />
                  {customMode ? (
                    <div className="px-2 py-1.5 flex items-center gap-1">
                      <input
                        ref={customInputRef}
                        value={customText}
                        onChange={(e) => setCustomText(e.target.value)}
                        placeholder="earrings  or  freckles"
                        data-testid="character-ref-role-custom-input"
                        className="flex-1 min-w-0 text-[11px] px-2 py-1 rounded border border-border bg-background outline-none focus:ring-2 focus:ring-violet-400/50"
                        onClick={(e) => e.stopPropagation()}
                        onMouseDown={(e) => e.stopPropagation()}
                        onKeyDown={(e) => {
                          // Keep Enter/Escape out of the editor's keymap.
                          e.stopPropagation()
                          if (e.key === "Enter") {
                            e.preventDefault()
                            if (sanitizeRole(customText)) setRole(customText)
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
                        className="text-[11px] px-2 py-1 rounded bg-violet-500/15 text-violet-700 hover:bg-violet-500/25 dark:text-violet-300 disabled:opacity-40 disabled:cursor-not-allowed"
                        disabled={sanitizeRole(customText).length === 0}
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
                        setCustomText(isCustomRole ? (currentRole ?? "") : "")
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
                    data-testid="character-ref-lock-toggle"
                    className={`w-full text-left px-2.5 py-1.5 text-[11px] flex items-center justify-between transition-colors ${
                      attrs.lock
                        ? "bg-violet-500/15 text-violet-700 dark:text-violet-300"
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
