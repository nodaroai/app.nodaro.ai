/**
 * Typed-handle accept predicates for the "steal the format" nodes — Content
 * Recipe and Content Ideas. One predicate per input handle, shared by the
 * node's own `HandleWithPopover accepts`, the drag-to-connect validator
 * (`connection-validation.ts`) and the source-direction popover registry
 * (`target-handle-registry.ts`), so the three can never disagree.
 */

import { DATA_TEXT_PRODUCER_TYPES, JSON_PRODUCER_TYPES, LIST_PRODUCER_TYPES } from "./data-handles"

/** Content Recipe `in` — the material a recipe reads: any producer of text or
 *  structured data (a Video Analysis, a scraper's posts, a caption, a
 *  transcript). Both engines route all of them into the node's material. */
export const ACCEPTS_CONTENT_MATERIAL = (sourceType: string): boolean =>
  DATA_TEXT_PRODUCER_TYPES.has(sourceType) || JSON_PRODUCER_TYPES.has(sourceType) || LIST_PRODUCER_TYPES.has(sourceType)

/** Content Recipe `link` — the post's own address: a Video URL node (the
 *  resolvers read its PAGE link, never its downloaded file) or any text. */
export const ACCEPTS_POST_LINK = (sourceType: string): boolean =>
  sourceType === "youtube-video" || DATA_TEXT_PRODUCER_TYPES.has(sourceType)

/** Content Ideas `recipes` — a Content Recipe (either output), or any text
 *  producer carrying a recipe someone wrote or edited. */
export const ACCEPTS_RECIPE = (sourceType: string): boolean =>
  sourceType === "content-recipe" || DATA_TEXT_PRODUCER_TYPES.has(sourceType)

/** Content Ideas `field-brand` — the brand profile as text. */
export const ACCEPTS_BRAND_TEXT = (sourceType: string): boolean => DATA_TEXT_PRODUCER_TYPES.has(sourceType)

export const CONTENT_RECIPE_INPUT_HANDLES = ["in", "link"] as const
export const CONTENT_IDEAS_INPUT_HANDLES = ["recipes", "field-brand"] as const

/** The drag-to-connect rule for both nodes' inputs. An unknown handle is
 *  refused rather than guessed. */
export function isValidContentConnection(targetType: string, targetHandle: string, sourceType: string): boolean {
  if (targetType === "content-recipe") {
    if (targetHandle === "in") return ACCEPTS_CONTENT_MATERIAL(sourceType)
    if (targetHandle === "link") return ACCEPTS_POST_LINK(sourceType)
    return false
  }
  if (targetType === "content-ideas") {
    if (targetHandle === "recipes") return ACCEPTS_RECIPE(sourceType)
    if (targetHandle === "field-brand") return ACCEPTS_BRAND_TEXT(sourceType)
    return false
  }
  return false
}
