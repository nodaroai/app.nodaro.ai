/**
 * Guard: `FREE_GRANT_STATES` (TypeScript, `ee/billing/signup-grant.ts`) and the
 * `profiles.free_grant_state` CHECK constraint (Postgres) name EXACTLY the same
 * set.
 *
 * WHY. Both drift directions are silent in CI, because every unit test mocks
 * Supabase:
 *   • DB ⊃ TS — a state the database can hold that the code does not know.
 *     `asState` used to read an unknown value as its fallback, so an admin's
 *     'revoked' would have come back as 'unclaimed' — the state the balance
 *     read's fallback CLAIMS from. The admin list (`z.enum(FREE_GRANT_STATES)`)
 *     could not filter by it either.
 *   • TS ⊃ DB — a state the code writes that the CHECK rejects (23514): the
 *     write throws and the admin action answers a generic 500.
 *
 * The constraint was declared inline by 365 (three states) and re-declared by
 * 458 (adds 'revoked'). The NEWEST declaration is the deployed one, so the scan
 * walks every migration in apply order and the last one wins — a future
 * migration that adds a state is checked the same way without editing this
 * file; it only has to be at least 458.
 *
 * Also pinned, from 458's own functions:
 *   • every state literal any migration assigns to or compares
 *     `free_grant_state` against is in the vocabulary (a typo'd state in a
 *     function body is a check_violation only at runtime);
 *   • `free_grant_revocations.previous_state` admits exactly the states
 *     `revoke_signup_grant` takes back from — the restore returns the account
 *     to that state, and the take-back INSERTs it, so a revoke widened without
 *     the table would fail at runtime.
 */

import { readFileSync, readdirSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it, vi, beforeEach } from "vitest"

const { mockFrom } = vi.hoisted(() => ({ mockFrom: vi.fn() }))

vi.mock("@/lib/supabase.js", () => ({
  supabase: { from: (...args: unknown[]) => mockFrom(...args), rpc: vi.fn() },
}))
// Keep the billing surface out of a text-sync test.
vi.mock("@/ee/billing/credits.js", () => ({ CreditsService: { logTransaction: vi.fn() } }))

import { FREE_GRANT_STATES, readFreeGrant, readFreeGrantState } from "../ee/billing/signup-grant.js"

const MIGRATIONS_DIR = join(__dirname, "..", "..", "..", "supabase", "migrations")
const ADMIN_ACCESS_MIGRATION = "458_admin_access_blocks.sql"

const MIGRATION_FILES = readdirSync(MIGRATIONS_DIR)
  .filter((f) => /^\d+_.+\.sql$/.test(f))
  .sort((a, b) => Number.parseInt(a, 10) - Number.parseInt(b, 10) || a.localeCompare(b))

/** SQL with CRs and `--` comments removed (458's comments name states in prose). */
function sqlOf(file: string): string {
  return readFileSync(join(MIGRATIONS_DIR, file), "utf8").replace(/\r/g, "").replace(/--[^\n]*/g, "")
}

function quoted(list: string): string[] {
  return [...list.matchAll(/'([a-z0-9_]+)'/gi)].map((m) => m[1]!)
}

/** `CHECK (free_grant_state IN ( … ))` — the inline (365) and the ADD CONSTRAINT (458) form alike. */
const STATE_CHECK = /CHECK\s*\(\s*free_grant_state\s+IN\s*\(([^)]*)\)\s*\)/gi

interface Declaration {
  file: string
  values: string[]
}

function stateCheckDeclarations(): Declaration[] {
  const found: Declaration[] = []
  for (const file of MIGRATION_FILES) {
    for (const m of sqlOf(file).matchAll(STATE_CHECK)) found.push({ file, values: quoted(m[1]!) })
  }
  return found
}

const declarations = stateCheckDeclarations()
const deployed = declarations.at(-1)

