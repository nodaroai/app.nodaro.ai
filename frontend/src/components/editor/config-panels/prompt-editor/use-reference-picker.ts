"use client"

import { useCallback, useState } from "react"
import type { NodeViewProps } from "@tiptap/react"
import type { RefImageItem } from "../tag-textarea"
import type { SuggestionCommandPayload } from "./suggestion-list"
import { buildRefPillNodes, nextMentionIndex } from "./build-ref-pill-nodes"

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
    props.editor
      .chain()
      .focus()
      .deleteRange({ from: pos, to: pos + props.node.nodeSize })
      .insertContentAt(pos, buildRefPillNodes(item as SuggestionCommandPayload, idx, { trailingSpace: false }))
      .run()
  }, [props])

  return { pickerAnchor, items, openPicker, closePicker, swap }
}
