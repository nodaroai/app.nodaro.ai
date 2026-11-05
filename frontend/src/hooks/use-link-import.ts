import { useCallback, useEffect, useRef, useState } from "react"
import { MediaImportError, discardMedia, importMediaUrl } from "@/lib/api"
import { DeclarationChangedError, reloadDeclaration } from "@/lib/content-rights"
import { declarationChanged } from "@/lib/declaration-changes"
import { confirmNodeLink, isNodeLinkRightsTicked, untickNodeLinkRights } from "@/lib/node-link-rights"

/**
 * What became of a link handed to `importLink`:
 * - `opened`: the editor is open on the picture;
 * - `failed`: it could not be copied (unreachable, too large, not a picture,
 *   full storage, the network), so the caller keeps the link as it is, as
 *   before there was an import;
 * - `refused`: the platform refused to import it (the site's policy, the
 *   account's measures, a confirmation it did not accept): the caller adds
 *   nothing and says so;
 * - `unconfirmed`: the content rights box is not ticked for this link, or the
 *   declaration changed (which unticks every box): nothing was fetched, and
 *   the caller keeps the link where the person can tick the box;
 * - `ignored`: another link is already on its way, or the page went away.
 */
export type LinkImportOutcome = "opened" | "failed" | "refused" | "unconfirmed" | "ignored"

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
 * An import of someone's link, so it waits for the content rights box ticked
 * for that link on this node or app card (`nodeId`), and confirms the
 * declaration for that one import right before it (`node-link-rights.ts`:
 * session state, never saved). A tick is one import's: once the import was
 * tried, the box is unticked, and the next link waits for it again.
 *
 * The editor works only from that in-memory File and uploads what the person
 * confirms, so the imported copy is discarded as soon as it is read back,
 * before the editor opens: it never holds storage while the editor's own
 * upload needs it, and nothing is left behind whatever the editor does.
 */
export function useLinkImport(nodeId: string) {
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
    if (!isNodeLinkRightsTicked(nodeId, url)) return "unconfirmed"
    inFlightRef.current = true
    setIsImporting(true)
    try {
      let confirmationId: string
      try {
        confirmationId = await confirmNodeLink(nodeId, url)
      } catch (err) {
        // A changed declaration unticked the box: nothing is fetched until it is ticked again.
        if (!(err instanceof DeclarationChangedError)) throw err
        return mountedRef.current ? "unconfirmed" : "ignored"
      }
      const imported = await importMediaUrl(url, { confirmationId })
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
    } catch (err) {
      if (!mountedRef.current) return "ignored"
      if (!(err instanceof MediaImportError) || err.status !== 403) return "failed"
      if (err.code !== "rights_confirmation_stale") return "refused"
      // The declaration changed after this confirmation was made: every box was ticked under the old text.
      reloadDeclaration()
      declarationChanged()
      return "unconfirmed"
    } finally {
      untickNodeLinkRights(nodeId)
      inFlightRef.current = false
      if (mountedRef.current) setIsImporting(false)
    }
  }, [nodeId])

  return { importLink, isImporting }
}
