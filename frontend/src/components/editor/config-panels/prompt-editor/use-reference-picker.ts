"use client"

import { useCallback, useState } from "react"
import type { NodeViewProps } from "@tiptap/react"
import type { JSONContent } from "@tiptap/core"
import type { RefImageItem } from "../tag-textarea"
import type { SuggestionCommandPayload } from "./suggestion-list"
import { buildRefPillNodes, nextMentionIndex } from "./build-ref-pill-nodes"
import { roleToCharacterRefSlots } from "./character-ref-roles"
import { roleToLocationRefSlots } from "./location-ref-roles"

/** The current pill's ACTIVE role string, for same-entity carry-over. The
 *  4th-segment `role` wins, then `usageMode`; a seg3 `variantSlug` counts only
 *  when it is NOT a real variant of the same character in the wired list (then
 *  it's a role riding in the variant slot — the pre-existing 3-part encoding). */
function activeCharacterRole(
  attrs: Record<string, unknown>,
  items: readonly RefImageItem[],
): string | null {
  if (typeof attrs.role === "string" && attrs.role) return attrs.role
  if (typeof attrs.usageMode === "string" && attrs.usageMode) return attrs.usageMode
  const v = typeof attrs.variantSlug === "string" ? attrs.variantSlug : null
  if (!v) return null
  const isRealVariant = items.some(
    (i) => i.source === "character" && i.characterSlug === attrs.characterSlug && i.variantSlug === v,
  )
  return isRealVariant ? null : v
}

/**
 * Same-entity swap carries the mention's ROLE + lock onto the new pill
 * (Variant + Role Separation): picking another image of the SAME character /
 * location changes WHICH image, not WHAT to take from it. The role re-routes
 * through the slot rules for the NEW variant state (4th segment beside a
 * variant, seg3 on a canonical). A different entity gets fresh defaults.
 */
function carrySameEntityRole(
  pill: JSONContent,
  node: NodeViewProps["node"],
  item: RefImageItem,
  items: readonly RefImageItem[],
): void {
  const cur = node.attrs as Record<string, unknown>
  const attrs = (pill.attrs ?? {}) as Record<string, unknown>
  if (
    pill.type === "characterRef" && node.type.name === "characterRef"
    && item.characterSlug && cur.characterSlug === item.characterSlug
  ) {
    const role = activeCharacterRole(cur, items)
    if (role) {
      const hasVariant = !!attrs.variantSlug
      const slots = roleToCharacterRefSlots(role, { hasVariant })
      if (!hasVariant) attrs.variantSlug = slots.variantSlug ?? null
      attrs.usageMode = slots.usageMode
      attrs.role = slots.role
    }
    if (cur.lock !== undefined) attrs.lock = cur.lock
    pill.attrs = attrs
    return
  }
  if (
    pill.type === "locationRef" && node.type.name === "locationRef"
    && item.locationSlug && cur.locationSlug === item.locationSlug
  ) {
    const role = typeof cur.role === "string" && cur.role ? cur.role : null
    const mode = typeof cur.usageMode === "string" && cur.usageMode ? cur.usageMode : null
    if (role) {
      const hasVariant = !!(attrs.bucket && attrs.variant)
      const slots = roleToLocationRefSlots(role, { hasVariant })
      if (!hasVariant) {
        attrs.bucket = slots.bucket ?? null
        attrs.variant = slots.variant ?? null
      }
      attrs.usageMode = slots.usageMode
      attrs.role = slots.role
    } else if (mode) {
      attrs.usageMode = mode
    }
    if (cur.lock !== undefined) attrs.lock = cur.lock
    pill.attrs = attrs
  }
}

/**
 * Shared state + swap logic for the chip-thumbnail reference picker (issue 4).
 *
 * Reads the FULL attached-reference list from editor storage — the same
 * `RefImageItem[]` the `@` autocomplete uses, mirrored under `imageRef` storage
 * by the PromptEditor host. On `swap`, replaces THIS chip in place with the
 * chosen reference's pill (cross-type) via `buildRefPillNodes`: `getPos()` →
 * `deleteRange` → `insertContentAt`. Character/location targets get a fresh
 * unified mention index; image/video/audio use the item's positional index.
 */
export function useReferenceSwapPicker(props: NodeViewProps) {
  const [pickerAnchor, setPickerAnchor] = useState<DOMRect | null>(null)
  const storage = props.editor.storage as unknown as Record<string, { referenceImages?: readonly RefImageItem[] }>
  const items = (storage.imageRef?.referenceImages ?? []) as readonly RefImageItem[]

  const openPicker = useCallback((rect: DOMRect) => setPickerAnchor(rect), [])
  const closePicker = useCallback(() => setPickerAnchor(null), [])

  const swap = useCallback((item: RefImageItem) => {
    setPickerAnchor(null)
    if (typeof props.getPos !== "function") return
    const pos = props.getPos()
    if (pos == null) return
    const needsMention =
      (item.source === "location" && !!item.locationSlug) ||
      (item.source === "character" && !!item.characterSlug)
    const idx = needsMention ? nextMentionIndex(props.editor.getText({ blockSeparator: "\n" })) : 0
    const nodes = buildRefPillNodes(item as SuggestionCommandPayload, idx, { trailingSpace: false })
    if (nodes[0]) carrySameEntityRole(nodes[0], props.node, item, items)
    props.editor
      .chain()
      .focus()
      .deleteRange({ from: pos, to: pos + props.node.nodeSize })
      .insertContentAt(pos, nodes)
      .run()
  }, [props, items])

  return { pickerAnchor, items, openPicker, closePicker, swap }
}
