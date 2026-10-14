/**
 * `@nodaro/shared/captions` — Caption styles, caption plans and segment schemas, supported fonts.
 *
 * One of the package's subpath entries (see `src/index.ts`). The root
 * re-exports every entry, so each name here is also importable from
 * `@nodaro/shared`.
 */
export {
  STATIC_CAPTION_STYLES,
  KINETIC_CAPTION_STYLES,
  ALL_CAPTION_STYLES,
  isKineticCaptionStyle,
  CAPTION_LOOK_IDS,
  CAPTION_LOOKS,
  DEFAULT_CAPTION_LOOK,
  DEFAULT_SUBTITLE_LOOK,
  KINETIC_ONLY_CAPTION_LEVER_KEYS,
  captionRoutesToRemotion,
  CAPTION_MAX_WORDS_PER_LINE_MIN,
  CAPTION_MAX_WORDS_PER_LINE_MAX,
  CAPTION_LEVER_BOUNDS,
  normalizeCaptionNumericLevers,
  autoStrokeWidth,
  resolveCaptionLook,
  resolveCaptionLevers,
} from "../caption-styles.js"
export type { StaticCaptionStyle, KineticCaptionStyle, CaptionStyle, CaptionLookId, CaptionLookLevers, KineticOnlyCaptionLeverKey } from "../caption-styles.js"
export type { CaptionPlan, CaptionWordTiming } from "../caption-plan.js"
export { parseCaptionPlan } from "../caption-plan.js"
export * from "../caption-segment-schema.js"
export * from "../caption-edge-dash.js"
export * from "../add-captions-plan.js"
// --- Remotion renderer: supported font names (shared with backend Zod validation) ---
export * from "../supported-fonts.js"
