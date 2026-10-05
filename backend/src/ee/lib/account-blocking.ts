import { supabase } from "../../lib/supabase.js"
import { config } from "../../lib/config.js"
import { deploymentPayerId } from "../../lib/deployment-payer.js"
import { isMissingTableError } from "../../lib/postgrest-errors.js"
import { platformOperatorEmails } from "../middleware/require-platform-operator.js"

/**
 * Blocking an account: the database row the backend enforces
 * (`lib/access-blocks.ts`) plus a GoTrue sign-in ban.
 *
 * THE BAN IS MARKED AS OURS. It is set together with
 * `app_metadata.nodaro_access_block` in ONE GoTrue update, and lifted only
 * when that marker is present — so unblocking never undoes a ban something
 * else placed (an SSO de-provision, a ban an operator set by hand).
 *
 * CONVERGE, DON'T SEQUENCE. The row and the ban live in two systems with no
 * shared transaction. Every block and unblock writes the row, then makes
 * GoTrue agree with whatever the row says NOW (`convergeSignInBan`). Two
 * admins racing a block and an unblock therefore settle on the last row write,
 * and pressing either button again repairs a half-applied state.
 */

export const BLOCK_BAN_MARKER = "nodaro_access_block"

/** ~100 years — GoTrue's "permanent ban" idiom (undo: "none"). Shared with the SSO de-provision route. */
export const BAN_DURATION = "876000h"

export type BlockRefusal = "cannot_block_self" | "not_found" | "target_is_admin" | "target_protected" | "payer_account_protected"

export const BLOCK_REFUSAL_MESSAGE: Record<BlockRefusal, string> = {
  cannot_block_self: "You cannot block your own account.",
  not_found: "No such account.",
  target_is_admin: "Admins cannot be blocked. Change the role first.",
  target_protected: "The platform owner and operators cannot be blocked.",
  payer_account_protected: "This deployment's billing account cannot be blocked.",
}

/** Why this account may not be blocked by this admin, or null when it may. */
export async function blockRefusal(adminId: string, targetId: string): Promise<BlockRefusal | null> {
  // One spelling for every comparison: an upper-case uuid names the same
  // account to Postgres and GoTrue, so it must not slip past a string check.
  const target = targetId.toLowerCase()
  if (adminId.toLowerCase() === target) return "cannot_block_self"
  if (target === deploymentPayerId()?.toLowerCase()) return "payer_account_protected"
  const { data, error } = await supabase.from("profiles").select("id, email, role").eq("id", target).maybeSingle()
  if (error) throw error
  if (!data) return "not_found"
  const role = (data as { role?: string | null }).role ?? "user"
  if (role === "admin" || role === "super_admin") return "target_is_admin"
  const email = ((data as { email?: string | null }).email ?? "").trim().toLowerCase()
  const protectedEmails = platformOperatorEmails()
  const owner = config.PLATFORM_OWNER_EMAIL?.trim().toLowerCase()
  if (owner) protectedEmails.add(owner)
  if (email && protectedEmails.has(email)) return "target_protected"
  return null
}

/**
 * Is this account blocked right now — a fresh read, not the snapshot. False
 * while the table does not exist yet (staging runs ahead of migration 458).
 */
export async function isBlockedNow(userId: string): Promise<boolean> {
  const { data, error } = await supabase.from("account_blocks").select("user_id").eq("user_id", userId.toLowerCase()).maybeSingle()
  if (error) {
    if (isMissingTableError(error)) return false
    throw error
  }
  return data !== null
}

/** Is there a block row for this account right now (a fresh read, not the snapshot)? */
async function hasBlockRow(userId: string): Promise<boolean> {
  const { data, error } = await supabase.from("account_blocks").select("user_id").eq("user_id", userId).maybeSingle()
  if (error) throw error
  return data !== null
}

function bannedNow(bannedUntil: unknown): boolean {
  if (typeof bannedUntil !== "string" || bannedUntil.length === 0) return false
  const t = Date.parse(bannedUntil)
  return Number.isFinite(t) && t > Date.now()
}

export interface SignInBanState {
  /** GoTrue refuses sign-in for this account now. */
  signInBlocked: boolean
  /** The ban is ours (set by a block) — the only kind an unblock lifts. */
  ours: boolean
}

/**
 * Make GoTrue agree with the block row: a blocked account gets a marked ban;
 * an unblocked one loses OUR ban (and only ours). Returns the resulting state.
 */
export async function convergeSignInBan(userId: string): Promise<SignInBanState> {
  const blocked = await hasBlockRow(userId)
  const { data, error } = await supabase.auth.admin.getUserById(userId)
  if (error || !data?.user) throw error ?? new Error("auth user not found")
  const user = data.user as { banned_until?: string | null; app_metadata?: Record<string, unknown> }
  const banned = bannedNow(user.banned_until)
  const ours = user.app_metadata?.[BLOCK_BAN_MARKER] === true

  if (blocked && !banned) {
    const { error: banError } = await supabase.auth.admin.updateUserById(userId, {
      ban_duration: BAN_DURATION,
      app_metadata: { [BLOCK_BAN_MARKER]: true },
    })
    if (banError) throw banError
    return { signInBlocked: true, ours: true }
  }
  if (!blocked && banned && ours) {
    const { error: liftError } = await supabase.auth.admin.updateUserById(userId, {
      ban_duration: "none",
      app_metadata: { [BLOCK_BAN_MARKER]: null },
    })
    if (liftError) throw liftError
    return { signInBlocked: false, ours: false }
  }
  return { signInBlocked: banned, ours: banned && ours }
}

/** The GoTrue state alone, for the admin panel. */
export async function readSignInBan(userId: string): Promise<SignInBanState | null> {
  const { data, error } = await supabase.auth.admin.getUserById(userId)
  if (error || !data?.user) return null
  const user = data.user as { banned_until?: string | null; app_metadata?: Record<string, unknown> }
  const banned = bannedNow(user.banned_until)
  return { signInBlocked: banned, ours: banned && user.app_metadata?.[BLOCK_BAN_MARKER] === true }
}

export class BlocksUnavailableError extends Error {
  constructor() {
    super("The block tables are not in this database yet")
    this.name = "BlocksUnavailableError"
  }
}

/** Write (or refresh) the block row. The original block time is kept. */
/**
 * Write the block row. A repeat block — "Block again" finishing a sign-in step
 * that failed, or a second admin — leaves the row as it is: the original
 * reason, admin and time stay, and the audit trail records the repeat.
 */
export async function writeBlockRow(userId: string, adminId: string, reason: string | null): Promise<void> {
  const { error } = await supabase
    .from("account_blocks")
    .upsert({ user_id: userId, reason, blocked_by: adminId }, { onConflict: "user_id", ignoreDuplicates: true })
  if (error) {
    if (isMissingTableError(error)) throw new BlocksUnavailableError()
    throw error
  }
}

export async function deleteBlockRow(userId: string): Promise<boolean> {
  const { data, error } = await supabase.from("account_blocks").delete().eq("user_id", userId).select("user_id")
  if (error) {
    if (isMissingTableError(error)) throw new BlocksUnavailableError()
    throw error
  }
  return Array.isArray(data) && data.length > 0
}
