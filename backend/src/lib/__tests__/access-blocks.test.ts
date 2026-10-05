/**
 * The block snapshot (`lib/access-blocks.ts`): who is blocked — accounts and
 * networks — read once per process and shared by every check.
 *
 * What is pinned here, and why each one matters:
 *  - Paging. PostgREST stops an unpaged read at 1,000 rows WITHOUT an error,
 *    so a reader that stops early silently unblocks everyone past the cap.
 *  - The empty range list. `ipInAnyCidr` (the billing-key ALLOWLIST helper)
 *    reads an empty list as "any source"; a deny list built on it would refuse
 *    every address on earth the moment the only blocks are hashed ones.
 *  - Tables that are not there yet (staging runs days ahead of migration 458):
 *    "not ready, nothing blocked" — but only BEFORE the first good read. After
 *    one, a failing read keeps the last good list, so a database hiccup never
 *    lifts every block.
 *  - Freshness: a snapshot, not a read per request; an admin's own process
 *    sees a change at once (`invalidateAccessBlocks`), and a read that began
 *    BEFORE the admin's write cannot answer for it.
 *  - The reservation refusal speaks the reserve vocabulary (403
 *    `access_blocked`), the same answer the auth hook gives.
 *  - Community (no admin panel) never touches the tables.
 */
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

// ---------------------------------------------------------------------------
// A controllable PostgREST: `from(t).select().order().range()` for accounts,
// `from(t).select().gt().order().range()` for networks.
// ---------------------------------------------------------------------------

const db = vi.hoisted(() => {
  interface NetworkRow {
    network_hash: string | null
    cidr: string | null
    expires_at: string
  }
  interface Read {
    table: string
    columns?: string
    order?: string
    gt?: [string, string]
    from: number
    to: number
  }
  const state = {
    users: [] as string[],
    networks: [] as NetworkRow[],
    errors: new Map<string, { code?: string; message?: string }>(),
    /** When set, a read resolves only once this settles (its rows are still taken at call time). */
    hold: null as Promise<void> | null,
    /** A PostgREST `max-rows` below the page size: every answer is cut to this many rows. */
    maxRows: null as number | null,
    reads: [] as Read[],
  }
  function from(table: string) {
    const q: { columns?: string; order?: string; gt?: [string, string] } = {}
    const chain = {
      select(columns: string) {
        q.columns = columns
        return chain
      },
      gt(column: string, value: string) {
        q.gt = [column, value]
        return chain
      },
      order(column: string) {
        q.order = column
        return chain
      },
      range(first: number, last: number) {
        state.reads.push({ table, ...q, from: first, to: last })
        const error = state.errors.get(table) ?? null
        let rows: Array<Record<string, unknown>> =
          table === "account_blocks"
            ? state.users.map((user_id) => ({ user_id }))
            : state.networks.map((n) => ({ ...n }))
        if (q.gt) {
          const [column, value] = q.gt
          rows = rows.filter((r) => String(r[column]) > value)
        }
        // Taken NOW, at call time: a read that began before an admin's write
        // returns the list as it was, however late it resolves.
        const end = state.maxRows === null ? last + 1 : Math.min(last + 1, first + state.maxRows)
        const result = error ? { data: null, error } : { data: rows.slice(first, end), error: null }
        const hold = state.hold
        return hold ? hold.then(() => result) : Promise.resolve(result)
      },
    }
    return chain
  }
  return { state, from: vi.fn(from) }
})

const edition = vi.hoisted(() => ({ admin: true }))

vi.mock("../supabase.js", () => ({ supabase: { from: db.from } }))
vi.mock("../config.js", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../config.js")>()),
  hasAdmin: () => edition.admin,
}))

import {
  ACCESS_BLOCKED_BODY,
  __resetAccessBlocksForTests,
  accessBlocksStatus,
  blockedReservationRefusal,
  invalidateAccessBlocks,
  isAddressBlocked,
  isUserBlocked,
  refuseBlockedReservation,
} from "../access-blocks.js"
import { clientNetworkHash, networkHash } from "../client-address.js"
import { networkKey } from "../ip-address.js"
import { RESERVE_STATUS_BY_CODE, ReserveRpcError, mapReserveError } from "../reserve-errors.js"

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const NOW = Date.parse("2026-10-05T12:00:00.000Z")
const LIVE = new Date(NOW + 30 * 86_400_000).toISOString()
const EXPIRED = new Date(NOW - 60_000).toISOString()

