import { useEffect, useState } from "react"
import { getAuthHeaders } from "@/lib/api"

/**
 * Scene3D delivery artifacts are PRIVATE by contract: their bytes stay in the
 * private scene bucket and the only way to them is the authenticated delivery
 * API. A browser `<img src>` cannot send a bearer token, so a shot still put
 * straight into an `<img>` renders as a broken image.
 *
 * So the bytes come down authenticated and become an object URL for exactly as
 * long as the component is mounted, then are revoked — the same shape the
 * admin held-output preview uses, and for the same reason. The revoke is not
 * housekeeping; it is the end of that object's reachability in the tab.
 */
export function isScene3DDeliveryUrl(url: string): boolean {
  try {
    return new URL(url, window.location.origin).pathname.startsWith("/v1/3d-scene/")
  } catch {
    return false
  }
}

/**
 * Displayable URLs for a list of artifact URLs, in the same order.
 *
 * A URL that is already public is passed through untouched — this hook exists
 * for the private ones, and re-fetching a public URL through JS would only
 * throw away the browser's own image cache. An entry that fails to load
 * resolves to `null` rather than a broken `<img>`, so the caller can render
 * the absence honestly.
 */
export function useAuthedMediaUrls(urls: readonly string[]): Array<string | null> {
  const key = urls.join("\n")
  const [resolved, setResolved] = useState<Array<string | null>>(
    () => urls.map((url) => (isScene3DDeliveryUrl(url) ? null : url)),
  )

  useEffect(() => {
    const list = key ? key.split("\n") : []
    const objectUrls: string[] = []
    let cancelled = false
    setResolved(list.map((url) => (isScene3DDeliveryUrl(url) ? null : url)))
    void (async () => {
      const headers = await getAuthHeaders()
      await Promise.all(list.map(async (url, index) => {
        if (!isScene3DDeliveryUrl(url)) return
        try {
          const response = await fetch(url, { headers })
          if (!response.ok) throw new Error(String(response.status))
          const objectUrl = URL.createObjectURL(await response.blob())
          if (cancelled) { URL.revokeObjectURL(objectUrl); return }
          objectUrls.push(objectUrl)
          setResolved((previous) => {
            const next = [...previous]
            next[index] = objectUrl
            return next
          })
        } catch {
          // Stays null: the caller renders the gap rather than a broken image.
        }
      }))
    })()
    return () => {
      cancelled = true
      for (const objectUrl of objectUrls) URL.revokeObjectURL(objectUrl)
    }
  }, [key])

  return resolved
}
