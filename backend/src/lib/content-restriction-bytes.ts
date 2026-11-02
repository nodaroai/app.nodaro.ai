/**
 * The bytes of a restriction (migration 583). Hiding the rows (581) and
 * holding them (582) leave the file where it is: a public address on the
 * content network, cached for a year, that whoever has the link keeps
 * seeing. So a restriction MOVES each of its keys under the evidence prefix
 * (`evidence/<restriction id>/<key>`, lib/evidence-keys.ts: a kept prefix,
 * refused by the proxies and the job gate, named by nothing but the
 * restriction's record) and asks the edge to drop its copies of the
 * address; a lift moves the bytes back and asks again.
 *
 * Best effort, after the record exists: a key that cannot move, or an edge
 * that cannot be asked, is written on the record (`bytes`), never a failure
 * of the restriction that already happened — the rows stay hidden and held
 * either way, and the record says what is left to do. What is left is done
 * by `finishRestrictionBytes` (lib/content-restrictions.ts): the
 * administrator's "finish" action, and the reconcile sweep
 * (lib/reconcile/restriction-bytes.ts) that runs it for every record whose
 * bytes are not where they should be.
 *
 * What is never moved: a key under a kept prefix (the deployment's own
 * files, another restriction's evidence), and a key the relay target owns
 * (lib/asset-delete.ts: those bytes are the hosted instance's). A key whose
 * relay ownership cannot be read is left where it is and recorded as
 * failed — "unknown" is not "ours". On a lift, a key another active
 * restriction still covers stays in evidence, deferred until that one is
 * lifted too.
 *
 * The record keeps both phases apart (`restrict`, `lift`), each written by
 * a merge on the row (`merge_restriction_bytes`), so a lift never erases
 * what the restriction recorded, and two writers never erase each other.
 * Every move is idempotent (lib/storage.ts `moveObject`), so a phase cut
 * short is finished by running it again.
 */
import { supabase } from "./supabase.js"
import { config } from "./config.js"
import { relayOwnedKeysStrict } from "./asset-delete.js"
import { keptStoragePrefix } from "./kept-storage-prefixes.js"
import { moveObjectToEvidence, restoreObjectFromEvidence, type ObjectMoveOutcome } from "./storage.js"
import { purgeEdgeUrls, type EdgePurgeOutcome } from "./edge-purge.js"

/**
 * `moved` / `restored`: done. `skipped`: nothing to do, ever (a kept prefix,
 * the relay target's bytes, nothing stored). `deferred`: not now — another
 * active restriction still covers the key, so its bytes stay in evidence
 * until that one is lifted too; the sweep tries again. `failed`: tried and
 * could not; the sweep tries again.
 */
export type RestrictionKeyState = "moved" | "restored" | "skipped" | "deferred" | "failed"

export interface RestrictionKeyRecord {
  readonly state: RestrictionKeyState
  readonly at: string
  /** For `skipped` and `deferred`: why. */
  readonly why?: string
  /** For `failed`: the error. */
  readonly error?: string
}

export interface RestrictionPurgeRecord {
  readonly status: EdgePurgeOutcome["status"]
  readonly at: string
  readonly error?: string
}

/** One phase's record: what happened to each key, and the edge purge after. */
export interface RestrictionBytesPhase {
  readonly keys: Readonly<Record<string, RestrictionKeyRecord>>
  readonly purge: RestrictionPurgeRecord
}

/** The `bytes` column: the restriction's phase, and the lift's once lifted. */
export interface RestrictionBytes {
  readonly restrict?: RestrictionBytesPhase
  readonly lift?: RestrictionBytesPhase
}

export interface RestrictionLike {
  readonly id: string
  readonly r2Keys: readonly string[]
  readonly liftedAt: string | null
  readonly bytes: RestrictionBytes
}

/** The public addresses of a key, on both schemes: the deployment's public base, and the fallback host where one is set. */
export function publicAddressesOf(key: string): string[] {
  const path = key.split("/").map(encodeURIComponent).join("/")
  const out: string[] = []
  const base = config.R2_PUBLIC_URL?.trim().replace(/\/+$/, "")
  if (base) {
    out.push(`${base}/${path}`)
    if (base.startsWith("https://")) out.push(`http://${base.slice("https://".length)}/${path}`)
  }
  const fallback = config.R2_PUBLIC_FALLBACK_DOMAIN?.trim()
  if (fallback) out.push(`https://${fallback}/${path}`, `http://${fallback}/${path}`)
  return out
}

/**
 * Whether a phase is complete: every key moved, restored or skipped, and the
 * edge purged — or not purgeable at all on this deployment (`not_configured`
 * is a fact about the deployment, not work left over; only `failed` is).
 */
export function phaseComplete(phase: RestrictionBytesPhase | undefined, keys: readonly string[]): boolean {
  if (!phase) return false
  const done = keys.every((key) => {
    const state = phase.keys[key]?.state
    return state === "moved" || state === "restored" || state === "skipped"
  })
  return done && phase.purge.status !== "failed"
}

/** Whether the record's bytes are where they should be, for its current side. */
export function bytesSettled(restriction: RestrictionLike): boolean {
  return phaseComplete(restriction.liftedAt ? restriction.bytes.lift : restriction.bytes.restrict, restriction.r2Keys)
}

function record(state: RestrictionKeyState, extra: { why?: string; error?: string } = {}): RestrictionKeyRecord {
  return { state, at: new Date().toISOString(), ...extra }
}

