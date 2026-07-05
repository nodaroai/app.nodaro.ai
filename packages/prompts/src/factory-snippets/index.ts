import { FACTORY_SNIPPETS } from "./catalog.js"
import type { SnippetMedia, SnippetTarget, FactorySnippet } from "./types.js"

export type { SnippetTarget, SnippetMedia, FactorySnippet } from "./types.js"
export { SNIPPET_MEDIA_VALUES } from "./types.js"
export { FACTORY_SNIPPETS } from "./catalog.js"

/** Factory snippets for one field: target match + media membership. */
export function getFactorySnippets(
  target: SnippetTarget,
  media: SnippetMedia,
): readonly FactorySnippet[] {
  return FACTORY_SNIPPETS.filter(
    (s) => s.target === target && s.media.includes(media),
  )
}
