const CF_TRANSFORM_PREFIX = "/cdn-cgi/image/"

export function optimizedImageUrl(
  url: string,
  opts: { width?: number; quality?: number } = {},
): string {
  if (!url || !url.includes("cdn.scenenode.ai")) return url
  // Already transformed — don't double-wrap
  if (url.includes(CF_TRANSFORM_PREFIX)) return url

  const { width = 480, quality = 80 } = opts
  const params = `width=${width},format=auto,quality=${quality}`

  const parsed = new URL(url)
  return `${parsed.origin}${CF_TRANSFORM_PREFIX}${params}${parsed.pathname}`
}