function recordOf(outcome: ObjectMoveOutcome, done: "moved" | "restored", earlier: RestrictionKeyRecord | undefined): RestrictionKeyRecord {
  if (outcome === "missing") return record("skipped", { why: "nothing was stored at the key" })
  // Found at the other end already: a phase run again. The earlier record of
  // this phase stands; a key the earlier run never moved is not "restored".
  if (outcome === "already_there" && earlier) return earlier
  return record(done)
}

async function moveEach(
  restriction: RestrictionLike,
  phase: "restrict" | "lift",
  move: (key: string) => Promise<ObjectMoveOutcome>,
  stays: (key: string) => { state: "skipped" | "deferred"; why: string } | null,
): Promise<Record<string, RestrictionKeyRecord>> {
  const keys = [...new Set(restriction.r2Keys)]
  const earlier = restriction.bytes[phase]?.keys ?? {}
  const done = phase === "restrict" ? "moved" : "restored"
  const out: Record<string, RestrictionKeyRecord> = {}
  for (const key of keys) {
    const kept = keptStoragePrefix(key)
    if (kept) {
      out[key] = record("skipped", { why: `under a kept prefix: ${kept.why}` })
      continue
    }
    const stay = stays(key)
    if (stay) {
      out[key] = record(stay.state, { why: stay.why })
      continue
    }
    try {
      out[key] = recordOf(await move(key), done, earlier[key])
    } catch (e) {
      const error = e instanceof Error ? e.message : String(e)
      console.error(`[content-restrictions] ${restriction.id}: the bytes of ${key} could not be ${done}:`, error)
      out[key] = record("failed", { error })
    }
  }
  return out
}

async function purgeOf(keys: readonly string[]): Promise<RestrictionPurgeRecord> {
  const outcome = await purgeEdgeUrls([...new Set(keys)].flatMap(publicAddressesOf))
  return { status: outcome.status, at: new Date().toISOString(), ...(outcome.status === "failed" ? { error: outcome.error } : {}) }
}

async function writePhase<T extends RestrictionLike>(restriction: T, phase: "restrict" | "lift", value: RestrictionBytesPhase): Promise<T> {
  const { error } = await supabase.rpc("merge_restriction_bytes", { p_id: restriction.id, p_patch: { [phase]: value } })
  if (error) console.error(`[content-restrictions] ${restriction.id}: the bytes' record could not be written:`, error.message)
  return { ...restriction, bytes: { ...restriction.bytes, [phase]: value } }
}

/** After a restriction: move every key's bytes to evidence, drop the edge's copies, record both. */
export async function relocateRestrictedBytes<T extends RestrictionLike>(restriction: T): Promise<T> {
  // "Unknown" is not "ours": a relay question that cannot be answered leaves every key where it is.
  let relayOwned: Set<string> | null
  try {
    relayOwned = await relayOwnedKeysStrict(restriction.r2Keys)
  } catch (e) {
    console.error(`[content-restrictions] ${restriction.id}: relay ownership could not be read:`, e instanceof Error ? e.message : e)
    relayOwned = null
  }
  const keys = relayOwned
    ? await moveEach(restriction, "restrict", (key) => moveObjectToEvidence(key, restriction.id), (key) => (relayOwned!.has(key) ? { state: "skipped", why: "the relay target owns the bytes" } : null))
    : failEvery(restriction.r2Keys, "relay ownership could not be read")
  const purge = await purgeOf(restriction.r2Keys)
  if (purge.status !== "done") console.warn(`[content-restrictions] ${restriction.id}: the edge was not purged (${purge.status}${purge.error ? `: ${purge.error}` : ""})`)
  return writePhase(restriction, "restrict", { keys, purge })
}

/**
 * The keys among `keys` that another ACTIVE restriction still covers: those
 * stay in evidence until it is lifted too (a lift of this record, run again
 * by the sweep, brings them back then). A complaint's hold is not asked: it
 * forbids deleting the bytes, and a move back to their key deletes nothing.
 */
async function coveredByAnotherRestriction(id: string, keys: readonly string[]): Promise<Set<string>> {
  if (keys.length === 0) return new Set()
  const { data, error } = await supabase
    .from("content_restrictions")
    .select("r2_keys")
    .is("lifted_at", null)
    .neq("id", id)
    .overlaps("r2_keys", [...keys])
  if (error) throw new Error(`the other restrictions could not be read: ${error.message}`)
  const covered = new Set<string>()
  for (const row of (data ?? []) as Array<{ r2_keys: string[] | null }>) for (const key of row.r2_keys ?? []) covered.add(key)
  return new Set(keys.filter((key) => covered.has(key)))
}

/** After a lift: move every key's bytes back unless another active restriction still covers it, drop the edge's copies (a cached miss), record both. */
export async function restoreRestrictedBytes<T extends RestrictionLike>(restriction: T): Promise<T> {
  let covered: Set<string> | null
  try {
    covered = await coveredByAnotherRestriction(restriction.id, restriction.r2Keys)
  } catch (e) {
    console.error(`[content-restrictions] ${restriction.id}:`, e instanceof Error ? e.message : e)
    covered = null
  }
  const keys = covered
    ? await moveEach(restriction, "lift", (key) => restoreObjectFromEvidence(key, restriction.id), (key) => (covered!.has(key) ? { state: "deferred", why: "another active restriction still covers the key" } : null))
    : failEvery(restriction.r2Keys, "the other restrictions could not be read")
  const purge = await purgeOf(restriction.r2Keys)
  return writePhase(restriction, "lift", { keys, purge })
}

function failEvery(keys: readonly string[], error: string): Record<string, RestrictionKeyRecord> {
  return Object.fromEntries([...new Set(keys)].map((key) => [key, record("failed", { error })]))
}
