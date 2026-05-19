"use client"

import { useCallback, useMemo } from "react"
import { NodeViewWrapper, type NodeViewProps } from "@tiptap/react"
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

export function LocationRefView(props: NodeViewProps) {
  const attrs = props.node.attrs as LocationRefAttrs

  const storage = props.editor.storage as unknown as Record<string, {
    referenceImages?: readonly RefEntry[]
    revision?: number
  }>
  const list = storage.locationRef?.referenceImages ?? []
  const ref = useMemo(() => resolveRef(list, attrs), [list, attrs])
  const isBroken = !ref?.url

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
        />
      ) : (
        <span className="location-ref-pill__thumb-broken" aria-hidden>?</span>
      )}
      <span className="location-ref-pill__label" contentEditable={false}>
        <span className="location-ref-pill__name">@{locationDisplay}</span>
        <span className="location-ref-pill__index">:{attrs.imageIndex}</span>
        {variantDisplay && (
          <span className="location-ref-pill__variant">/{variantDisplay}</span>
        )}
        {attrs.usageMode && (
          <span className="location-ref-pill__mode-badge">{attrs.usageMode}</span>
        )}
      </span>
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
    </NodeViewWrapper>
  )
}
