/**
 * Kling Image 4.0 is priced, and limited, by INPUT ITEMS: a reference image,
 * a base image, or a named subject (a character sent with 2 to 4 of its
 * images) is one item; a character's views beyond 4 go as plain references,
 * and an image sent twice is sent once. The route counts what a run sends with
 * {@link klingImage4ItemsFromSubjects}; every estimate (the editor's badge,
 * the server's workflow estimate) counts what a node WILL send with the same
 * function, through {@link klingImage4EstimatedItems}.
 */
import {
  GPT_IMAGE_2_6_MOODBOARD_MAX_IMAGES,
} from "./gpt-image-2-6.js"
import { KLING_IMAGE_4_SUBJECT_MAX_VIEWS, KLING_IMAGE_4_SUBJECT_MIN_VIEWS, isKlingImage4I2i } from "./kling-image-4.js"
import { referenceModalityForHandle } from "./node-refs.js"
import { wiredCharacterNamesOf, wiredCharacterSlug } from "./wired-character-names.js"
import { resolveEffectiveSourceType } from "./entity-image-handle.js"
import { entityImageUrl } from "./entity-image-url.js"
import { characterMentionableAssetArrays } from "./character-variant-assets.js"
import { characterMentionSlug, findCharacterMentionTokens } from "./character-mention-slug.js"
import { manualReferenceImages } from "./manual-reference-images.js"

/**
 * The items `sentImages` distinct images make when the given groups of them
 * are each one character's views: a group of 2 or more is one subject of at
 * most 4 views (one item), its further views plain references.
 */
export function klingImage4ItemsFromSubjects(sentImages: number, subjectViews: readonly number[]): number {
  let saved = 0
  for (const views of subjectViews) {
    if (views >= KLING_IMAGE_4_SUBJECT_MIN_VIEWS) saved += Math.min(views, KLING_IMAGE_4_SUBJECT_MAX_VIEWS) - 1
  }
  return sentImages - saved
}

export interface ImageInputGraphNode {
  readonly id: string
  readonly type?: string | null
  readonly data?: unknown
}

export interface ImageInputGraphEdge {
  readonly source: string
  readonly target: string
  readonly sourceHandle?: string | null
  readonly targetHandle?: string | null
}

function namesMoodboard(direction: unknown): boolean {
  if (direction === null || typeof direction !== "object") return false
  const style = (direction as Record<string, unknown>).style
  return (Array.isArray(style) ? style : [style]).some(
    (value) => typeof value === "string" && value.startsWith("moodboard:"),
  )
}

/**
 * The node's own prompt when the editor knows the text the run will read:
 * typed on the node, with no prompt wired in and no `{Label}` filled at run
 * time. Undefined when it cannot know it.
 */
function knownPrompt(data: Record<string, unknown>, nodeId: string, edges: readonly ImageInputGraphEdge[]): string | undefined {
  if (typeof data.prompt !== "string") return undefined
  // The text the run reads: the prompt with its pre and post text.
  const text = [data.promptPrefix, data.prompt, data.promptSuffix].filter((t): t is string => typeof t === "string").join("\n")
  if (/\{[^}]+\}/.test(text)) return undefined
  // A prompt wired in, or settings that may set it (field mappings), is read only at run time.
  const wired = edges.some((e) => e.target === nodeId && (e.targetHandle === "prompt" || e.targetHandle === "text" || e.targetHandle === "settings"))
  return wired ? undefined : text
}

/**
 * The input items a Kling Image 4.0 node will send, for an estimate: every
 * image its data lists and every wire brings, each counted once (a repeat by
 * its url, a source wired twice by its output), and each character's images
 * grouped into its named subject, as the run groups them.
 *
 * A wired Character sends what its run attaches: the views its `@` mentions
 * name in the prompt (its portrait for a plain `@name:N`), or its portrait
 * alone when the prompt names none of them. When the editor cannot know the
 * prompt the run reads (wired in, or filled at run time), it counts every view
 * the character could send: an estimate may quote above the run, never below.
 */
