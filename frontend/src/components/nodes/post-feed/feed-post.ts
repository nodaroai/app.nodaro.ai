/**
 * One post as the shared post feed card draws it — the card-side view of a
 * Telegram post, a collection record or a social post. Each source has an
 * adapter that fills this in; the card never reads a source shape itself.
 */
export interface FeedPost {
  /** Unique within the list. */
  readonly key: string
  /** The picture: a photo, else a video's poster. Null shows the initial tile. */
  readonly previewUrl: string | null
  /** The first video: its file, or null when it plays only on the post's own page. */
  readonly video: { readonly url: string | null } | null
  /** Shown on a tile with no picture. */
  readonly initial: string
  /** The bold line above the text: "@channel · #3392", "@handle", a record's title. */
  readonly heading: string
  /** "ltr" for a handle or a number, "auto" for words. */
  readonly headingDir: "ltr" | "auto"
  /** A short count beside the heading ("119 views"). */
  readonly stat?: string
  /** The post's text; empty when the heading already says it all. */
  readonly text: string
  /**
   * The muted line, part by part: the date, a forwarded-from, who posted it.
   * Each part is drawn isolated, so an "@handle" keeps its "@" in front in a
   * right-to-left interface.
   */
  readonly meta: readonly string[]
  /**
   * The bold start of a row in the "all posts" list ("#3392"). A row without
   * one shows the heading above its text instead.
   */
  readonly rowLabel?: string
  /** The post's own page, http(s) only — null when there is none. */
  readonly openUrl: string | null
  /** The site that page is on ("Telegram", "Instagram", "example.com"). */
  readonly site: string
}
