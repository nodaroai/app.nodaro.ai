/**
 * The pictures a person attached to an image node by hand, read exactly as the
 * workflow run and the editor's Run have always read them: each entry of
 * `referenceImageUrls` as an `{ id, url }` upload (the editor's shape), and the
 * older single `referenceImageUrl` only when that list has no entry. One
 * reader, so the runs and every estimate start from the same pictures. An
 * entry in another shape (a plain string written by an older client) keeps
 * what the runs always made of it: an entry without an id or url.
 */
export interface ManualReferenceImage {
  readonly id: string | undefined
  readonly url: string | undefined
}

export function manualReferenceImages(data: unknown): ManualReferenceImage[] {
  const d = (data ?? {}) as { readonly referenceImageUrls?: unknown; readonly referenceImageUrl?: unknown }
  const list = Array.isArray(d.referenceImageUrls) ? (d.referenceImageUrls as unknown[]) : []
  const out: ManualReferenceImage[] = list.map((entry) => {
    const e = (entry ?? {}) as { id?: unknown; url?: unknown }
    return {
      id: typeof e.id === "string" ? e.id : undefined,
      url: typeof e.url === "string" ? e.url : undefined,
    }
  })
  const legacy = d.referenceImageUrl
  if (out.length === 0 && typeof legacy === "string" && legacy.length > 0) out.push({ id: "__legacy__", url: legacy })
  return out
}