describe("profiles.free_grant_state: FREE_GRANT_STATES ⇔ the deployed CHECK", () => {
  it(`finds the CHECK, and the newest declaration (${deployed?.file}) is migration 458 or later`, () => {
    expect(deployed, "no migration declares CHECK (free_grant_state IN (…))").toBeDefined()
    expect(declarations.map((d) => d.file)).toContain(ADMIN_ACCESS_MIGRATION)
    expect(Number.parseInt(deployed!.file, 10)).toBeGreaterThanOrEqual(458)
  })

  it("the CHECK admits exactly FREE_GRANT_STATES — no more, no less, no duplicates", () => {
    const db = deployed!.values
    const inDbNotInTs = db.filter((v) => !(FREE_GRANT_STATES as readonly string[]).includes(v))
    const inTsNotInDb = FREE_GRANT_STATES.filter((v) => !db.includes(v))

    expect(
      { inTsNotInDb, inDbNotInTs },
      `free_grant_state drifted: ${deployed!.file} declares {${[...db].sort().join(", ")}}, ` +
        `FREE_GRANT_STATES is {${[...FREE_GRANT_STATES].sort().join(", ")}}.`,
    ).toEqual({ inTsNotInDb: [], inDbNotInTs: [] })
    expect(new Set(db).size).toBe(db.length)
    expect(new Set(FREE_GRANT_STATES).size).toBe(FREE_GRANT_STATES.length)
  })

  it("'revoked' is one of them (migration 458's state)", () => {
    expect(FREE_GRANT_STATES).toContain("revoked")
    expect(deployed!.values).toContain("revoked")
  })

  it("every state literal a migration writes or compares free_grant_state against is in the vocabulary", () => {
    const seen = new Set<string>()
    const strays: string[] = []
    for (const file of MIGRATION_FILES) {
      for (const m of sqlOf(file).matchAll(/free_grant_state\s*(?:=|<>|!=)\s*'([a-z0-9_]+)'/gi)) {
        seen.add(m[1]!)
        if (!(FREE_GRANT_STATES as readonly string[]).includes(m[1]!)) strays.push(`${file}: '${m[1]}'`)
      }
    }
    expect(strays).toEqual([])
    // The scan is not vacuous: it reads 458's take-back write and the older claim/activate writes.
    expect([...seen].sort()).toEqual(expect.arrayContaining(["granted", "revoked", "unclaimed", "withheld"]))
  })

  it("free_grant_revocations.previous_state admits exactly the states revoke_signup_grant takes back from", () => {
    const sql = sqlOf(ADMIN_ACCESS_MIGRATION)
    const previous = /CHECK\s*\(\s*previous_state\s+IN\s*\(([^)]*)\)\s*\)/i.exec(sql)
    expect(previous, "free_grant_revocations.previous_state CHECK not found").not.toBeNull()

    const revokeBody = /FUNCTION\s+public\.revoke_signup_grant[\s\S]*?\$\$([\s\S]*?)\$\$/i.exec(sql)?.[1] ?? ""
    const takesFrom = /v_state\s+NOT\s+IN\s*\(([^)]*)\)/i.exec(revokeBody)
    expect(takesFrom, "revoke_signup_grant's source-state guard not found").not.toBeNull()

    const previousStates = quoted(previous![1]!).sort()
    expect(previousStates).toEqual(quoted(takesFrom![1]!).sort())
    for (const s of previousStates) expect(FREE_GRANT_STATES).toContain(s)
    // A take-back never records 'revoked' (or 'unclaimed') as where it came from.
    expect(previousStates).not.toContain("revoked")
    expect(previousStates).not.toContain("unclaimed")
  })
})

describe("reading free_grant_state accepts every state, 'revoked' included", () => {
  function profileRow(row: Record<string, unknown> | null, error: unknown = null) {
    const single = vi.fn().mockResolvedValue({ data: row, error })
    const eq = vi.fn().mockReturnValue({ single })
    const select = vi.fn().mockReturnValue({ eq })
    mockFrom.mockReturnValue({ select })
    return { select, eq, single }
  }

  beforeEach(() => {
    vi.clearAllMocks()
  })

  it("a 'revoked' row reads as 'revoked' — not as the 'unclaimed' the balance read claims from", async () => {
    const q = profileRow({ free_grant_state: "revoked", created_at: "2026-09-01T10:00:00.000Z" })

    await expect(readFreeGrant("u-1")).resolves.toEqual({
      state: "revoked",
      createdAt: new Date("2026-09-01T10:00:00.000Z"),
    })
    expect(mockFrom).toHaveBeenCalledWith("profiles")
    expect(q.select).toHaveBeenCalledWith("free_grant_state, created_at")
    expect(q.eq).toHaveBeenCalledWith("id", "u-1")
  })

  it.each([...FREE_GRANT_STATES])("'%s' round-trips through readFreeGrantState", async (state) => {
    profileRow({ free_grant_state: state, created_at: null })
    await expect(readFreeGrantState("u-1")).resolves.toBe(state)
  })

  it("a value outside the vocabulary still falls back to 'unclaimed'", async () => {
    profileRow({ free_grant_state: "bogus", created_at: null })
    await expect(readFreeGrantState("u-1")).resolves.toBe("unclaimed")
  })

  it("a failed read is null, not a state", async () => {
    profileRow(null, { code: "XX000", message: "boom" })
    await expect(readFreeGrantState("u-1")).resolves.toBeNull()
  })
})