export function klingImage4EstimatedItems(
  model: string,
  data: Record<string, unknown>,
  nodeId: string,
  nodes: readonly ImageInputGraphNode[],
  edges: readonly ImageInputGraphEdge[],
): number {
  // Each distinct image (by key) and the character it belongs to, if any.
  const images = new Map<string, string | undefined>()
  const add = (key: string, subject?: string) => {
    if (!images.has(key)) images.set(key, subject)
  }
  const byId = new Map(nodes.map((n) => [n.id, n] as const))
  const names = wiredCharacterNamesOf(nodeId, nodes, edges)
  const prompt = knownPrompt(data, nodeId, edges)
  const slugs = [...names.values()].map((n) => n.slug).filter((s): s is string => !!s)
  const tokens = prompt !== undefined ? findCharacterMentionTokens(prompt, slugs) : undefined
  let imageWires = 0
  for (const e of edges) {
    if (e.target !== nodeId) continue
    const handle = e.targetHandle ?? ""
    const isRef = referenceModalityForHandle(handle) === "image"
    if (handle === "image") {
      imageWires += 1
      // The first `image` wire is the source, which an edit counts itself.
      if (imageWires === 1) continue
    } else if (!isRef && handle !== "assets") continue
    const plain = `wire:${e.source}:${e.sourceHandle ?? ""}`
    const n = byId.get(e.source)
    if (handle === "assets" && n && resolveEffectiveSourceType(n.type ?? undefined, e.sourceHandle) === "character") {
      const slug = wiredCharacterSlug(names, n.id, n.data)
      // The run groups a character's images by its slug only: one with no
      // slug sends each of its images as a plain reference, an item each.
      const subject = slug ? `slug:${slug}` : undefined
      const portrait = entityImageUrl(n.data)
      const portraitKey = portrait ? `url:${portrait}` : plain
      const views = new Map<string, string>()
      for (const items of Object.values(characterMentionableAssetArrays(n.data as Record<string, unknown>))) {
        for (const item of items) {
          const variant = item.url ? characterMentionSlug(item.name) : ""
          if (variant && !views.has(variant)) views.set(variant, `url:${item.url}`)
        }
      }
      const mine = tokens?.filter((t) => t.characterSlug === slug)
      if (mine === undefined) {
        // The prompt is not known: every view it could send.
        add(portraitKey, subject)
        for (const key of views.values()) add(key, subject)
      } else if (mine.length === 0) {
        // Named nowhere: the run attaches the portrait alone.
        add(portraitKey, subject)
      } else {
        for (const t of mine) {
          const key = t.variantSlug ? views.get(t.variantSlug) : portraitKey
          if (key) add(key, subject)
        }
      }
      continue
    }
    add(plain)
  }
  const urls = (v: unknown): string[] => (Array.isArray(v) ? v.filter((u): u is string => typeof u === "string" && u.length > 0) : [])
  const one = (v: unknown): string[] => (typeof v === "string" && v.length > 0 ? [v] : [])
  // The pictures attached by hand, read as the run reads them (`{ id, url }`
  // entries, or the older single `referenceImageUrl`); a list of plain strings
  // (written by an older client) is counted too, so the estimate is never low.
  const manual = manualReferenceImages(data).map((r) => r.url).filter((u): u is string => typeof u === "string" && u.length > 0)
  for (const url of [...manual, ...urls(data.referenceImageUrls), ...one(data.baseImageUrl), ...one(data.sourceImageUrl)]) {
    add(`url:${url}`)
  }
  if (Array.isArray(data.extraRefs)) {
    for (const r of data.extraRefs as unknown[]) {
      if (!r || typeof r !== "object") continue
      const { url, characterSlug } = r as { url?: unknown; characterSlug?: unknown }
      if (typeof url !== "string" || !url) continue
      add(`url:${url}`, typeof characterSlug === "string" && characterSlug ? `slug:${characterSlug}` : undefined)
    }
  }
  if (Array.isArray(data.characterDefinitionIds)) {
    for (const id of data.characterDefinitionIds as unknown[]) add(`definition:${String(id)}`)
  }
  const groups = new Map<string, number>()
  for (const subject of images.values()) if (subject) groups.set(subject, (groups.get(subject) ?? 0) + 1)
  // An edit's source: its own (`sourceImageUrl` / `baseImageUrl`, counted
  // above with every other image) or, when it has none, its first `image`
  // wire, skipped above and counted here once.
  const ownSource = typeof data.sourceImageUrl === "string" && data.sourceImageUrl.length > 0
    || typeof data.baseImageUrl === "string" && data.baseImageUrl.length > 0
  const others = (namesMoodboard(data.direction) ? GPT_IMAGE_2_6_MOODBOARD_MAX_IMAGES : 0) + (isKlingImage4I2i(model) && !ownSource ? 1 : 0)
  return klingImage4ItemsFromSubjects(images.size, [...groups.values()]) + others
}
