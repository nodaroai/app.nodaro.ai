import { overlayPlatformById } from "@nodaro/shared"
import type { ImageOverlayData } from "@/types/nodes"

/**
 * The ONE way a platform choice is written onto an Image Overlay node —
 * shared by the settings panel and the editor's header so the two can never
 * disagree about what "pick Instagram Story" means: the output canvas takes
 * the platform's pixel size, the base fills it (cover) unless the user chose
 * otherwise, and the existing canvas colour survives. "none" keeps the canvas
 * the user may have set by hand and only forgets the platform.
 */
export function overlayPlatformPatch(id: string | undefined, data: Pick<ImageOverlayData, "canvas" | "baseFit">): Partial<ImageOverlayData> {
  const preset = overlayPlatformById(id)
  if (!preset) return { platform: undefined }
  return {
    platform: preset.id,
    canvas: { width: preset.width, height: preset.height, backgroundColor: data.canvas?.backgroundColor ?? "#000000" },
    baseFit: data.baseFit ?? "cover",
  }
}

/**
 * Everything that decides what a run paints — layers, platform, canvas, fit,
 * exports, mask. A run stamps this onto its result so a later edit of ANY of
 * them (a moved layer, new text, another platform) marks the result stale.
 */
export type OverlayComposition = Partial<Pick<ImageOverlayData, "layers" | "platform" | "canvas" | "baseFit" | "variants" | "maskMode" | "maskSpread">>

export function overlayCompositionKey(data: OverlayComposition): string {
  return JSON.stringify([data.layers, data.platform, data.canvas, data.baseFit, data.variants, data.maskMode, data.maskSpread])
}

/**
 * Is a stored result still the picture the current settings would produce?
 * Decided from DATA, not from who ran it. A result stamped with the
 * composition that produced it (canvas runs) is fresh only while that
 * composition is unchanged; one without a stamp (server runs, older results)
 * falls back to size — the output size is the canvas (or the base's own
 * size) and a result of another size was rendered under other settings.
 * Unknown sizes count as fresh.
 */
export function overlayResultMatches(
  data: OverlayComposition,
  baseSize: { w: number; h: number } | undefined,
  result: { width?: number; height?: number; overlayComposition?: string } | undefined,
): boolean {
  if (typeof result?.overlayComposition === "string") return result.overlayComposition === overlayCompositionKey(data)
  if (!result?.width || !result.height) return true
  const expected = data.canvas && data.canvas.width > 0 && data.canvas.height > 0 ? { w: data.canvas.width, h: data.canvas.height } : baseSize
  if (!expected) return true
  return expected.w === result.width && expected.h === result.height
}
