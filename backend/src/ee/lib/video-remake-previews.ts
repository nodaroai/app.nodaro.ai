/**
 * Video Remake's before-and-after previews: the clips the tools pages and the
 * shell's menu show to say what Video Remake does, and their copy in each
 * platform language. Served by `GET /v1/video-remake/previews`
 * (ee/routes/video-remake-previews.ts), which judges where they are shown.
 *
 * Each preview is one short 16:9 silent clip pair, encoded alike: the source,
 * the result, a sweep (the source wiping into the result) and a stacked clip
 * (the source above the result, the same frames), all on the Nodaro CDN.
 */
import type { LocaleId } from "@nodaro/shared/i18n"

/** What a preview shows Video Remake doing. */
export type VideoRemakePreviewKind = "restyle" | "motion" | "object" | "background" | "edit"

/** One preview of the table. */
export interface VideoRemakePreviewEntry {
  /** Stable id: the key of its copy below. */
  readonly id: string
  readonly kind: VideoRemakePreviewKind
  /** The source clip (absolute https). */
  readonly sourceUrl: string
  /** The result clip (absolute https). */
  readonly resultUrl: string
  /** The source wiping into the result (absolute https). */
  readonly sweepUrl: string
  /** The source above the result, the same frames (absolute https). */
  readonly stackedUrl: string
  /** The moment of the clips the posters are cut at, in seconds. */
  readonly posterAtSeconds: number
  /** Where the preview leads on the tools site: `/video/remake`, or `/video/remake?art-style=<id>` for a restyle. */
  readonly href: string
}

/** A preview's words in one language. */
export interface VideoRemakePreviewCopy {
  readonly title: string
  readonly caption: string
}

/** The previews, in display order. */
export const VIDEO_REMAKE_PREVIEWS: readonly VideoRemakePreviewEntry[] = []

/**
 * Each preview's copy, by language, then by preview id. Every preview has
 * English; a language without a preview's copy shows it in English.
 */
export const VIDEO_REMAKE_PREVIEW_COPY: Readonly<Partial<Record<LocaleId, Readonly<Record<string, VideoRemakePreviewCopy>>>>> = {
  en: {},
}
