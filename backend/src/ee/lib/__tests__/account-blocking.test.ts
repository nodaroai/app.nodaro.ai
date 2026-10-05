import { describe, it, expect, vi, beforeEach, afterEach } from "vitest"

/**
 * Blocking an account: who may not be blocked (`blockRefusal`), and how the
 * GoTrue sign-in ban is made to agree with the block row (`convergeSignInBan`).
 *
 * The ban is MARKED as ours (`app_metadata.nodaro_access_block = true`, set in
 * the SAME GoTrue update as the ban), and an unblock lifts only a marked ban —
 * a ban something else placed (an SSO de-provision, an operator by hand) is
 * never undone, and never adopted by a later block either.
 */

const fake = vi.hoisted(() => {
  type Filter = [op: "eq", column: string, value: unknown]
  interface Call {
    table: string
    action: "select" | "upsert" | "delete"
    columns: string | null
    values: unknown
    options: unknown
    filters: Filter[]
    returning: string | null
    terminal: "await" | "maybeSingle"
  }
  type Result = { data: unknown; error: unknown }
  interface AuthUser {
    id: string
    email?: string
    banned_until?: string | null
    app_metadata?: Record<string, unknown>
  }

  const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  /** Postgres compares `uuid` values, not their spelling. */
  const same = (a: unknown, b: unknown) =>
    typeof a === "string" && typeof b === "string" && UUID.test(a) && UUID.test(b)
      ? a.toLowerCase() === b.toLowerCase()
      : a === b

  const state = {
    calls: [] as Call[],
    profiles: [] as Array<{ id: string; email: string | null; role: string | null }>,
    blockRows: [] as Array<{ user_id: string }>,
    /** Per-table/action error to answer instead of the data. */
    errors: new Map<string, unknown>(),
    authUser: null as AuthUser | null,
    authGetError: null as unknown,
    authUpdateError: null as unknown,
  }

  function respond(call: Call): Result {
    state.calls.push(call)
    const error = state.errors.get(`${call.table}:${call.action}`)
    if (error) return { data: null, error }
    const match = (row: Record<string, unknown>) => call.filters.every(([, column, value]) => same(row[column], value))
    if (call.table === "profiles") {
      const rows = state.profiles.filter(match)
      return { data: rows[0] ?? null, error: null }
    }
    if (call.table === "account_blocks") {
      if (call.action === "select") return { data: state.blockRows.filter(match)[0] ?? null, error: null }
      if (call.action === "delete") {
        const removed = state.blockRows.filter(match)
        state.blockRows = state.blockRows.filter((r) => !match(r))
        return { data: removed, error: null }
      }
      return { data: null, error: null }
    }
    return { data: null, error: null }
  }

  function from(table: string) {
    const call: Call = {
      table,
      action: "select",
      columns: null,
      values: null,
      options: null,
      filters: [],
      returning: null,
      terminal: "await",
    }
    const builder: Record<string, unknown> = {
      select: (columns: string) => {
        if (call.action === "select") call.columns = columns
        else call.returning = columns
        return builder
      },
      upsert: (values: unknown, options?: unknown) => {
        call.action = "upsert"
        call.values = values
        call.options = options ?? null
        return builder
      },
      delete: () => {
        call.action = "delete"
        return builder
      },
      eq: (column: string, value: unknown) => {
        call.filters.push(["eq", column, value])
        return builder
      },
      maybeSingle: async () => {
        call.terminal = "maybeSingle"
        return respond(call)
      },
      then: (onFulfilled: (v: Result) => unknown, onRejected?: (e: unknown) => unknown) =>
        Promise.resolve()
          .then(() => respond(call))
          .then(onFulfilled, onRejected),
    }
    return builder
  }

  const getUserById = vi.fn(async (id: string) => {
    if (state.authGetError) return { data: { user: null }, error: state.authGetError }
    return { data: { user: state.authUser ? { ...state.authUser, id } : null }, error: null }
  })
  const updateUserById = vi.fn(async (_id: string, _attrs: Record<string, unknown>) => ({
    data: { user: null },
    error: state.authUpdateError,
  }))

  return { state, from, getUserById, updateUserById }
})

vi.mock("@/lib/supabase.js", () => ({
  supabase: {
    from: (table: string) => fake.from(table),
    auth: { admin: { getUserById: fake.getUserById, updateUserById: fake.updateUserById } },
  },
}))

