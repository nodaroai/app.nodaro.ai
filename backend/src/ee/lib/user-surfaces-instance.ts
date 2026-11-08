import { config } from "../../lib/config.js"
import { supabase } from "../../lib/supabase.js"
import { createPresenceRecorder } from "./presence.js"
import { USER_SURFACE_RETRY_AFTER_MS, USER_SURFACE_WRITE_EVERY_MS, createUserSurfaceStore } from "./user-surfaces.js"

/**
 * This process's recorder of the surfaces each account uses (see
 * user-surfaces.ts). Under tests there is no store, as for presence: an app
 * built in a test must not write rows for the requests it makes.
 */
const store = createUserSurfaceStore(supabase)

export const recordUserSurface = createPresenceRecorder(
  () => Promise.resolve(config.NODE_ENV === "test" ? null : store),
  { writeEveryMs: USER_SURFACE_WRITE_EVERY_MS, retryAfterMs: USER_SURFACE_RETRY_AFTER_MS, label: "user-surfaces" },
)
