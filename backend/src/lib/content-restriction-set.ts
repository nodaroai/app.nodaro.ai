/**
 * The active restrictions' keys (migration 581), read from the table once a
 * minute per server and held in memory between reads: the set the byte
 * proxies and the job gate ask. A light module on purpose (the database
 * client only), so a route or a worker that asks never loads the storage
 * client behind the restriction module.
 */
import { supabase } from "./supabase.js"

interface RestrictedSet {
  readonly keys: ReadonlySet<string>
  readonly readAt: number
}

/** How long one read of the set stays in force on this server. */
export const RESTRICTED_SET_TTL_MS = 60_000

/** One page of the active records; the read goes on until a page comes back short. */
const RESTRICTED_SET_PAGE = 500

let restrictedSet: RestrictedSet | null = null
let restrictedSetLoad: Promise<RestrictedSet> | null = null

async function readRestrictedSet(): Promise<RestrictedSet> {
  const keys = new Set<string>()
  for (let from = 0; ; from += RESTRICTED_SET_PAGE) {
    const { data, error } = await supabase
      .from("content_restrictions")
      .select("r2_keys")
      .is("lifted_at", null)
      .order("restricted_at", { ascending: true })
      .range(from, from + RESTRICTED_SET_PAGE - 1)
    if (error) throw new Error(`Restricted set read failed: ${error.message}`)
    const rows = (data ?? []) as Array<{ r2_keys: string[] | null }>
    for (const row of rows) for (const key of row.r2_keys ?? []) keys.add(key)
    if (rows.length < RESTRICTED_SET_PAGE) break
  }
  return { keys, readAt: Date.now() }
}

/** The active restrictions' keys, read again once a minute; the last set read stays in force when a read fails. */
export async function restrictedKeys(): Promise<ReadonlySet<string>> {
  if (restrictedSet && Date.now() - restrictedSet.readAt < RESTRICTED_SET_TTL_MS) return restrictedSet.keys
  if (!restrictedSetLoad) {
    restrictedSetLoad = readRestrictedSet()
      .then((set) => {
        restrictedSet = set
        return set
      })
      .finally(() => {
        restrictedSetLoad = null
      })
  }
  try {
    return (await restrictedSetLoad).keys
  } catch (e) {
    if (restrictedSet) {
      // The set read before stays in force for another minute, so a database
      // that is down is asked once a minute, not once a request.
      restrictedSet = { keys: restrictedSet.keys, readAt: Date.now() }
      return restrictedSet.keys
    }
    throw e
  }
}

/**
 * The set as this server knows it NOW, without waiting: the last set read
 * (refreshed in the background once it is a minute old), or nothing at all
 * on a server that has not read one yet, whose first read is started here.
 * The job gate asks this way so that no job insert, and no workflow run,
 * ever waits on — or hangs on — the restriction table: a job that slips
 * through in the milliseconds before a server's first read lands is the
 * same bounded staleness as the minute between reads.
 */
export function restrictedKeysNow(): ReadonlySet<string> {
  if (!restrictedSet || Date.now() - restrictedSet.readAt >= RESTRICTED_SET_TTL_MS) {
    void restrictedKeys().catch((e) => {
      console.error("[content-restrictions] the restricted set could not be read:", e instanceof Error ? e.message : e)
    })
  }
  return restrictedSet?.keys ?? EMPTY
}
const EMPTY: ReadonlySet<string> = new Set()

/** The next question reads the table again (after a restriction or a lift on this replica); the set read before stays in force until then. */
export function invalidateRestrictedSet(): void {
  if (restrictedSet) restrictedSet = { keys: restrictedSet.keys, readAt: 0 }
}

/** Tests swap the set between cases; production never calls this. */
export function __resetRestrictedSetForTests(): void {
  restrictedSet = null
  restrictedSetLoad = null
}