/** `config.PLATFORM_OWNER_EMAIL` is parsed once at boot; a proxy lets each case set it without touching the real object. */
const owner = vi.hoisted(() => ({ email: "" }))
vi.mock("@/lib/config.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@/lib/config.js")>()
  return {
    ...actual,
    config: new Proxy(actual.config, {
      get: (target, prop, receiver) => (prop === "PLATFORM_OWNER_EMAIL" ? owner.email : Reflect.get(target, prop, receiver)),
    }),
  }
})

import {
  BAN_DURATION,
  BLOCK_BAN_MARKER,
  BlocksUnavailableError,
  blockRefusal,
  convergeSignInBan,
  deleteBlockRow,
  isBlockedNow,
  readSignInBan,
  writeBlockRow,
} from "../account-blocking.js"
import { __resetDeploymentPayerForTests, __setDeploymentPayerForTests } from "../../../lib/deployment-payer.js"

const ADMIN = "00000000-0000-4000-8000-0000000000a1"
const TARGET = "00000000-0000-4000-8000-0000000000b2"
const PAYER = "00000000-0000-4000-8000-0000000000c3"

const FAR_FUTURE = "2126-01-01T00:00:00.000Z"
const LONG_AGO = "2020-01-01T00:00:00.000Z"

const ENV_KEYS = ["PLATFORM_OPERATOR_EMAILS", "PLATFORM_OWNER_EMAIL"] as const
let savedEnv: Record<string, string | undefined> = {}

beforeEach(() => {
  vi.clearAllMocks()
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]))
  process.env.PLATFORM_OPERATOR_EMAILS = ""
  process.env.PLATFORM_OWNER_EMAIL = ""
  owner.email = ""
  fake.state.calls = []
  fake.state.profiles = [{ id: TARGET, email: "someone@example.test", role: "user" }]
  fake.state.blockRows = []
  fake.state.errors = new Map()
  fake.state.authUser = { id: TARGET, banned_until: null, app_metadata: {} }
  fake.state.authGetError = null
  fake.state.authUpdateError = null
})

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k]
    else process.env[k] = savedEnv[k]
  }
  __resetDeploymentPayerForTests()
})

function withTarget(fields: Partial<{ email: string | null; role: string | null }>) {
  fake.state.profiles = [{ id: TARGET, email: "someone@example.test", role: "user", ...fields }]
}

// ---------------------------------------------------------------------------
// blockRefusal
// ---------------------------------------------------------------------------

