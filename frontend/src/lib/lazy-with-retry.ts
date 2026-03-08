import { lazy } from "react"

/**
 * Wraps React.lazy with automatic retry + page reload for stale chunk errors.
 * After a deployment, old chunk hashes no longer exist on the server.
 * This detects the "Failed to fetch dynamically imported module" error,
 * retries once, and if it still fails, reloads the page (once per session).
 */

const RELOAD_KEY = "chunk-reload"

function isChunkError(error: unknown): boolean {
  if (!(error instanceof Error)) return false
  const msg = error.message.toLowerCase()
  return (
    msg.includes("failed to fetch dynamically imported module") ||
    msg.includes("importing a module script failed") ||
    msg.includes("error loading dynamically imported module") ||
    msg.includes("loading chunk") ||
    msg.includes("loading css chunk")
  )
}

export function lazyWithRetry<T extends React.ComponentType<any>>(
  factory: () => Promise<{ default: T }>,
): React.LazyExoticComponent<T> {
  return lazy(() =>
    factory().catch((err) => {
      if (!isChunkError(err)) throw err

      // Retry once (cache-bust via fresh import)
      return factory().catch((retryErr) => {
        // Reload to get fresh index.html with new chunk hashes.
        // The flag is cleared on successful load in main.tsx,
        // so this only prevents infinite loops within a single reload.
        sessionStorage.setItem(RELOAD_KEY, "1")
        window.location.reload()
        throw retryErr
      })
    }),
  )
}
