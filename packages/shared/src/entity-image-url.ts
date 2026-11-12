/**
 * The image an entity node (character / face / object / creature / location)
 * gives out: the asset the user starred as its default, else its active
 * generated result, else its source image — the image its card shows. It is
 * the node's output on both run paths, and it is a wired Character's portrait
 * (its identity reference, a Kling subject's first image), so the character
 * and its output are one image and one image goes out. `||`, so an empty
 * string falls through.
 */
export function entityImageUrl(data: unknown): string | undefined {
  const d = (data ?? {}) as {
    readonly defaultAssetUrl?: unknown
    readonly generatedResults?: unknown
    readonly activeResultIndex?: unknown
    readonly sourceImageUrl?: unknown
  }
  const str = (v: unknown): string | undefined => (typeof v === "string" && v ? v : undefined)
  const results = Array.isArray(d.generatedResults) ? (d.generatedResults as ReadonlyArray<{ readonly url?: unknown } | null | undefined>) : []
  const active = typeof d.activeResultIndex === "number" ? d.activeResultIndex : 0
  return str(d.defaultAssetUrl) || str(results[active]?.url) || str(d.sourceImageUrl)
}