const BLOCKED = "00000000-0000-4000-8000-0000000000b1"
const OTHER = "00000000-0000-4000-8000-0000000000c2"

function range(cidr: string, expires_at = LIVE) {
  return { network_hash: null, cidr, expires_at }
}

function hashed(hash: string, expires_at = LIVE) {
  return { network_hash: hash, cidr: null, expires_at }
}

/** The hash a free-grant signal writer stores for a caller at `address` — the
 *  value an admin's "block this account's signup network" copies into the list. */
function signupHash(address: string): string {
  return clientNetworkHash({ headers: { "x-forwarded-for": address } }, { unknownScope: OTHER })
}

function reads(table: string) {
  return db.state.reads.filter((r) => r.table === table)
}

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => {}
  const promise = new Promise<void>((r) => {
    resolve = r
  })
  return { promise, resolve }
}

/** Let a refresh started in the background (stale-while-refresh) finish. Only
 *  `Date` is faked, so this is a real macrotask: every microtask runs first. */
function settle(): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, 0))
}

beforeEach(() => {
  __resetAccessBlocksForTests()
  db.state.users = []
  db.state.networks = []
  db.state.errors.clear()
  db.state.hold = null
  db.state.maxRows = null
  db.state.reads = []
  db.from.mockClear()
  edition.admin = true
  vi.useFakeTimers({ toFake: ["Date"] })
  vi.setSystemTime(NOW)
})

afterEach(async () => {
  vi.useRealTimers()
  // Nothing a test started may land in the next one's snapshot.
  await settle()
})

// ---------------------------------------------------------------------------
// Accounts
// ---------------------------------------------------------------------------

describe("blocked accounts", () => {
  it("a blocked account is blocked; any other account is not", async () => {
    db.state.users = [BLOCKED]
    expect(await isUserBlocked(BLOCKED)).toBe(true)
    expect(await isUserBlocked(OTHER)).toBe(false)
  })

  it("no account id is never blocked, and costs no read", async () => {
    db.state.users = [BLOCKED]
    for (const id of [null, undefined, ""]) expect(await isUserBlocked(id)).toBe(false)
    expect(db.from).not.toHaveBeenCalled()
  })

  it("reads past PostgREST's 1,000-row cap — an account only on page 2 is blocked", async () => {
    // 1,001 rows: page 1 is EXACTLY full, which is where a reader that stops on
    // `length <= PAGE` (or reads once) silently drops everything after it.
    db.state.users = Array.from({ length: 1_001 }, (_, i) => `user-${String(i).padStart(4, "0")}`)
    expect(await isUserBlocked("user-1000")).toBe(true)
    expect(await isUserBlocked("user-0000")).toBe(true)
    // Only an EMPTY page ends the read; each page starts after the rows returned.
    expect(reads("account_blocks").map((r) => [r.from, r.to])).toEqual([
      [0, 999],
      [1000, 1999],
      [1001, 2000],
    ])
  })

  it("reads every row from a server that cuts pages short (a max-rows below 1,000)", async () => {
    // A reader that stops on the first page shorter than it asked for would
    // drop every block past the server's cap, without an error.
    db.state.maxRows = 500
    db.state.users = Array.from({ length: 1_200 }, (_, i) => `user-${String(i).padStart(4, "0")}`)
    expect(await isUserBlocked("user-1199")).toBe(true)
    expect(reads("account_blocks").map((r) => r.from)).toEqual([0, 500, 1000, 1200])
  })

  it("pages on a unique key, and reads only network blocks that have not expired", async () => {
    // Paging on a non-unique column can repeat or skip rows at a page edge.
    db.state.networks = [range("203.0.113.0/24", EXPIRED), range("198.51.100.0/24")]
    expect(await isAddressBlocked("203.0.113.9")).toBe(false)
    expect(await isAddressBlocked("198.51.100.9")).toBe(true)

    const [accounts] = reads("account_blocks")
    const [networks] = reads("blocked_networks")
    expect(accounts?.order).toBe("user_id")
    expect(networks?.order).toBe("id")
    expect(networks?.gt).toEqual(["expires_at", new Date(NOW).toISOString()])
  })
})

// ---------------------------------------------------------------------------
// Networks
// ---------------------------------------------------------------------------

