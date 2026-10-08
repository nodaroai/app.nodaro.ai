import { config } from "../../lib/config.js"
import { createPresenceRecorder, type PresenceStore } from "./presence.js"

/**
 * This process's presence store and recorder. The Redis connection opens on
 * the first signed-in request, never at import; under tests there is none —
 * the recorder, the store and the list are tested with their own fakes, and an
 * app built in a test must not open a connection that keeps the run alive.
 */
let store: Promise<PresenceStore | null> | null = null

export function presenceStore(): Promise<PresenceStore | null> {
  store ??=
    config.NODE_ENV === "test"
      ? Promise.resolve(null)
      : import("./presence-redis.js").then(
          (m) => m.createPresenceStore(),
          () => null,
        )
  return store
}

export const recordPresence = createPresenceRecorder(presenceStore)
