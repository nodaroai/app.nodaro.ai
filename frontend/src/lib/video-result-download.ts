/**
 * THE Download of a video result (decided 2026-11-22: "the provider file is
 * stored untouched as the original; Download and downstream nodes read it;
 * the preview is for playing and thumbnails"). Every surface that downloads a
 * video result goes through this module, which `video-download-sites.test.ts`
 * holds them to.
 *
 * A surface holds only the address it plays (the preview), so the server
 * finds the original from it: `GET /v1/download?url=<address>&original=1`
 * answers the kept original its job names beside that preview, under the
 * original's own name, extension and content type; for a result with no
 * original (an H.264 8-bit file, a watermarked run, an upload, a plugin's
 * output) the file itself, exactly as before (backend
 * lib/video-download-original.ts). Nothing here changes what a player, a
 * thumbnail or a downstream node reads.
 *
 * Two transports, each the one its surface already used:
 * - `downloadVideoFile`: the canvas nodes' Download, which already streamed
 *   the file through the app's own route and saved it in place;
 * - `openVideoDownload` (and `videoDownloadLinkProps` for a link in markup):
 *   the surfaces whose Download opened the file itself (the Library browser,
 *   app result cards, history, the chat view, split parts, a loop's cells). The new tab asks the route
 *   with `open=1`: an original is saved (the tab closes), and with no original
 *   the route sends the tab on to the file itself, as before. An address the
 *   route cannot serve (not an https address of a stored video) keeps that
 *   surface's own download, unchanged.
 *
 * The file is named by the server (`Content-Disposition`), which a browser
 * prefers over a link's `download` value: so the link leaves the name to it,
 * and a `.mov` original is never saved as `.mp4`.
 */
import { runtimeStorageOrigins } from "./runtime-config"

/**
 * The path of a stored video result's address, as the server reads one
 * (backend lib/video-original-keys.ts): a preview `videos/<id>.mp4` or a kept
 * original `videos/<id>-master.<ext>`, `<id>` headed by its job's UUID.
 */
const STORED_VIDEO_PATH = /\/videos\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}[^/]*?(?:\.mp4|-master\.(?:mp4|mov|webm|mkv))$/i

/**
 * The stored file a player's address names: the address itself, or the file a
 * `/v1/image-proxy?url=…` link reads through the app's proxy.
 */
export function unproxiedUrl(url: string): string {
  try {
    const parsed = new URL(url, "https://x.invalid")
    if (parsed.pathname.endsWith("/v1/image-proxy")) return parsed.searchParams.get("url") ?? url
  } catch {
    // Not a url: itself.
  }
  return url
}

/**
 * Whether `url` is an address of a stored video result on this deployment's
 * own storage: one of the origins its download routes accept
 * (`runtimeStorageOrigins`, the server's own list), and a preview or kept
 * original path headed by a job id (`STORED_VIDEO_PATH`). Only such an
 * address can have an original; any other — another host, plain http, a
 * deployment whose `/config.js` names no storage — keeps its surface's own
 * download exactly.
 */
export function isStoredVideoAddress(url: string | undefined | null): boolean {
  if (!url) return false
  try {
    const parsed = new URL(unproxiedUrl(url))
    return runtimeStorageOrigins().includes(parsed.origin) && STORED_VIDEO_PATH.test(parsed.pathname)
  } catch {
    return false
  }
}

/**
 * The app's download link of a video result (module note); `open` for a link
 * that opens in a new tab. Relative, as every API call of the app is (the
 * app's own host serves the API: lib/api.ts `API_BASE_URL`).
 */
export function videoDownloadHref(url: string, opts: { open?: boolean } = {}): string {
  const target = encodeURIComponent(unproxiedUrl(url))
  return `/v1/download?url=${target}&original=1${opts.open ? "&open=1" : ""}`
}

/** Follow `href` as a link the browser saves from, without leaving the page. */
function saveFrom(href: string): void {
  const a = document.createElement("a")
  a.href = href
  // Present so the link saves rather than navigates; empty so the server's name is used.
  a.download = ""
  a.click()
}

/**
 * Download a video result in place (the canvas nodes' way, module note): an
 * address of a stored video on the deployment's own storage through the app's
 * download route (its kept original when it has one, else the file itself);
 * any other address through the proxy link the canvas always used.
 */
export function downloadVideoFile(url: string): void {
  saveFrom(isStoredVideoAddress(url) ? videoDownloadHref(url) : `/v1/image-proxy?url=${encodeURIComponent(unproxiedUrl(url))}&download=1`)
}

/**
 * Download a video result from a surface whose Download opened the file in a
 * new tab (module note). An https address of a stored video opens the app's
 * download link in a new tab: the original is saved when there is one, else
 * the tab goes on to the file itself. Any other address runs `asBefore`, the
 * surface's own download, unchanged.
 */
export function openVideoDownload(url: string, asBefore: () => void): void {
  if (!isStoredVideoAddress(url)) {
    asBefore()
    return
  }
  const a = document.createElement("a")
  a.href = videoDownloadHref(url, { open: true })
  a.target = "_blank"
  a.rel = "noopener noreferrer"
  a.click()
}

/**
 * The attributes of a Download link written in markup (`<a {...props}>`) for
 * a video result, with `openVideoDownload`'s transport: an https address of a
 * stored video opens the app's download route in a new tab (the original is
 * saved, else the tab goes on to the file itself); any other address is the
 * plain `download` link it was.
 */
export function videoDownloadLinkProps(url: string): { href: string; download?: string; target?: "_blank"; rel?: string } {
  return isStoredVideoAddress(url)
    ? { href: videoDownloadHref(url, { open: true }), target: "_blank", rel: "noopener noreferrer" }
    : { href: url, download: "" }
}

/** The containers a stored video is kept as, by the content type it is stored with (backend lib/storage.ts). */
const VIDEO_EXT_OF_TYPE: Readonly<Record<string, string>> = {
  "video/mp4": "mp4",
  "video/quicktime": "mov",
  "video/webm": "webm",
  "video/x-matroska": "mkv",
}

/**
 * The extension a downloaded video is saved under: the one its content type
 * names (always readable, even across origins), else the one in its
 * `Content-Disposition` file name, else undefined.
 */
export function downloadedVideoExtension(headers: Pick<Headers, "get">): string | undefined {
  const type = headers.get("content-type")?.split(";")[0]?.trim().toLowerCase()
  if (type && VIDEO_EXT_OF_TYPE[type]) return VIDEO_EXT_OF_TYPE[type]
  const name = /filename\*?=(?:UTF-8'')?"?([^";]+)"?/i.exec(headers.get("content-disposition") ?? "")?.[1]
  return name ? /\.(mp4|mov|webm|mkv)$/i.exec(name)?.[1]?.toLowerCase() : undefined
}

/**
 * The bytes of a video result's Download and the extension they are saved
 * under, for a surface that saves a fetched file under a name of its own (a
 * list's "Download all"): the kept original when it has one, through the app's
 * download route, else undefined, and the surface fetches the file itself as
 * before. The route's redirect (no original) is not followed: it only says so.
 */
export async function fetchVideoDownload(url: string): Promise<{ blob: Blob; ext: string } | undefined> {
  if (!isStoredVideoAddress(url)) return undefined
  try {
    const response = await fetch(videoDownloadHref(url, { open: true }), { redirect: "manual" })
    if (response.type === "opaqueredirect" || !response.ok) return undefined
    return { blob: await response.blob(), ext: downloadedVideoExtension(response.headers) ?? "mp4" }
  } catch {
    return undefined
  }
}
