import { useEffect } from "react"

/**
 * The view page's title and robots directive while it is open. A view its
 * owner kept out of search carries `noindex` (search engines' own requests are
 * answered by the proxy; this covers every other reader of the page). Both are
 * put back when the page closes.
 */
export function useViewDocumentHead(title: string | undefined, indexable: boolean | undefined): void {
  useEffect(() => {
    if (!title) return
    const previous = document.title
    document.title = title
    return () => { document.title = previous }
  }, [title])

  useEffect(() => {
    if (indexable !== false) return
    const meta = document.createElement("meta")
    meta.name = "robots"
    meta.content = "noindex"
    meta.dataset.workflowView = "true"
    document.head.appendChild(meta)
    return () => { meta.remove() }
  }, [indexable])
}