describe("blockRefusal", () => {
  it("an ordinary account may be blocked", async () => {
    await expect(blockRefusal(ADMIN, TARGET)).resolves.toBeNull()
    expect(fake.state.calls).toHaveLength(1)
    expect(fake.state.calls[0]).toMatchObject({ table: "profiles", filters: [["eq", "id", TARGET]] })
  })

  it("refuses the admin's own account, before reading anything", async () => {
    await expect(blockRefusal(ADMIN, ADMIN)).resolves.toBe("cannot_block_self")
    expect(fake.state.calls).toHaveLength(0)
  })

  it("refuses the deployment's billing account, before reading anything", async () => {
    __setDeploymentPayerForTests(PAYER)
    fake.state.profiles = [{ id: PAYER, email: "billing@customer.test", role: "user" }]
    await expect(blockRefusal(ADMIN, PAYER)).resolves.toBe("payer_account_protected")
    expect(fake.state.calls).toHaveLength(0)
  })

  it("an account that does not exist is not_found", async () => {
    fake.state.profiles = []
    await expect(blockRefusal(ADMIN, TARGET)).resolves.toBe("not_found")
  })

  // Postgres and GoTrue resolve an upper-case uuid to the same account, so a
  // string comparison that minds the case could be dodged by retyping the id.
  it("refuses the billing account whatever case its id is written in", async () => {
    __setDeploymentPayerForTests(PAYER)
    await expect(blockRefusal(ADMIN, PAYER.toUpperCase())).resolves.toBe("payer_account_protected")
    __setDeploymentPayerForTests(PAYER.toUpperCase())
    await expect(blockRefusal(ADMIN, PAYER)).resolves.toBe("payer_account_protected")
    expect(fake.state.calls).toHaveLength(0)
  })

  it("refuses the admin's own account whatever case its id is written in", async () => {
    await expect(blockRefusal(ADMIN, ADMIN.toUpperCase())).resolves.toBe("cannot_block_self")
    expect(fake.state.calls).toHaveLength(0)
  })

  it("reads the profile by the lower-case id", async () => {
    await expect(blockRefusal(ADMIN, TARGET.toUpperCase())).resolves.toBeNull()
    expect(fake.state.calls[0]).toMatchObject({ table: "profiles", filters: [["eq", "id", TARGET.toLowerCase()]] })
  })

  it.each(["admin", "super_admin"])("refuses a target whose role is %s", async (role) => {
    withTarget({ role })
    await expect(blockRefusal(ADMIN, TARGET)).resolves.toBe("target_is_admin")
  })

  it("a profile with no role is an ordinary user", async () => {
    withTarget({ role: null })
    await expect(blockRefusal(ADMIN, TARGET)).resolves.toBeNull()
  })

  it("refuses a platform operator — the comparison ignores case and surrounding space", async () => {
    process.env.PLATFORM_OPERATOR_EMAILS = "ops@nodaro.test, Second@Nodaro.test"
    withTarget({ email: "  SECOND@nodaro.TEST " })
    await expect(blockRefusal(ADMIN, TARGET)).resolves.toBe("target_protected")
  })

  it("refuses the platform owner (config) even when the operator list names other people", async () => {
    // With PLATFORM_OPERATOR_EMAILS set, platformOperatorEmails() no longer
    // falls back to the owner — blockRefusal adds the owner itself.
    process.env.PLATFORM_OPERATOR_EMAILS = "ops@nodaro.test"
    owner.email = " Owner@Nodaro.test "
    withTarget({ email: "owner@nodaro.test" })
    await expect(blockRefusal(ADMIN, TARGET)).resolves.toBe("target_protected")
  })

  it("refuses the platform owner through the operator fallback when no operator list is set", async () => {
    process.env.PLATFORM_OWNER_EMAIL = "owner@nodaro.test"
    withTarget({ email: "Owner@Nodaro.test" })
    await expect(blockRefusal(ADMIN, TARGET)).resolves.toBe("target_protected")
  })

  it("an account with no email is never mistaken for a protected one", async () => {
    process.env.PLATFORM_OPERATOR_EMAILS = "ops@nodaro.test"
    owner.email = "owner@nodaro.test"
    withTarget({ email: null })
    await expect(blockRefusal(ADMIN, TARGET)).resolves.toBeNull()
  })

  it("throws when the profile read fails (the route answers a sanitized 500, never a block)", async () => {
    const error = { code: "XX000", message: "boom" }
    fake.state.errors.set("profiles:select", error)
    await expect(blockRefusal(ADMIN, TARGET)).rejects.toBe(error)
  })
})

// ---------------------------------------------------------------------------
// convergeSignInBan
// ---------------------------------------------------------------------------

