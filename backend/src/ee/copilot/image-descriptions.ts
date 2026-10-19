/**
 * An image's description, for a turn on KIE — whose model cannot see an image
 * while the request carries tools. The description is stored ON the image's
 * own block in the persisted message (`nodaro_description`), so the image and
 * what was said about it stay one thing, and the image block stays for a turn
 * that runs on Anthropic again.
 *
 * Never a text block: user-row text is read as links the user pasted
 * (`extractUserLinks`), and a description must never become one. Never sent to
 * Anthropic either, which rejects an unknown block field (`withoutDescriptions`).
 */
import type Anthropic from "@anthropic-ai/sdk"

export const IMAGE_DESCRIPTION_KEY = "nodaro_description" as const

export type DescribedImageBlock = Anthropic.Messages.ImageBlockParam & { [IMAGE_DESCRIPTION_KEY]?: string }

export function isImageBlock(block: unknown): block is DescribedImageBlock {
  return typeof block === "object" && block !== null && (block as { type?: unknown }).type === "image"
}

/** The image's URL — undefined for an inline (base64) image, which is never described from storage. */
export function imageUrlOf(block: DescribedImageBlock): string | undefined {
  const source = block.source as { type?: string; url?: unknown }
  return source?.type === "url" && typeof source.url === "string" ? source.url : undefined
}

export function descriptionOf(block: DescribedImageBlock): string | undefined {
  const description = block[IMAGE_DESCRIPTION_KEY]
  return typeof description === "string" && description.trim() !== "" ? description : undefined
}

/** The URLs of `content`'s images that have no description yet, in order. */
export function undescribedImageUrls(content: readonly unknown[]): string[] {
  const urls: string[] = []
  for (const block of content) {
    if (!isImageBlock(block) || descriptionOf(block) !== undefined) continue
    const url = imageUrlOf(block)
    if (url !== undefined) urls.push(url)
  }
  return urls
}

/**
 * `content` with each undescribed image whose URL `descriptions` names
 * carrying that description. A new array — the input is untouched — and
 * `changed` says whether any image got one.
 */
export function applyDescriptions(
  content: readonly unknown[],
  descriptions: ReadonlyMap<string, string>,
): { content: unknown[]; changed: boolean } {
  let changed = false
  const out = content.map((block) => {
    if (!isImageBlock(block) || descriptionOf(block) !== undefined) return block
    const url = imageUrlOf(block)
    const description = url === undefined ? undefined : descriptions.get(url)
    if (description === undefined) return block
    changed = true
    return { ...block, [IMAGE_DESCRIPTION_KEY]: description }
  })
  return { content: out, changed }
}

/**
 * For KIE's model: each image block becomes `[Image N — description: …]`, or
 * `[Image N — could not be read]` when it has none. N counts the images of
 * this one message, in order.
 */
export function imagesAsText(content: readonly Anthropic.Messages.ContentBlockParam[]): Anthropic.Messages.ContentBlockParam[] {
  let n = 0
  return content.map((block): Anthropic.Messages.ContentBlockParam => {
    if (!isImageBlock(block)) return block
    n += 1
    const description = descriptionOf(block)
    return {
      type: "text",
      text: description ? `[Image ${n} — description: ${description}]` : `[Image ${n} — could not be read]`,
    }
  })
}

/** For Anthropic: the stored description removed from every image block. Never mutates its input. */
export function withoutDescriptions(content: readonly Anthropic.Messages.ContentBlockParam[]): Anthropic.Messages.ContentBlockParam[] {
  return content.map((block) => {
    if (!isImageBlock(block) || !(IMAGE_DESCRIPTION_KEY in block)) return block
    const copy: Record<string, unknown> = { ...block }
    delete copy[IMAGE_DESCRIPTION_KEY]
    return copy as unknown as Anthropic.Messages.ContentBlockParam
  })
}
