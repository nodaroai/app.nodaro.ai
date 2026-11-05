/**
 * The signal that the content rights declaration changed since this page read
 * it. `content-rights.ts` learns it when a confirmation is refused as stale.
 * Every box ticked so far was ticked under the old text, so every store of
 * boxes (`video-link-rights.ts`, `node-link-rights.ts`) unticks them all on it,
 * not only the box whose confirmation found out: the person must read the new
 * text and tick again before any of them confirms under it.
 */
const listeners = new Set<() => void>()

/** Calls `listener` whenever the declaration is found changed; answers the unsubscribe. */
export function onDeclarationChanged(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

/** The declaration was found changed: every store of boxes unticks them all. */
export function declarationChanged(): void {
  for (const listener of listeners) listener()
}
