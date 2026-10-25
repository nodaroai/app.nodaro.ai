import { canonicalVideoProvider } from "@nodaro/shared/models"

/**
 * A node saved with a retired video model (`RETIRED_VIDEO_PROVIDERS`, e.g.
 * Seedance 1.5 → Seedance 2 Mini) loads carrying the model it now runs as, so
 * its picker, its quoted price and its run all name one model. The server
 * makes the same rewrite on every run and request; this is the editor's copy
 * of the stored value. Idempotent; unchanged nodes pass through by reference.
 */
export function migrateRetiredVideoProviders<T extends { readonly data?: unknown }>(nodes: ReadonlyArray<T>): T[] {
  return nodes.map((node) => {
    const data = node.data as Record<string, unknown> | undefined
    const provider = data?.provider
    const runsAs = canonicalVideoProvider(provider)
    return runsAs === provider ? node : ({ ...node, data: { ...data, provider: runsAs } } as T)
  })
}
