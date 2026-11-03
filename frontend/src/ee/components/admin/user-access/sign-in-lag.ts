import type { AdminUserAccess } from "@/ee/hooks/queries/use-admin-access"

/** What bringing the account's sign-in in line would do: let it in, refuse it, or refuse it until the right end. */
export type SignInLag = "allow" | "refuse" | "correct"

/**
 * Where the account's sign-in disagrees with its block and its suspension, as
 * the server judged it (`signInInLine`, backend ee/lib/account-blocking.ts):
 * "allow" when our ban still refuses an account neither blocked nor suspended
 * (an unblock or a lift whose sign-in step failed), "refuse" when sign-in is
 * not refused though it should be, "correct" when it is refused until another
 * end than the block or the suspension sets (an unblock of a suspended
 * account that failed). A blocked account whose sign-in is not refused has
 * its own "Block again". Null when they agree, when the ban could not be
 * read, or on a server that does not say. Pure.
 */
export function signInLag(access: AdminUserAccess): SignInLag | null {
  if (access.signInInLine !== false) return null
  if (access.blocked && access.signInBlocked === false) return null
  if (access.signInWanted === "allowed") return "allow"
  return access.signInBlocked ? "correct" : "refuse"
}