describe("convergeSignInBan", () => {
  const blockRow = () => {
    fake.state.blockRows = [{ user_id: TARGET }]
  }
  const authUser = (banned_until: string | null, app_metadata: Record<string, unknown> = {}) => {
    fake.state.authUser = { id: TARGET, banned_until, app_metadata }
  }

  it("uses GoTrue's permanent-ban idiom and its own marker key", () => {
    expect(BAN_DURATION).toBe("876000h")
    expect(BLOCK_BAN_MARKER).toBe("nodaro_access_block")
  })

  describe("a block row is present", () => {
    it("not banned → bans AND marks the ban as ours, in ONE GoTrue update", async () => {
      blockRow()
      authUser(null)

      await expect(convergeSignInBan(TARGET)).resolves.toEqual({ signInBlocked: true, ours: true })
      expect(fake.updateUserById).toHaveBeenCalledTimes(1)
      expect(fake.updateUserById).toHaveBeenCalledWith(TARGET, {
        ban_duration: "876000h",
        app_metadata: { nodaro_access_block: true },
      })
      expect(fake.state.calls[0]).toMatchObject({
        table: "account_blocks",
        action: "select",
        filters: [["eq", "user_id", TARGET]],
      })
    })

    it("a ban that has run out counts as no ban → banned again", async () => {
      blockRow()
      authUser(LONG_AGO, { [BLOCK_BAN_MARKER]: true })

      await expect(convergeSignInBan(TARGET)).resolves.toEqual({ signInBlocked: true, ours: true })
      expect(fake.updateUserById).toHaveBeenCalledWith(TARGET, {
        ban_duration: "876000h",
        app_metadata: { nodaro_access_block: true },
      })
    })

    it("already banned by a block → nothing to do", async () => {
      blockRow()
      authUser(FAR_FUTURE, { [BLOCK_BAN_MARKER]: true })

      await expect(convergeSignInBan(TARGET)).resolves.toEqual({ signInBlocked: true, ours: true })
      expect(fake.updateUserById).not.toHaveBeenCalled()
    })

    it("already banned by something else → left as it is, NOT re-marked as ours", async () => {
      blockRow()
      authUser(FAR_FUTURE, { sso: null })

      await expect(convergeSignInBan(TARGET)).resolves.toEqual({ signInBlocked: true, ours: false })
      expect(fake.updateUserById).not.toHaveBeenCalled()
    })

    it("a failed ban throws (the route reports it as a warning)", async () => {
      blockRow()
      authUser(null)
      const error = { message: "gotrue down", status: 500 }
      fake.state.authUpdateError = error

      await expect(convergeSignInBan(TARGET)).rejects.toBe(error)
    })
  })

  describe("no block row", () => {
    it("banned by a block → the ban and the marker are lifted", async () => {
      authUser(FAR_FUTURE, { [BLOCK_BAN_MARKER]: true })

      await expect(convergeSignInBan(TARGET)).resolves.toEqual({ signInBlocked: false, ours: false })
      expect(fake.updateUserById).toHaveBeenCalledTimes(1)
      expect(fake.updateUserById).toHaveBeenCalledWith(TARGET, {
        ban_duration: "none",
        app_metadata: { nodaro_access_block: null },
      })
    })

    it("banned WITHOUT our marker (an SSO de-provision, an operator) → never lifted", async () => {
      authUser(FAR_FUTURE, { sso: null, sso_subject: null })

      await expect(convergeSignInBan(TARGET)).resolves.toEqual({ signInBlocked: true, ours: false })
      expect(fake.updateUserById).not.toHaveBeenCalled()
    })

    it("only the boolean true is our marker — a string 'true' is somebody else's ban", async () => {
      authUser(FAR_FUTURE, { [BLOCK_BAN_MARKER]: "true" })

      await expect(convergeSignInBan(TARGET)).resolves.toEqual({ signInBlocked: true, ours: false })
      expect(fake.updateUserById).not.toHaveBeenCalled()
    })

    it("not banned → nothing to do, even with a stale marker", async () => {
      authUser(null, { [BLOCK_BAN_MARKER]: true })

      await expect(convergeSignInBan(TARGET)).resolves.toEqual({ signInBlocked: false, ours: false })
      expect(fake.updateUserById).not.toHaveBeenCalled()
    })

    it("a failed lift throws", async () => {
      authUser(FAR_FUTURE, { [BLOCK_BAN_MARKER]: true })
      const error = { message: "gotrue down", status: 500 }
      fake.state.authUpdateError = error

      await expect(convergeSignInBan(TARGET)).rejects.toBe(error)
    })
  })

  it("throws when the block row cannot be read — converging on a guess could lift a real block", async () => {
    const error = { code: "XX000", message: "boom" }
    fake.state.errors.set("account_blocks:select", error)

    await expect(convergeSignInBan(TARGET)).rejects.toBe(error)
    expect(fake.getUserById).not.toHaveBeenCalled()
    expect(fake.updateUserById).not.toHaveBeenCalled()
  })

  it("throws when GoTrue cannot read the account", async () => {
    blockRow()
    const error = { message: "not found", status: 404 }
    fake.state.authGetError = error

    await expect(convergeSignInBan(TARGET)).rejects.toBe(error)
    expect(fake.updateUserById).not.toHaveBeenCalled()
  })

  it("throws when GoTrue answers no user", async () => {
    blockRow()
    fake.state.authUser = null

    await expect(convergeSignInBan(TARGET)).rejects.toThrow()
    expect(fake.updateUserById).not.toHaveBeenCalled()
  })
})

// ---------------------------------------------------------------------------
// readSignInBan
// ---------------------------------------------------------------------------

