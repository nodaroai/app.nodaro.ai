/**
 * Prerender awareness. Another Nodaro surface on the same site may prerender
 * this app before a click (a speculation rule; the Caddyfile allows it with
 * `Supports-Loading-Mode: credentialed-prerender`). A prerendered page runs its
 * scripts before it is shown — and may never be shown — so anything that
 * counts a real visit or moves the visitor (a claim, a redirect, an analytics
 * page view) waits for activation. Fetching data during a prerender is fine:
 * that is the point of it.
 *
 * `index.html`'s analytics snippet applies the same rule inline (it runs
 * before any module).
 */

type PrerenderDocument = Document & { readonly prerendering?: boolean }

const pageDocument = (): PrerenderDocument | undefined => (typeof document === "undefined" ? undefined : document)

/** True while the page is being prerendered (not yet shown). */
export function isPrerendering(doc: PrerenderDocument | undefined = pageDocument()): boolean {
  return doc?.prerendering === true
}

/**
 * Runs `run` now on a normal page; once, on activation, in a prerendered one.
 * Returns a cleanup that cancels a held action (usable as a React effect's
 * return value).
 */
export function whenActivated(run: () => void, doc: PrerenderDocument | undefined = pageDocument()): () => void {
  if (!doc || !isPrerendering(doc)) {
    run()
    return () => {}
  }
  let done = false
  const onActivate = () => {
    if (done) return
    done = true
    run()
  }
  doc.addEventListener("prerenderingchange", onActivate, { once: true })
  return () => {
    done = true
    doc.removeEventListener("prerenderingchange", onActivate)
  }
}
