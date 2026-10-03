"use client"

import { createContext, useContext, useMemo, type ReactNode } from "react"
import { useHasLookPreviews } from "./registry"

/**
 * How a look option is pictured: the rendered preview from the CDN ("real" —
 * a photo, or a clip for camera motion) or the drawn illustration every picker
 * shipped with before the renders existed.
 *
 * Saved per node as `data.previewStyle`; absent means "real", so a workflow
 * saved before the choice existed looks exactly as it did.
 */
export type LookPreviewStyle = "real" | "illustration"

/** The node-data field the choice is saved under. */
export const LOOK_PREVIEW_STYLE_FIELD = "previewStyle"

/**
 * Pickers with BOTH a rendered set and a drawn illustration — the only ones
 * where the choice means anything. Every key of LOOK_PREVIEW_SETS must be in
 * exactly one of these two sets (guarded by a test), so a new rendered set
 * cannot ship without someone deciding whether it can switch.
 */
export const ILLUSTRATED_LOOK_PICKERS: ReadonlySet<string> = new Set([
  "camera-motion",
  "color-look",
  "style",
  "lens",
  "lighting",
  "atmosphere",
  "camera-format",
  "framing",
  "mood",
])

/** Rendered sets with no drawing to fall back to — always shown real. */
export const RENDER_ONLY_LOOK_PICKERS: ReadonlySet<string> = new Set(["era", "composition-effects"])

/** Reads a node's saved choice; anything but "illustration" is "real". */
export function readLookPreviewStyle(data: Readonly<Record<string, unknown>> | undefined): LookPreviewStyle {
  return data?.[LOOK_PREVIEW_STYLE_FIELD] === "illustration" ? "illustration" : "real"
}

interface LookPreviewStyleContextValue {
  readonly style: LookPreviewStyle
  /** Present only where the user may change the choice (editor node + config panel). */
  readonly onChange?: (style: LookPreviewStyle) => void
}

const LookPreviewStyleContext = createContext<LookPreviewStyleContextValue>({ style: "real" })

/**
 * Scopes every LookArt below it to one node's choice. The canvas node, the
 * config panel, the published-app card and the connected-sources list each
 * wrap their pictures in the node they picture, so one saved value drives
 * them all. Without a provider everything shows real.
 */
export function LookPreviewStyleProvider({
  style,
  onChange,
  children,
}: {
  readonly style: LookPreviewStyle
  readonly onChange?: (style: LookPreviewStyle) => void
  readonly children: ReactNode
}) {
  const value = useMemo(() => ({ style, onChange }), [style, onChange])
  return <LookPreviewStyleContext.Provider value={value}>{children}</LookPreviewStyleContext.Provider>
}

/** The scoped choice and, where editable, its setter. */
export function useLookPreviewStyle(): LookPreviewStyleContextValue {
  return useContext(LookPreviewStyleContext)
}

/**
 * The style one picker actually shows: "illustration" only where that picker
 * has a drawing to show, so a render-only picker (Era) under an illustration
 * scope keeps its render.
 */
export function useEffectiveLookPreviewStyle(pickerKey: string): LookPreviewStyle {
  const { style } = useLookPreviewStyle()
  return style === "illustration" && ILLUSTRATED_LOOK_PICKERS.has(pickerKey) ? "illustration" : "real"
}

/**
 * Whether this picker is showing rendered previews right now — registered in
 * this edition AND not switched to illustrations. Layout that differs between
 * a render and a drawing (tile size, the mood emoji beside the label) reads
 * this, never registration alone.
 */
export function useShowsLookRenders(pickerKey: string): boolean {
  const registered = useHasLookPreviews(pickerKey)
  const style = useEffectiveLookPreviewStyle(pickerKey)
  return registered && style === "real"
}

/**
 * Whether the real/illustration switch should be offered for this picker: it
 * has a drawing, this edition registered renders for it (never true on a
 * self-hosted install), and the scope is editable.
 */
export function useCanSwitchLookPreviewStyle(pickerKey: string): boolean {
  const registered = useHasLookPreviews(pickerKey)
  const { onChange } = useLookPreviewStyle()
  return registered && onChange !== undefined && ILLUSTRATED_LOOK_PICKERS.has(pickerKey)
}
