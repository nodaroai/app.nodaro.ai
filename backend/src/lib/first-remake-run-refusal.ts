/**
 * "First Remake on us" (migration 684): the database refuses to trash or
 * delete a covered Video Remake run while its offer is in use (a cancelled run
 * whose step is still out included), directly (`FIRST_REMAKE_RUN_ACTIVE`)
 * or by deleting the workflow or project that holds it, whose cascade would
 * take it (`FIRST_REMAKE_RUN_HELD`). The offer must see that run end.
 *
 * Both are client outcomes: 409 with their own code and a fixed sentence (the
 * database's text, which names a job id, is never forwarded). Recognized by
 * the exact prefix the database raises, at the start of the message or after
 * the delete helpers' own "Failed to delete …: " lead.
 */
export const FIRST_REMAKE_RUN_ACTIVE_CODE = "first_remake_run_active" as const
export const FIRST_REMAKE_RUN_HELD_CODE = "first_remake_run_held" as const

const REFUSALS = {
  FIRST_REMAKE_RUN_ACTIVE: {
    code: FIRST_REMAKE_RUN_ACTIVE_CODE,
    message: "This is your first Remake, still finishing. You can delete it once it and its steps have finished.",
  },
  FIRST_REMAKE_RUN_HELD: {
    code: FIRST_REMAKE_RUN_HELD_CODE,
    message: "This holds your first Remake, still finishing. You can delete it once that run and its steps have finished.",
  },
} as const

const PREFIX = /^(?:Failed to delete [^:]+: )?(FIRST_REMAKE_RUN_ACTIVE|FIRST_REMAKE_RUN_HELD):/

/** The 409 to answer for `err`, or null when it is no such refusal. */
export function firstRemakeRunRefusal(err: unknown): { statusCode: 409; body: { error: { code: string; message: string } } } | null {
  const message = err && typeof err === "object" && "message" in err && typeof (err as { message: unknown }).message === "string"
    ? (err as { message: string }).message
    : null
  if (!message) return null
  const m = PREFIX.exec(message)
  if (!m) return null
  const refusal = REFUSALS[m[1] as keyof typeof REFUSALS]
  return { statusCode: 409, body: { error: { code: refusal.code, message: refusal.message } } }
}
