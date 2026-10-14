/**
 * The names the caption styles go by — one table for every panel that offers
 * them (Add Captions, and Tighten Episode's caption style), so a style is
 * never named two ways.
 */
import type { CaptionStyle } from "@nodaro/shared/captions"
import type { MessageKey } from "@/lib/i18n"

export const CAPTION_STYLE_LABEL_KEYS: Readonly<Record<CaptionStyle, MessageKey>> = {
  subtitle: "proccfg.subtitleStatic",
  "word-highlight": "proccfg.wordHighlightKinetic",
  karaoke: "proccfg.karaokeKinetic",
  "tiktok-words": "proccfg.tiktokWordsKinetic",
  "word-pop": "proccfg.wordPopKinetic",
  bouncy: "proccfg.bouncyKinetic",
}
