import { invalidateAccessBlocks } from "../../lib/access-blocks.js"
import { invalidateAuthCache } from "../../middleware/auth.js"
import { blockRefusal, convergeSignInBan, deleteBlockRow, writeBlockRow, type BlockRefusal } from "./account-blocking.js"

/**
 * Blocking an account, every step of it, for every caller: the block button
 * (ee/routes/admin-access.ts) and a closure under the repeat-infringer policy
 * (ee/lib/repeat-infringers.ts); and the same steps after a suspension is
 * recorded, whose row is itself the refusal (`enforceSuspension`). Its own
 * module, so the light helpers in account-blocking.ts stay free of the auth
 * middleware for the modules that only read them.
 */

export type BlockOutcome =
  | { readonly refused: BlockRefusal }
  | {
      readonly refused: null
      /** GoTrue refuses the account's sign-in now. */
      readonly signInBlocked: boolean
      /** Converging the sign-in ban failed: the block stands, and blocking again repairs it. */
      readonly signInError: unknown
    }

/**
 * Blocks an account. Refused for oneself, an administrator, the platform's
 * owner and operators, and the deployment's payer — asked again once the row
 * exists, since the role was read before the write: an account promoted in
 * between has the row taken back and is refused. Once the row was written,
 * every process's block snapshot is told whatever happens next (a failed
 * second read included); then the auth cache, and the sign-in ban converged;
 * a failure there is answered, not thrown. Idempotent: blocking again repairs
 * a half-applied block, and a repeat keeps the first reason, admin and time.
 * The caller audits it. Throws `BlocksUnavailableError` before migration 458.
 */
export async function blockAccount(adminId: string, userId: string, reason: string | null): Promise<BlockOutcome> {
  const refusal = await blockRefusal(adminId, userId)
  if (refusal) return { refused: refusal }
  await writeBlockRow(userId, adminId, reason)
  try {
    const late = await blockRefusal(adminId, userId)
    if (late) {
      await deleteBlockRow(userId)
      return { refused: late }
    }
  } finally {
    invalidateAccessBlocks()
  }
  return afterAccessChange(userId)
}

/**
 * After a suspension was recorded (its row is the refusal: access-blocks.ts
 * reads it): the same late refusal as a block (an account promoted since the
 * check before the write is refused, and the caller takes the suspension
 * back), every process's snapshot told whatever happens next, then the auth
 * cache, and the sign-in ban converged until the suspension's end; a failure
 * there is answered, not thrown.
 */
export async function enforceSuspension(adminId: string, userId: string): Promise<BlockOutcome> {
  try {
    const late = await blockRefusal(adminId, userId)
    if (late) return { refused: late }
  } finally {
    invalidateAccessBlocks()
  }
  return afterAccessChange(userId)
}

/**
 * After a suspension was lifted: every process's snapshot told, the auth
 * cache, and the sign-in ban converged (lifted, unless the account is
 * blocked); a failure there is answered, not thrown.
 */
export async function releaseSuspension(userId: string): Promise<{ readonly signInBlocked: boolean | null; readonly signInError: unknown }> {
  invalidateAccessBlocks()
  invalidateAuthCache(userId)
  try {
    return { signInBlocked: (await convergeSignInBan(userId)).signInBlocked, signInError: null }
  } catch (err) {
    return { signInBlocked: null, signInError: err }
  }
}

async function afterAccessChange(userId: string): Promise<BlockOutcome> {
  invalidateAuthCache(userId)
  try {
    return { refused: null, signInBlocked: (await convergeSignInBan(userId)).signInBlocked, signInError: null }
  } catch (err) {
    return { refused: null, signInBlocked: false, signInError: err }
  }
}
