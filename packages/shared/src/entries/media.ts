/**
 * `@nodaro/shared/media` — Media-editing contracts: image overlays, masks, Lottie slots, depth, inpaint regions, audio FX presets, the FreeCut protocol.
 *
 * One of the package's subpath entries (see `src/index.ts`). The root
 * re-exports every entry, so each name here is also importable from
 * `@nodaro/shared`.
 */
export * from "../freecut-protocol.js"
export { describeMaskRegion } from "../inpaint-region.js"
export type { MaskRegionDescriptor, PixelBox } from "../inpaint-region.js"
export * from "../video-depth.js"
export {
  applySlots,
  normalizeLottieLayers,
  describeSlotControl,
  rgbaArrayToHex,
  hexToRgbaArray,
  listSlotSids,
  humanizeSlotSid,
  deriveLottieSlotFields,
  LOTTIE_SLOT_FIELD_PREFIX,
} from "../lottie-slots.js"
export type { SlotControlKind, SlotControlDescriptor, LottieSlotField } from "../lottie-slots.js"
export {
  LOTTIE_OVERLAY_CATALOG,
  LEGACY_LOTTIE_HOST_REMAP,
  resolveLottieOverlaySrc,
} from "../lottie-overlay-catalog.js"
export type { LottieOverlayCatalogEntry } from "../lottie-overlay-catalog.js"
// --- Audio FX node preset ids (single source of truth for route/UI/data type) ---
export * from "../audio-fx-presets.js"
export * from "../image-overlay-layers.js"
export * from "../video-mask.js"
export * from "../mask-composite.js"
export * from "../image-overlay-shapes.js"
export * from "../image-overlay-platforms.js"
