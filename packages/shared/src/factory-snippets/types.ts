/** Which prompt field a snippet belongs to. Negative-target snippets only
 *  surface in negative-prompt fields, and are bare comma lists by convention
 *  (per Google's Veo guidance, a negative FIELD must name the unwanted thing,
 *  never "no X"). */
export type SnippetTarget = "prompt" | "negative"

/** Node modality a snippet applies to. A node declares its modality once in
 *  the frontend's NODE_PROMPT_FIELDS; the menu shows snippets whose `media`
 *  contains it. */
export type SnippetMedia = "image" | "video" | "audio" | "text"

export const SNIPPET_MEDIA_VALUES: readonly SnippetMedia[] = [
  "image",
  "video",
  "audio",
  "text",
]

export interface FactorySnippet {
  /** Stable kebab slug, e.g. "identity-lock". Unique across the catalog. */
  readonly id: string
  readonly name: string
  /** One-liner shown in the menu and matched by search. */
  readonly description?: string
  /** The exact fragment inserted into the prompt. Single line; never contains
   *  `{`, `}`, or `@` (guard-tested) so it can never form a mention/variable
   *  token in the editor. */
  readonly text: string
  readonly target: SnippetTarget
  readonly media: readonly SnippetMedia[]
  /** Menu group AND the pill-swap sibling pool (swap lists same-category). */
  readonly category: string
}
