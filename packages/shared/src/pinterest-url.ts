/**
 * Auto-upgrade Pinterest CDN URLs to their highest-resolution variant.
 *
 * `i.pinimg.com` serves the same image at multiple sizes via a path-prefix
 * segment: `/236x/`, `/474x/`, `/564x/`, `/736x/`, `/1200x/`, `/originals/`.
 * The `originals` segment returns the source resolution — much better input
 * for `describe-image`, `image-to-image`, `face-swap`, etc.
 *
 * Returns the input unchanged when:
 *   - the URL doesn't parse as a URL
 *   - the host isn't `i.pinimg.com`
 *   - the path doesn't start with a recognized size segment
 *
 * Used by the upload-image node when a user pastes a Pinterest URL, and by
 * any backend describe-image-style fetch that wants the highest-res input.
 */
export function normalizePinterestUrl(url: string): string {
  try {
    const u = new URL(url)
    if (u.hostname !== "i.pinimg.com") return url
    const next = u.pathname.replace(/^\/(?:\d+x|originals)\//, "/originals/")
    if (next === u.pathname) return url
    u.pathname = next
    return u.toString()
  } catch {
    return url
  }
}
