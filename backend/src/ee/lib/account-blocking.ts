import { supabase } from "../../lib/supabase.js"
import { config } from "../../lib/config.js"
import { deploymentPayerId } from "../../lib/deployment-payer.js"
import { isMissingTableError } from "../../lib/postgrest-errors.js"
import { invalidateAccessBlocks } from "../../lib/access-blocks.js"
import { suspensionEndsAt } from "../../lib/account-measures.js"
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
 *
 * A SUSPENSION BANS SIGN-IN UNTIL ITS END (migration 589). Our ban follows
 * the block AND the suspension in force: blocked, it is permanent; suspended
 * and not blocked, it ends with the suspension (GoTrue lifts it by itself
 * then); neither, it is lifted. So the two never move each other: an unblock
 * leaves a suspended account banned until its end, and a suspension lifted
 * early leaves a blocked account banned.
 *
 * THE MARKER KEEPS THE END WE SET. A ban GoTrue ends by itself leaves our
 * marker behind; a ban placed later by something else must not read as ours
 * because of it. So the marker carries the end we set
 * (`nodaro_access_block_until`), and a ban is ours only while it still ends
 * then. A marker without an end (bans set before ends were kept: a block's)
 * still reads as ours.
 */

export const BLOCK_BAN_MARKER = "nodaro_access_block"

/** When the ban we set ends (ISO), kept beside the marker. */
export const BLOCK_BAN_UNTIL = "nodaro_access_block_until"

/** ~100 years — GoTrue's "permanent ban" idiom (undo: "none"). Shared with the SSO de-provision route. */
export const BAN_DURATION = "876000h"

/** A ban ending further out than this is a permanent one (a block's runs ~100 years). */
const PERMANENT_BAN_MS = 50 * 365 * 86_400_000

/** How far GoTrue's end may sit from a suspension's before the ban is set again: the two clocks, and a request's time. */
const BAN_END_SLACK_MS = 5 * 60_000

export type BlockRefusal = "cannot_block_self" | "not_found" | "target_is_admin" | "target_protected" | "payer_account_protected"

export const BLOCK_REFUSAL_MESSAGE: Record<BlockRefusal, string> = {
  cannot_block_self: "You cannot block your own account.",
  not_found: "No such account.",
  target_is_admin: "Admins cannot be blocked. Change the role first.",
  target_protected: "The platform owner and operators cannot be blocked.",
  payer_account_protected: "This deployment's billing account cannot be blocked.",
}

/** The same refusals, for a suspension (a suspension refuses access as a block does, so it spares the same accounts). */
export const SUSPEND_REFUSAL_MESSAGE: Record<BlockRefusal, string> = {
  cannot_block_self: "You cannot suspend your own account.",
  not_found: "No such account.",
  target_is_admin: "Admins cannot be suspended. Change the role first.",
  target_protected: "The platform owner and operators cannot be suspended.",
  payer_account_protected: "This deployment's billing account cannot be suspended.",
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

export interface AccountBlockRow {
  /** Why it was blocked, as the administrator wrote it. */
  readonly reason: string | null
  readonly blockedAt: string
}

/**
 * The account's block row — a fresh read, not the snapshot — or null. Null
 * too while the table does not exist yet (staging runs ahead of migration 458).
 */
export async function readBlock(userId: string): Promise<AccountBlockRow | null> {
  const { data, error } = await supabase.from("account_blocks").select("reason, created_at").eq("user_id", userId.toLowerCase()).maybeSingle()
  if (error) {
    if (isMissingTableError(error)) return null
    throw error
  }
  if (!data) return null
  const row = data as { reason: string | null; created_at: string }
  return { reason: row.reason, blockedAt: row.created_at }
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

/** When GoTrue's ban ends, as ms; null when there is none now (a ban past its end is none). */
function banEnd(bannedUntil: unknown, now: number): number | null {
  if (typeof bannedUntil !== "string" || bannedUntil.length === 0) return null
  const t = Date.parse(bannedUntil)
  return Number.isFinite(t) && t > now ? t : null
}

/** Whether a ban ending at `end` is ours: marked, and ending when the marker says we set it to (see the module comment). */
function isOurBan(end: number, metadata: Record<string, unknown> | undefined): boolean {
  if (metadata?.[BLOCK_BAN_MARKER] !== true) return false
  const until = metadata[BLOCK_BAN_UNTIL]
  if (typeof until !== "string") return true
  const at = Date.parse(until)
  return Number.isFinite(at) && Math.abs(end - at) <= BAN_END_SLACK_MS
}

export interface SignInBanState {
  /** GoTrue refuses sign-in for this account now. */
  signInBlocked: boolean
  /** The ban is ours (set by a block or a suspension) — the only kind we ever lift. */
  ours: boolean
}

/** GoTrue's ban, as we read it: none, or its end and whether it is ours. */
function banOf(user: { banned_until?: string | null; app_metadata?: Record<string, unknown> }, now: number): { end: number; ours: boolean } | null {
  const end = banEnd(user.banned_until, now)
  return end === null ? null : { end, ours: isOurBan(end, user.app_metadata) }
}

/** The ban the account calls for now: permanent while it is blocked, else until its suspension's end (ms), else none. */
type WantedBan = "permanent" | number | null

async function wantedBan(userId: string): Promise<WantedBan> {
  if (await hasBlockRow(userId)) return "permanent"
  const end = await suspensionEndsAt(userId)
  return end ? Date.parse(end) : null
}

/** The ban a block and a suspension call for, as the panel read them. */
function wantedOf(state: { readonly blocked: boolean; readonly suspendedUntil: string | null }): WantedBan {
  if (state.blocked) return "permanent"
  return state.suspendedUntil ? Date.parse(state.suspendedUntil) : null
}

/** Whether a ban ending at `end` is the one wanted: a permanent one, or one ending with the suspension (give or take the slack). */
function banAgrees(end: number, wanted: "permanent" | number, now: number): boolean {
  return wanted === "permanent" ? end - now > PERMANENT_BAN_MS : Math.abs(end - wanted) <= BAN_END_SLACK_MS
}

/** GoTrue's ban for what is wanted: the permanent idiom, or the whole seconds left to the suspension's end; and when it ends. */
function banFor(wanted: "permanent" | number, now: number): { duration: string; until: string } {
  if (wanted === "permanent") return { duration: BAN_DURATION, until: new Date(now + 876_000 * 3_600_000).toISOString() }
  const seconds = Math.max(1, Math.ceil((wanted - now) / 1000))
  return { duration: `${seconds}s`, until: new Date(now + seconds * 1000).toISOString() }
}

type Ban = { readonly end: number; readonly ours: boolean } | null

/**
 * What bringing the ban in line would do: keep it (it agrees, or it is
 * someone else's: never ours to move), ban to what is wanted, or lift ours.
 */
function banPlan(wanted: WantedBan, ban: Ban, now: number): "keep" | "ban" | "lift" {
  if (ban && !ban.ours) return "keep"
  if (wanted !== null) return ban && banAgrees(ban.end, wanted, now) ? "keep" : "ban"
  return ban ? "lift" : "keep"
}

/** Writes the plan to GoTrue, in one update each; answers the ban it leaves. */
async function applyBanPlan(userId: string, plan: "ban" | "lift", wanted: WantedBan, now: number): Promise<Ban> {
  if (plan === "lift" || wanted === null) {
    const { error } = await supabase.auth.admin.updateUserById(userId, {
      ban_duration: "none",
      app_metadata: { [BLOCK_BAN_MARKER]: null, [BLOCK_BAN_UNTIL]: null },
    })
    if (error) throw error
    return null
  }
  const { duration, until } = banFor(wanted, now)
  const { error } = await supabase.auth.admin.updateUserById(userId, {
    ban_duration: duration,
    app_metadata: { [BLOCK_BAN_MARKER]: true, [BLOCK_BAN_UNTIL]: until },
  })
  if (error) throw error
  return { end: Date.parse(until), ours: true }
}

const sameWanted = (a: WantedBan, b: WantedBan) => a === b || (typeof a === "number" && typeof b === "number" && Math.abs(a - b) <= BAN_END_SLACK_MS)

/** How many times converging writes GoTrue before it answers: once, and once more if the block or the suspension moved meanwhile. */
const CONVERGE_WRITES = 2

/**
 * Make GoTrue agree with the account's block and its suspension (see the
 * module comment): a marked ban, permanent or until the suspension's end, set
 * again when it ends sooner or later than that; neither in force, OUR ban is
 * lifted. A ban something else placed is never touched. After a write the
 * block and the suspension are read again, and a change made meanwhile (an
 * administrator lifting a suspension while another took it) is written too,
 * so the last word is the record's. Returns the resulting state.
 */
export async function convergeSignInBan(userId: string): Promise<SignInBanState> {
  let wanted = await wantedBan(userId)
  const { data, error } = await supabase.auth.admin.getUserById(userId)
  if (error || !data?.user) throw error ?? new Error("auth user not found")
  let ban = banOf(data.user as { banned_until?: string | null; app_metadata?: Record<string, unknown> }, Date.now())
  for (let writes = 0; writes < CONVERGE_WRITES; writes++) {
    const now = Date.now()
    const plan = banPlan(wanted, ban, now)
    if (plan === "keep") break
    ban = await applyBanPlan(userId, plan, wanted, now)
    const again = await wantedBan(userId)
    if (sameWanted(again, wanted)) break
    wanted = again
  }
  return { signInBlocked: ban !== null, ours: ban?.ours ?? false }
}

export interface SignInBanRead extends SignInBanState {
  /** When GoTrue's ban ends; null when there is none. */
  endsAt: string | null
}

/** The GoTrue state alone, for the admin panel. */
export async function readSignInBan(userId: string): Promise<SignInBanRead | null> {
  const { data, error } = await supabase.auth.admin.getUserById(userId)
  if (error || !data?.user) return null
  const ban = banOf(data.user as { banned_until?: string | null; app_metadata?: Record<string, unknown> }, Date.now())
  return { signInBlocked: ban !== null, ours: ban?.ours ?? false, endsAt: ban ? new Date(ban.end).toISOString() : null }
}

/**
 * Whether the account's sign-in agrees with the block and the suspension the
 * panel read: whether bringing it in line (`convergeSignInBan`) would change
 * nothing. A ban someone else placed is never ours to move, so it agrees.
 */
export function signInInLine(read: SignInBanRead, state: { readonly blocked: boolean; readonly suspendedUntil: string | null }, now: number = Date.now()): boolean {
  const end = read.endsAt ? Date.parse(read.endsAt) : null
  const ban: Ban = read.signInBlocked && end !== null ? { end, ours: read.ours } : null
  return banPlan(wantedOf(state), ban, now) === "keep"
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

/* -------------------------------------------------------------------------
 * Quiet stop (migration 505): the account keeps signing in, keeps its credits
 * and keeps submitting; its jobs are accepted and never run. The same
 * refusals as a block (self, admins, the owner, the payer), and only a super
 * admin places or lifts one — the point is that the person is NOT told, so
 * a mistake is a customer waiting on a run that never comes.
 * ---------------------------------------------------------------------- */

export const QUIET_STOP_REFUSAL_MESSAGE: Record<BlockRefusal, string> = {
  cannot_block_self: "You cannot stop your own account.",
  not_found: "No such account.",
  target_is_admin: "Admins cannot be stopped. Change the role first.",
  target_protected: "The platform owner and operators cannot be stopped.",
  payer_account_protected: "This deployment's billing account cannot be stopped.",
}

export interface QuietStopRow {
  reason: string | null
  stoppedBy: string | null
  stoppedAt: string
}

/** The account's quiet stop, or null. Null too while the table does not exist yet. */
export async function readQuietStop(userId: string): Promise<QuietStopRow | null> {
  const { data, error } = await supabase
    .from("quiet_stops")
    .select("reason, stopped_by, created_at")
    .eq("user_id", userId.toLowerCase())
    .maybeSingle()
  if (error) {
    if (isMissingTableError(error)) return null
    throw error
  }
  if (!data) return null
  const row = data as { reason?: string | null; stopped_by?: string | null; created_at: string }
  return { reason: row.reason ?? null, stoppedBy: row.stopped_by ?? null, stoppedAt: row.created_at }
}

/** Write the stop. A repeat leaves the original reason, admin and time. */
export async function writeQuietStopRow(userId: string, adminId: string, reason: string | null): Promise<void> {
  const { error } = await supabase
    .from("quiet_stops")
    .upsert({ user_id: userId, reason, stopped_by: adminId }, { onConflict: "user_id", ignoreDuplicates: true })
  if (error) {
    if (isMissingTableError(error)) throw new BlocksUnavailableError()
    throw error
  }
}

export async function deleteQuietStopRow(userId: string): Promise<boolean> {
  const { data, error } = await supabase.from("quiet_stops").delete().eq("user_id", userId).select("user_id")
  if (error) {
    if (isMissingTableError(error)) throw new BlocksUnavailableError()
    throw error
  }
  return Array.isArray(data) && data.length > 0
}

/**
 * A quiet stop ends the moment the account PAYS (owner's rule, 2026-10-13):
 * the stop is for free credits taken by a repeat signup, never for money —
 * a person who decides to pay must be able to use what they bought. Called
 * from the purchase path only after the credits actually landed. Deletes
 * the row (so the Blocks page is truthful), tells the workers at once, and
 * leaves an audit entry under the admin who placed the stop. Never throws:
 * the purchase is already granted and nothing here may fail it.
 */
export async function releaseQuietStopOnPurchase(userId: string): Promise<{ released: boolean }> {
  try {
    const row = await readQuietStop(userId)
    if (!row) return { released: false }
    const removed = await deleteQuietStopRow(userId)
    invalidateAccessBlocks()
    if (!removed) return { released: false }
    await supabase.from("admin_actions").insert({
      admin_user_id: row.stoppedBy,
      action: "account_quiet_release",
      target_type: "user",
      target_id: userId,
      reason: "Released by purchase",
      payload: { by: "purchase", stoppedAt: row.stoppedAt, stopReason: row.reason },
    })
    return { released: true }
  } catch {
    return { released: false }
  }
}
