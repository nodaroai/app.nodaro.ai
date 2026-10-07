/**
 * Test fixtures for "whose object does this storage url name"
 * (lib/key-ownership.ts `foreignStorageUrls`, decided 2026-10-07).
 *
 * The owner check reads `jobs` by id (a key's job family names its maker) and
 * `assets` by `r2_key` (a library row holds a key). `withStorageOwnerTables`
 * answers those two reads from in-memory rows and hands every other table to
 * the test's own client, so a stage's existing fake keeps working.
 */
import { config } from "../lib/config.js"

export const STORAGE_HOST = "https://media.test"
export const OWNER_ID = "00000000-0000-4000-8000-00000000a001"
export const VICTIM_ID = "00000000-0000-4000-8000-00000000b002"
export const OWNER_JOB_ID = "f0000000-0000-4000-8000-00000000a001"
export const VICTIM_JOB_ID = "f0000000-0000-4000-8000-00000000b002"

/** A url on our storage that the victim's job made. */
export const victimUrl = (name = "image", ext = "png"): string =>
  `${STORAGE_HOST}/${name}s/${VICTIM_JOB_ID}.${ext}`
/** A url on our storage that the owner's job made. */
export const ownerUrl = (name = "image", ext = "png", suffix = ""): string =>
  `${STORAGE_HOST}/${name}s/${OWNER_JOB_ID}${suffix}.${ext}`

type Row = Record<string, unknown>

export const STORAGE_OWNER_ROWS: Record<"jobs" | "assets", Row[]> = {
  jobs: [
    { id: OWNER_JOB_ID, user_id: OWNER_ID },
    { id: VICTIM_JOB_ID, user_id: VICTIM_ID },
  ],
  assets: [],
}

function ownerTable(rows: Row[]) {
  const filters: Array<(row: Row) => boolean> = []
  const chain = {
    select: () => chain,
    eq: (col: string, val: unknown) => {
      filters.push((row) => row[col] === val)
      return chain
    },
    in: (col: string, vals: unknown[]) => {
      filters.push((row) => vals.includes(row[col]))
      return chain
    },
    then: (resolve: (v: unknown) => void, reject?: (e: unknown) => void) =>
      Promise.resolve({ data: rows.filter((row) => filters.every((f) => f(row))), error: null }).then(resolve, reject),
  }
  return chain
}

/**
 * `client` with `jobs` and `assets` reads answered from `rows`. Every other
 * table, and every property the client has (`rpc`, test spies), is the
 * client's own.
 */
export function withStorageOwnerTables<T extends object>(client: T, rows = STORAGE_OWNER_ROWS): T {
  const inner = client as { from?: (table: string) => unknown }
  return new Proxy(client, {
    get(target, prop, receiver) {
      if (prop === "from") {
        return (table: string) =>
          table === "jobs" || table === "assets"
            ? ownerTable(rows[table])
            : inner.from?.(table)
      }
      return Reflect.get(target, prop, receiver)
    },
  })
}

/** Point `config.R2_PUBLIC_URL` at the test host; returns the restore. */
export function useStorageHost(): () => void {
  const saved = config.R2_PUBLIC_URL
  config.R2_PUBLIC_URL = STORAGE_HOST
  return () => {
    config.R2_PUBLIC_URL = saved
  }
}
