/**
 * Caption styles for the add-captions node. Static path uses FFmpeg drawtext;
 * kinetic styles render via Remotion (BurnCaptions composition).
 *
 * Single source of truth — imported by:
 *   - backend route Zod (add-captions.ts)
 *   - backend worker handler (ffmpeg.ts)
 *   - backend MCP tool (verbs-video.ts)
 *   - backend plan schema (plan-schemas.ts)
 *   - frontend node config + cost helper
 *   - packages/remotion overlay dispatcher
 */
export const STATIC_CAPTION_STYLES = ["subtitle"] as const
export const KINETIC_CAPTION_STYLES = [
  "word-highlight",
  "karaoke",
  "tiktok-words",
  "word-pop",
  "bouncy",
] as const
export const ALL_CAPTION_STYLES = [...STATIC_CAPTION_STYLES, ...KINETIC_CAPTION_STYLES] as const

export type StaticCaptionStyle = (typeof STATIC_CAPTION_STYLES)[number]
export type KineticCaptionStyle = (typeof KINETIC_CAPTION_STYLES)[number]
export type CaptionStyle = (typeof ALL_CAPTION_STYLES)[number]

const KINETIC_SET = new Set<string>(KINETIC_CAPTION_STYLES)

export function isKineticCaptionStyle(style: string | undefined | null): style is KineticCaptionStyle {
  return style !== null && style !== undefined && KINETIC_SET.has(style)
}