describe("blocked networks", () => {
  it("a range blocks every address inside it and nothing outside (IPv4 and IPv6)", async () => {
    db.state.networks = [range("203.0.113.0/24"), range("2001:db8:abcd::/48")]
    expect(await isAddressBlocked("203.0.113.1")).toBe(true)
    expect(await isAddressBlocked("203.0.113.254")).toBe(true)
    expect(await isAddressBlocked("203.0.114.1")).toBe(false)
    expect(await isAddressBlocked("2001:db8:abcd:12::1")).toBe(true)
    expect(await isAddressBlocked("2001:db8:abce::1")).toBe(false)
  })

  it("a hashed network blocks the address it was recorded from — hashed the way the signal writers hash it", async () => {
    const address = "198.51.100.7"
    // One scheme, writer and reader: the stored signup hash IS networkHash(networkKey(address)).
    expect(signupHash(address)).toBe(networkHash(networkKey(address) ?? ""))
    db.state.networks = [hashed(signupHash(address))]
    expect(await isAddressBlocked(address)).toBe(true)
    expect(await isAddressBlocked("198.51.100.8")).toBe(false)
  })

  it("an IPv6 network is its /64: every address on that line is blocked, the next line is not", async () => {
    db.state.networks = [hashed(signupHash("2001:db8:1:2::7"))]
    expect(await isAddressBlocked("2001:db8:1:2:ffff:ffff:ffff:1")).toBe(true)
    expect(await isAddressBlocked("2001:db8:1:3::7")).toBe(false)
  })

  it("an empty range list matches NOTHING — never ipInAnyCidr's allowlist meaning", async () => {
    // Hash-only blocks compile an EMPTY range list. Read with the billing-key
    // allowlist semantics (empty = any source), every address would be refused.
    db.state.networks = [hashed(signupHash("198.51.100.7"))]
    expect(await isAddressBlocked("203.0.113.9")).toBe(false)
    expect(await isAddressBlocked("2001:db8::9")).toBe(false)

    __resetAccessBlocksForTests()
    db.state.networks = []
    expect(await isAddressBlocked("203.0.113.9")).toBe(false)
  })

  it("an address nobody knows is never blocked — not even by a block on every network", async () => {
    db.state.networks = [range("0.0.0.0/0"), range("::/0")]
    for (const unknown of [null, undefined, ""]) expect(await isAddressBlocked(unknown)).toBe(false)
    expect(await isAddressBlocked("not-an-address")).toBe(false)
    // …while the list itself is live:
    expect(await isAddressBlocked("192.0.2.1")).toBe(true)
    expect(await isAddressBlocked("2001:db8::1")).toBe(true)
  })

  it("reads every page of networks too", async () => {
    db.state.networks = [
      ...Array.from({ length: 1_000 }, (_, i) => hashed(i.toString(16).padStart(64, "0"))),
      range("203.0.113.0/24"),
    ]
    expect(await isAddressBlocked("203.0.113.9")).toBe(true)
    expect(reads("blocked_networks").map((r) => [r.from, r.to])).toEqual([
      [0, 999],
      [1000, 1999],
      [1001, 2000],
    ])
  })
})

// ---------------------------------------------------------------------------
// Before the tables exist, and when a read fails
// ---------------------------------------------------------------------------

describe("before migration 458 reaches the database", () => {
  it("a missing table means nothing is blocked yet — quietly — and the status says not ready", async () => {
    const warn = vi.spyOn(console, "warn")
    db.state.users = [BLOCKED]
    db.state.errors.set("account_blocks", { code: "42P01", message: 'relation "public.account_blocks" does not exist' })
    expect(await isUserBlocked(BLOCKED)).toBe(false)
    expect(await accessBlocksStatus()).toEqual({ ready: false, users: 0, networks: 0, loadedAt: null })
    expect(warn).not.toHaveBeenCalled()
    warn.mockRestore()
  })

  it("PostgREST's schema-cache miss (PGRST205) reads the same way", async () => {
    db.state.networks = [range("0.0.0.0/0")]
    db.state.errors.set("blocked_networks", { code: "PGRST205" })
    expect(await isAddressBlocked("192.0.2.1")).toBe(false)
    expect((await accessBlocksStatus()).ready).toBe(false)
  })

  it("is re-probed every 5 minutes, not per request — and enforced once the table exists", async () => {
    db.state.errors.set("account_blocks", { code: "42P01" })
    expect(await isUserBlocked(BLOCKED)).toBe(false)
    const probes = reads("account_blocks").length

    db.state.errors.clear()
    db.state.users = [BLOCKED] // the migration lands

    vi.setSystemTime(NOW + 5 * 60_000 - 1)
    expect(await isUserBlocked(BLOCKED)).toBe(false)
    expect(reads("account_blocks")).toHaveLength(probes)

    vi.setSystemTime(NOW + 5 * 60_000)
    await isUserBlocked(BLOCKED) // starts the re-probe
    await settle()
    expect(await isUserBlocked(BLOCKED)).toBe(true)
    expect((await accessBlocksStatus()).ready).toBe(true)
  })
})