describe("isBlockedNow — a fresh read for the role route", () => {
  it("true when the account has a block row, false when it has none", async () => {
    fake.state.blockRows = [{ user_id: TARGET }]
    await expect(isBlockedNow(TARGET)).resolves.toBe(true)
    await expect(isBlockedNow(ADMIN)).resolves.toBe(false)
  })

  it("finds the block whatever case the id is written in (a uuid is compared by value)", async () => {
    fake.state.blockRows = [{ user_id: TARGET }]
    await expect(isBlockedNow(TARGET.toUpperCase())).resolves.toBe(true)
  })

  it.each(["42P01", "PGRST205"])("false before the table exists (%s) — staging runs ahead of migration 458", async (code) => {
    fake.state.errors.set("account_blocks:select", { code, message: "relation does not exist" })
    await expect(isBlockedNow(TARGET)).resolves.toBe(false)
  })

  it("throws any other read error rather than answering \"not blocked\"", async () => {
    const error = { code: "08006", message: "connection failure" }
    fake.state.errors.set("account_blocks:select", error)
    await expect(isBlockedNow(TARGET)).rejects.toBe(error)
  })
})

describe("readSignInBan", () => {
  it.each([
    ["banned by a block", FAR_FUTURE, { [BLOCK_BAN_MARKER]: true }, { signInBlocked: true, ours: true }],
    ["banned by something else", FAR_FUTURE, {}, { signInBlocked: true, ours: false }],
    ["a ban that ran out, still marked", LONG_AGO, { [BLOCK_BAN_MARKER]: true }, { signInBlocked: false, ours: false }],
    ["never banned", null, {}, { signInBlocked: false, ours: false }],
  ])("%s", async (_label, bannedUntil, metadata, expected) => {
    fake.state.authUser = { id: TARGET, banned_until: bannedUntil, app_metadata: metadata }
    await expect(readSignInBan(TARGET)).resolves.toEqual(expected)
  })

  it("null when GoTrue cannot read the account (the panel shows unknown, not 'not banned')", async () => {
    fake.state.authGetError = { message: "boom" }
    await expect(readSignInBan(TARGET)).resolves.toBeNull()
  })
})

// ---------------------------------------------------------------------------
// writeBlockRow / deleteBlockRow
// ---------------------------------------------------------------------------

describe("writeBlockRow", () => {
  it("inserts on user_id and leaves an existing row alone — a repeat block keeps the original reason, admin and time", async () => {
    await writeBlockRow(TARGET, ADMIN, "chargeback farm")

    const call = fake.state.calls.find((c) => c.table === "account_blocks")!
    expect(call.action).toBe("upsert")
    expect(call.values).toEqual({ user_id: TARGET, reason: "chargeback farm", blocked_by: ADMIN })
    expect(call.values).not.toHaveProperty("created_at")
    // "Block again" (finishing a failed sign-in step) sends no reason: an
    // overwrite would erase the first admin's reason and name the retrier.
    expect(call.options).toEqual({ onConflict: "user_id", ignoreDuplicates: true })
  })

  it.each(["42P01", "PGRST205"])("a missing table (%s) is BlocksUnavailableError", async (code) => {
    fake.state.errors.set("account_blocks:upsert", { code, message: "relation does not exist" })
    await expect(writeBlockRow(TARGET, ADMIN, null)).rejects.toBeInstanceOf(BlocksUnavailableError)
  })

  it("any other error is thrown as it is", async () => {
    const error = { code: "23503", message: "fk violation" }
    fake.state.errors.set("account_blocks:upsert", error)
    await expect(writeBlockRow(TARGET, ADMIN, null)).rejects.toBe(error)
  })
})

describe("deleteBlockRow", () => {
  it("true when a row was removed — by user id, asking for the removed rows back", async () => {
    fake.state.blockRows = [{ user_id: TARGET }]
    await expect(deleteBlockRow(TARGET)).resolves.toBe(true)

    const call = fake.state.calls.find((c) => c.table === "account_blocks")!
    expect(call).toMatchObject({ action: "delete", filters: [["eq", "user_id", TARGET]], returning: "user_id" })
    expect(fake.state.blockRows).toEqual([])
  })

  it("false when there was nothing to remove", async () => {
    await expect(deleteBlockRow(TARGET)).resolves.toBe(false)
  })

  it.each(["42P01", "PGRST205"])("a missing table (%s) is BlocksUnavailableError", async (code) => {
    fake.state.errors.set("account_blocks:delete", { code, message: "relation does not exist" })
    await expect(deleteBlockRow(TARGET)).rejects.toBeInstanceOf(BlocksUnavailableError)
  })

  it("any other error is thrown as it is", async () => {
    const error = { code: "XX000", message: "boom" }
    fake.state.errors.set("account_blocks:delete", error)
    await expect(deleteBlockRow(TARGET)).rejects.toBe(error)
  })
})
