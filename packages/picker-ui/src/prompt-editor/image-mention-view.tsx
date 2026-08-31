"use client"

import { useState, useCallback, useEffect } from "react"
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react"
import { optimizedImageUrl } from "./lib/image"
import { RefPreviewPortal } from "./ref-preview-portal"
import { findItemByImageMentionSlug } from "./lib/image-mention-refs"
import type { RefImageItem } from "./editor-types"
import type { ImageMentionAttrs } from "./image-mention-extension"

/**
 * Resolve the pill's reference from editor storage BY NAME. The positional
 * `imageRef` view indexes `list[imageIndex - 1]`; this one matches the slug,
 * because `imageIndex` here is a correlation counter, not a slot.
 *
 * Storage is read plainly on each render, exactly as `ImageRefView` does: the
 * parent dispatches a no-op `refs-changed` transaction after every reference-
 * list push, which re-renders the node views — so a renamed or re-wired
 * upstream image is picked up without subscribing to `revision` here.
 */
function useMentionedRef(props: NodeViewProps): RefImageItem | undefined {
  const attrs = props.node.attrs as ImageMentionAttrs
  const storage = props.editor.storage as unknown as Record<
    string,
    { referenceImages?: readonly RefImageItem[] }
  >
  const list = storage.imageMention?.referenceImages ?? []
  return findItemByImageMentionSlug(list, attrs.imageSlug)
}

/**
 * NAME-addressed media mention pill — thumbnail + the reference's display name,
 * with the correlation index and any role segment shown alongside.
 *
 * A pill whose slug is no longer wired renders BROKEN (dashed outline, no
 * thumbnail) rather than disappearing: the token is still in the prompt text,
 * so hiding the mismatch would be a lie. Matches the character pill's
 * broken-state convention.
 */
export function ImageMentionView(props: NodeViewProps) {
  const attrs = props.node.attrs as ImageMentionAttrs
  const ref = useMentionedRef(props)
  const [hoverAnchor, setHoverAnchor] = useState<DOMRect | null>(null)

  // Clean up a stuck preview when the node unmounts (deletion, etc.).
  useEffect(() => () => setHoverAnchor(null), [])

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

  const displayName = ref?.label || attrs.imageSlug
  const broken = !ref
  const token = `@${attrs.imageSlug}:${attrs.imageIndex}${attrs.role ? `:${attrs.role}` : ""}`

  return (
    <NodeViewWrapper
      as="span"
      className={
        `image-mention-pill${props.selected ? " image-mention-pill--selected" : ""}`
        + (broken ? " image-mention-pill--broken" : "")
      }
      data-image-slug={attrs.imageSlug}
      data-image-index={attrs.imageIndex}
      data-broken={broken ? "" : undefined}
      title={broken ? `${token} — no wired reference named "${attrs.imageSlug}"` : `${displayName} (${token})`}
    >
      {ref?.url ? (
        <img
          src={optimizedImageUrl(ref.url, { width: 48, quality: 80 })}
          alt=""
          className="image-mention-pill__thumb"
          draggable={false}
          onMouseEnter={(e) => setHoverAnchor(e.currentTarget.getBoundingClientRect())}
          onMouseLeave={() => setHoverAnchor(null)}
        />
      ) : (
        <span className="image-mention-pill__thumb-broken" aria-hidden>!</span>
      )}
      <span className="image-mention-pill__label" contentEditable={false}>
        <span className="image-mention-pill__name">@{displayName}</span>
        <span className="image-mention-pill__index">:{attrs.imageIndex}</span>
        {attrs.role && <span className="image-mention-pill__role">:{attrs.role}</span>}
      </span>
      <button
        type="button"
        aria-label="Remove image mention"
        className="image-mention-pill__remove"
        onMouseDown={(e) => {
          e.preventDefault()
          handleRemove()
        }}
      >
        ×
      </button>
      <RefPreviewPortal url={ref?.url} anchor={hoverAnchor} />
    </NodeViewWrapper>
  )
}