describe("a read that fails", () => {
  it("after a good one keeps the last good list — a database hiccup lifts no block", async () => {
    db.state.users = [BLOCKED]
    db.state.networks = [range("203.0.113.0/24")]
    expect(await isUserBlocked(BLOCKED)).toBe(true)

    db.state.errors.set("account_blocks", { code: "08006", message: "connection failure" })
    vi.setSystemTime(NOW + 30_000)
    expect(await isUserBlocked(BLOCKED)).toBe(true) // answered from the snapshot while it re-reads
    await settle() // …and the re-read failed

    expect(reads("account_blocks").filter((r) => r.from === 0)).toHaveLength(2) // it really did try
    expect(await isUserBlocked(BLOCKED)).toBe(true)
    expect(await isAddressBlocked("203.0.113.9")).toBe(true)
  })

  it("a missing table AFTER a good load is a failure like any other, not 'nothing is blocked'", async () => {
    db.state.users = [BLOCKED]
    expect(await isUserBlocked(BLOCKED)).toBe(true)

    db.state.errors.set("account_blocks", { code: "42P01" })
    vi.setSystemTime(NOW + 30_000)
    await isUserBlocked(BLOCKED)
    await settle()

    expect(await isUserBlocked(BLOCKED)).toBe(true)
    expect((await accessBlocksStatus()).ready).toBe(true)
  })

  it("is retried 5 s later, not 30 s — and an unblock made meanwhile then lands", async () => {
    db.state.users = [BLOCKED]
    expect(await isUserBlocked(BLOCKED)).toBe(true)

    db.state.errors.set("account_blocks", { code: "08006" })
    vi.setSystemTime(NOW + 30_000)
    await isUserBlocked(BLOCKED)
    await settle() // failed at +30 s
    const tries = reads("account_blocks").length

    db.state.errors.clear()
    db.state.users = [] // an admin lifted the block meanwhile

    vi.setSystemTime(NOW + 34_999)
    await isUserBlocked(BLOCKED)
    await settle()
    expect(reads("account_blocks")).toHaveLength(tries)

    vi.setSystemTime(NOW + 35_000)
    await isUserBlocked(BLOCKED)
    await settle()
    expect(reads("account_blocks")).toHaveLength(tries + 1)
    expect(await isUserBlocked(BLOCKED)).toBe(false)
  })

  it("on the FIRST read (not a missing table) blocks nothing until a read succeeds, retried in 5 s", async () => {
    db.state.users = [BLOCKED]
    db.state.errors.set("account_blocks", { code: "57014", message: "canceling statement due to statement timeout" })
    expect(await isUserBlocked(BLOCKED)).toBe(false)

    db.state.errors.clear()
    vi.setSystemTime(NOW + 4_999)
    await isUserBlocked(BLOCKED)
    await settle()
    expect(reads("account_blocks")).toHaveLength(1)

    vi.setSystemTime(NOW + 5_000)
    await isUserBlocked(BLOCKED)
    await settle()
    expect(await isUserBlocked(BLOCKED)).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// Freshness
// ---------------------------------------------------------------------------

describe("refresh and invalidation", () => {
  it("a block made in ANOTHER process lands within one refresh — and no request reads the database before then", async () => {
    expect(await isUserBlocked(BLOCKED)).toBe(false)
    const readsAtLoad = db.from.mock.calls.length

    db.state.users = [BLOCKED] // blocked by an admin on another replica

    vi.setSystemTime(NOW + 29_999)
    for (let i = 0; i < 5; i++) expect(await isUserBlocked(BLOCKED)).toBe(false)
    expect(db.from.mock.calls.length).toBe(readsAtLoad) // a snapshot, not a read per request

    vi.setSystemTime(NOW + 30_000)
    await isUserBlocked(BLOCKED) // starts the refresh
    await settle()
    expect(await isUserBlocked(BLOCKED)).toBe(true)
  })

  it("invalidateAccessBlocks: the very next check in this process sees the new block — no 30 s wait", async () => {
    expect(await isUserBlocked(BLOCKED)).toBe(false)
    db.state.users = [BLOCKED]
    invalidateAccessBlocks()
    // No clock movement, no settle: the check itself waits for the re-read.
    expect(await isUserBlocked(BLOCKED)).toBe(true)
  })

  it("…and an unblock the same way", async () => {
    db.state.users = [BLOCKED]
    expect(await isUserBlocked(BLOCKED)).toBe(true)
    db.state.users = []
    invalidateAccessBlocks()
    expect(await isUserBlocked(BLOCKED)).toBe(false)
  })

  it("a read already running when the admin writes cannot answer for it — the invalidation queues a fresh one behind it", async () => {
    expect(await isUserBlocked(BLOCKED)).toBe(false)

    // A routine refresh starts and takes the list BEFORE the admin's write…
    vi.setSystemTime(NOW + 30_000)
    const gate = deferred()
    db.state.hold = gate.promise
    expect(await isUserBlocked(BLOCKED)).toBe(false)
    expect(reads("account_blocks")).toHaveLength(2) // that refresh is in flight

    // …the admin blocks the account and invalidates while it is still running…
    db.state.users = [BLOCKED]
    db.state.hold = null
    invalidateAccessBlocks()
    const answer = isUserBlocked(BLOCKED)

    // …and the stale refresh finishes with the OLD list. The answer must not be it.
    gate.resolve()
    expect(await answer).toBe(true)
  })

  it("concurrent first checks share ONE read (single flight)", async () => {
    db.state.users = [BLOCKED]
    const [a, b, c] = await Promise.all([
      isUserBlocked(BLOCKED),
      isUserBlocked(OTHER),
      isAddressBlocked("192.0.2.1"),
      accessBlocksStatus(),
    ])
    expect([a, b, c]).toEqual([true, false, false])
    // One load: its first page, once, for each table.
    expect(reads("account_blocks").filter((r) => r.from === 0)).toHaveLength(1)
    expect(reads("blocked_networks").filter((r) => r.from === 0)).toHaveLength(1)
  })

  it("the very first check waits for the first read — but never more than 3 s", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] })
    vi.setSystemTime(NOW)
    db.state.users = [BLOCKED]
    const gate = deferred()
    db.state.hold = gate.promise

    let answered = false
    const first = isUserBlocked(BLOCKED).then((v) => {
      answered = true
      return v
    })
    await vi.advanceTimersByTimeAsync(2_999)
    expect(answered).toBe(false) // it does wait for the first read…
    await vi.advanceTimersByTimeAsync(1)
    expect(await first).toBe(false) // …but not past 3 s: nothing is known yet, nothing is refused

    // The slow read still lands, for every later check.
    vi.useRealTimers()
    db.state.hold = null
    gate.resolve()
    await settle()
    expect(await isUserBlocked(BLOCKED)).toBe(true)
  })

  // While a read is in flight no refresh starts. Without a limit on the read,
  // one query that never answers froze the process on the list it had — and,
  // before any list, made every check wait its 3 s.
  it("a first read that never answers is given up after 10 s: checks stop waiting, and the next read runs", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] })
    vi.setSystemTime(NOW)
    db.state.users = [BLOCKED]
    db.state.hold = new Promise<void>(() => {}) // never answers

    const first = isUserBlocked(BLOCKED)
    await vi.advanceTimersByTimeAsync(3_000)
    expect(await first).toBe(false)

    await vi.advanceTimersByTimeAsync(7_000) // the read is now 10 s old: given up
    let answered = false
    const later = isUserBlocked(BLOCKED).then((v) => {
      answered = true
      return v
    })
    await vi.advanceTimersByTimeAsync(0)
    expect(answered).toBe(true) // no 3 s wait any more
    expect(await later).toBe(false)

    // Retried 5 s later, and that read is answered.
    db.state.hold = null
    await vi.advanceTimersByTimeAsync(5_000)
    expect(await isUserBlocked(BLOCKED)).toBe(false) // starts the retry
    await vi.advanceTimersByTimeAsync(0)
    expect(await isUserBlocked(BLOCKED)).toBe(true)
  })

  it("a refresh that never answers keeps the last list, and does not stop the refreshes after it", async () => {
    vi.useFakeTimers({ toFake: ["Date", "setTimeout", "clearTimeout"] })
    vi.setSystemTime(NOW)
    db.state.users = [BLOCKED]
    expect(await isUserBlocked(BLOCKED)).toBe(true)

    // 30 s on, a refresh starts and hangs; the last list keeps answering, at once.
    db.state.hold = new Promise<void>(() => {})
    await vi.advanceTimersByTimeAsync(30_000)
    expect(await isUserBlocked(BLOCKED)).toBe(true)

    // The admin unblocked meanwhile. 10 s later the hung read is given up, and
    // the retry 5 s after that carries the unblock.
    db.state.users = []
    db.state.hold = null
    await vi.advanceTimersByTimeAsync(10_000)
    expect(await isUserBlocked(BLOCKED)).toBe(true) // the last good list, still
    await vi.advanceTimersByTimeAsync(5_000)
    expect(await isUserBlocked(BLOCKED)).toBe(true) // starts the retry…
    await vi.advanceTimersByTimeAsync(0)
    expect(await isUserBlocked(BLOCKED)).toBe(false) // …which lands
  })
})

