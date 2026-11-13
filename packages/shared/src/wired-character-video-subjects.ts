import { hasFeature } from "./model-catalog.js"
import { characterMentionSlug } from "./character-mention-slug.js"
import { characterMentionableAssetArrays } from "./character-variant-assets.js"
import { entityImageUrl } from "./entity-image-url.js"
import { videoCharacterRefCap, videoCharacterVideoCap } from "./video-character-refs.js"
import { wiredCharacterNamesOf, wiredCharacterVideoUrls } from "./wired-character-names.js"

type GraphNode = { readonly id: string; readonly type?: string | null; readonly data?: unknown }
type GraphEdge = { readonly source: string; readonly target: string; readonly sourceHandle?: string | null }

/**
 * Whether a Character node gives its wired character a reference image: its
 * portrait (`entityImageUrl`), or any named image of its mentionable asset
 * buckets. The rule a run's character expansion follows (`expandWiredCharacterRefs`
 * in the workflow payload builder, its editor twin): a node with none yields
 * no reference, so `characterReferencesFromWired` makes no character of it.
 */
function characterGivesAnImage(data: unknown): boolean {
  if (entityImageUrl(data)) return true
  const arrays = characterMentionableAssetArrays((data ?? {}) as Record<string, unknown>)
  return Object.values(arrays).some((items) => items.some((item) => !!item?.url && !!characterMentionSlug(item.name ?? "")))
}

/**
 * The clips a Generate Video run on `provider` sends as its characters' video
 * subjects (decided 2026-11-13), in the order the run seats them — read off the
 * graph without building the run, for an estimate that must price exactly what
 * the run sends:
 *
 * - none on a model that takes no video subjects (or no named subjects at all);
 * - the characters as the run groups them (`characterReferencesFromWired`): one
 *   per wired character by the slug it goes by, in wire order of its first node
 *   that gives an image — a node with no image at all makes no character, so
 *   its clip is not sent;
 * - only the first `videoCharacterRefCap(provider)` characters (the run's slice);
 * - each character's clip as `wiredCharacterVideoUrls` gives it (its first
 *   node's, in wire order).
 *
 * The workflow run itself builds the same list through
 * `characterReferencesFromWired(expandWiredCharacterRefs(…), clips).slice(…)`;
 * a parity test holds the two together. Only Generate Video carries video
 * subjects — the older Image to Video / Text to Video nodes never do.
 */
export function wiredCharacterSubjectClips(
  consumerId: string,
  nodes: ReadonlyArray<GraphNode>,
  edges: ReadonlyArray<GraphEdge>,
  provider: string,
): string[] {
  if (videoCharacterVideoCap(provider) === 0 || !hasFeature(provider, "character-subjects")) return []
  const clips = wiredCharacterVideoUrls(consumerId, nodes, edges)
  if (clips.size === 0) return []
  const byId = new Map(nodes.map((n) => [n.id, n] as const))
  const subjects: string[] = []
  for (const [id, named] of wiredCharacterNamesOf(consumerId, nodes, edges)) {
    if (subjects.includes(named.slug)) continue
    if (characterGivesAnImage(byId.get(id)?.data)) subjects.push(named.slug)
  }
  return subjects.slice(0, videoCharacterRefCap(provider)).flatMap((slug) => {
    const clip = clips.get(slug)
    return clip ? [clip] : []
  })
}
