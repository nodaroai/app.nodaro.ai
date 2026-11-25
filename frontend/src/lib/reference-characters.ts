/**
 * Which character each reference an editor Run of Generate Image sends came
 * from, for a model that sends a character's views as one named subject
 * (Kling Image 4.0). The Run assembles its own prompt and posts flat
 * references, so without this the route could not group them and would price
 * a 4-view character as 4 items where a workflow run prices it as 1.
 *
 * Only the entries whose picture the Run sends, each once, in the order sent;
 * empty for every other model, so their request is unchanged.
 */
import { isKlingImage4 } from "@nodaro/shared/model-catalog"
import type { ConnectedReference } from "@nodaro/shared/types"

export interface ReferenceCharacter {
  readonly url: string
  readonly characterSlug: string
  readonly defaultName?: string
  readonly variantSlug?: string
  readonly bucket?: string
  readonly description?: string
  readonly characterCanonicalDescription?: string | null
}

export function referenceCharactersForRun(
  provider: string | undefined,
  refs: readonly ConnectedReference[],
  sentUrls: readonly string[] | undefined,
): ReferenceCharacter[] {
  if (!isKlingImage4(provider) || !sentUrls?.length) return []
  const sent = new Set(sentUrls)
  const out: ReferenceCharacter[] = []
  const seen = new Set<string>()
  for (const r of refs) {
    if (!r.characterSlug || !sent.has(r.url) || seen.has(r.url)) continue
    seen.add(r.url)
    out.push({
      url: r.url,
      characterSlug: r.characterSlug,
      ...(r.defaultName ? { defaultName: r.defaultName } : {}),
      ...(r.variantSlug ? { variantSlug: r.variantSlug } : {}),
      ...(r.bucket ? { bucket: r.bucket } : {}),
      ...(r.description ? { description: r.description } : {}),
      ...(r.characterCanonicalDescription !== undefined ? { characterCanonicalDescription: r.characterCanonicalDescription } : {}),
    })
  }
  return out
}
