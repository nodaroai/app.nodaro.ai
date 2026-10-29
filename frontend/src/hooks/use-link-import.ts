import { useCallback, useEffect, useRef, useState } from "react"
import { discardMedia, importMediaUrl } from "@/lib/api"

/**
 * What became of a link handed to `importLink`:
 * - `opened`: the editor is open on the picture;
 * - `failed`: it could not be imported (any reason), so the caller keeps the
 *   link as it is, as before there was an import;
 * - `ignored`: another link is already on its way, or the page went away.
 */
export type LinkImportOutcome = "opened" | "failed" | "ignored"

/** The extension a picture of each type the platform imports is named with. */
const EXTENSION_BY_TYPE: Readonly<Record<string, string>> = {
  "image/jpeg": "jpg",
  "image/png": "png",
  "image/webp": "webp",
  "image/gif": "gif",
  "image/avif": "avif",
  "image/heic": "heic",
  "image/heif": "heif",
}

/** Extensions that already say a jpeg is a jpeg. */
const JPEG_EXTENSIONS: ReadonlySet<string> = new Set(["jpg", "jpeg", "jpe"])

/** A picture extension that names another type, replaced rather than kept. */
const PICTURE_EXTENSION = /\.(jpe?g|jpe|png|webp|gif|avif|heic|heif|tiff?|bmp|svg)$/i

/**
 * `name` with the extension its `mimeType` calls for, so the file's name and
 * type agree: a HEIC link stored as JPEG reads `photo.jpg`, a CDN link with no
 * extension `AbC123.jpg`. A name already right is kept; a type outside the
 * table leaves the name as it is.
 */
export function fileNameForType(name: string, mimeType: string): string {
  const ext = EXTENSION_BY_TYPE[mimeType]
  if (!ext) return name
  const current = /\.([^./]+)$/.exec(name)?.[1]?.toLowerCase()
  if (current === ext || (ext === "jpg" && current !== undefined && JPEG_EXTENSIONS.has(current))) return name
  const stem = PICTURE_EXTENSION.test(name) ? name.replace(PICTURE_EXTENSION, "") : name
  return `${stem || "image"}.${ext}`
}

/**
 * A picture link brought in like a file: the platform copies it into the
 * person's storage (`importMediaUrl`), the copy is read back as a File and
 * handed to the "Adjust image" editor, exactly as a picked file is.
 *
 * The editor works only from that in-memory File and uploads what the person
 * confirms, so the imported copy is discarded as soon as it is read back,
 * before the editor opens: it never holds storage while the editor's own
 * upload needs it, and nothing is left behind whatever the editor does.
 */
export function useLinkImport() {
  const [isImporting, setIsImporting] = useState(false)
  const inFlightRef = useRef(false)
  const mountedRef = useRef(false)

  useEffect(() => {
    mountedRef.current = true
    return () => { mountedRef.current = false }
  }, [])

  /** Import `url` and, once it is read back, open it in the editor. */
  const importLink = useCallback(async (url: string, openEditor: (files: File[]) => unknown): Promise<LinkImportOutcome> => {
    if (inFlightRef.current) return "ignored"
    inFlightRef.current = true
    setIsImporting(true)
    try {
      const imported = await importMediaUrl(url)
      let file: File | null = null
      try {
        const res = await fetch(imported.url)
        if (res.ok) {
          const blob = await res.blob()
          file = new File([blob], fileNameForType(imported.filename, imported.mimeType), { type: imported.mimeType })
        }
      } catch {
        // not read back: a failure, below
      }
      // Best effort, and never a reason to stop: discardMedia swallows its errors.
      await discardMedia(imported.url)
      // A component gone meanwhile has nothing to open, write or say.
      if (!mountedRef.current) return "ignored"
      if (!file) return "failed"
      openEditor([file])
      return "opened"
    } catch {
      return mountedRef.current ? "failed" : "ignored"
    } finally {
      inFlightRef.current = false
      if (mountedRef.current) setIsImporting(false)
    }
  }, [])

  return { importLink, isImporting }
}