// ---------------------------------------------------------------------------
// The reservation refusal
// ---------------------------------------------------------------------------

describe("the reservation refusal", () => {
  it("refuseBlockedReservation throws what the reserve vocabulary reads as 403 access_blocked — the auth hook's own answer", async () => {
    db.state.users = [BLOCKED]
    const err = await refuseBlockedReservation(BLOCKED).then(
      () => null,
      (e: unknown) => e,
    )
    expect(err).toBeInstanceOf(ReserveRpcError)
    expect(mapReserveError(err)).toEqual({
      status: 403,
      code: ACCESS_BLOCKED_BODY.error.code,
      message: ACCESS_BLOCKED_BODY.error.message,
    })
    expect(ACCESS_BLOCKED_BODY.error.code).toBe("access_blocked")
    expect(RESERVE_STATUS_BY_CODE.access_blocked).toBe(403)
    // What a caller is shown is the fixed sentence, nothing else.
    expect((err as Error).message).toBe(ACCESS_BLOCKED_BODY.error.message)
  })

  it("lets an account that is not blocked through", async () => {
    db.state.users = [BLOCKED]
    await expect(refuseBlockedReservation(OTHER)).resolves.toBeUndefined()
    await expect(refuseBlockedReservation(null)).resolves.toBeUndefined()
  })

  it("blockedReservationRefusal gives the {ok:false} lanes the same refusal, and null otherwise", async () => {
    db.state.users = [BLOCKED]
    expect(await blockedReservationRefusal(BLOCKED)).toEqual({
      status: 403,
      code: "access_blocked",
      message: ACCESS_BLOCKED_BODY.error.message,
    })
    expect(await blockedReservationRefusal(OTHER)).toBeNull()
    expect(await blockedReservationRefusal(undefined)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// Status, and the edition gate
// ---------------------------------------------------------------------------

describe("accessBlocksStatus", () => {
  it("reports the size of both lists (hashes + ranges) and when they were read", async () => {
    db.state.users = [BLOCKED, OTHER]
    db.state.networks = [range("203.0.113.0/24"), range("2001:db8::/48"), hashed(signupHash("198.51.100.7"))]
    expect(await accessBlocksStatus()).toEqual({
      ready: true,
      users: 2,
      networks: 3,
      loadedAt: new Date(NOW).toISOString(),
    })
  })
})

describe("an edition without an admin panel (Community)", () => {
  it("never reads the tables and never blocks anyone", async () => {
    edition.admin = false
    db.state.users = [BLOCKED]
    db.state.networks = [range("0.0.0.0/0"), range("::/0")]

    expect(await isUserBlocked(BLOCKED)).toBe(false)
    expect(await isAddressBlocked("192.0.2.1")).toBe(false)
    await expect(refuseBlockedReservation(BLOCKED)).resolves.toBeUndefined()
    expect(await blockedReservationRefusal(BLOCKED)).toBeNull()
    invalidateAccessBlocks()
    expect(await accessBlocksStatus()).toEqual({ ready: false, users: 0, networks: 0, loadedAt: null })
    await settle()

    expect(db.from).not.toHaveBeenCalled()
  })
})
