/**
 * Guards on the organizations foundations migration — the invariants that
 * are cheap to prove from the SQL text and expensive to discover in
 * production:
 *
 *   1. The SQL `kind_preset()` literal equals the pinned preset table below.
 *      The server-side TypeScript copy is pinned to the same literal in its
 *      own repo; until a cross-repo parity job exists, each side guards
 *      itself against an accidental edit.
 *   2. Every SECURITY DEFINER function pins search_path and is revoked from
 *      PUBLIC *and* anon; RLS-facing helpers are granted to authenticated,
 *      mutating RPCs only to service_role (the anonymous-oracle gap).
 *   3. Every table the migration creates has RLS enabled, has SELECT as its
 *      only client policy (writes are service-role only), and is declared a
 *      tenant table in check-tenant-scope.mjs.
 *   4. The CHECK enums equal the wire-contract enums in @nodaro/shared, so a
 *      value the API accepts is a value the database accepts.
 *   5. The join-code CHECK is the pinned format; the invitation guard covers
 *      UPDATE; the transfer RPC demotes before it promotes.
 */
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"
import { MEMBER_STATUSES, ORG_KINDS, ORG_ROLES, ORG_STATUSES, WORKSPACE_ROLES } from "@nodaro/shared"

const REPO_ROOT = join(__dirname, "..", "..", "..")
const MIGRATION = readFileSync(join(REPO_ROOT, "supabase/migrations/332_orgs_foundations.sql"), "utf8")
const TENANT_SCOPE_SCRIPT = readFileSync(join(REPO_ROOT, "backend/scripts/check-tenant-scope.mjs"), "utf8")

const sql = MIGRATION.replace(/--[^\n]*/g, "")

// Tolerant on purpose: a table created without IF NOT EXISTS must still be
// seen by every per-table guard below (the idempotency linter owns that rule).
const createdTables = [...sql.matchAll(/CREATE TABLE (?:IF NOT EXISTS )?(?:public\.)?(\w+)/g)].map((m) => m[1])

/** The CREATE TABLE block for one table (up to the next CREATE TABLE / statement run). */
function tableBlock(table: string): string {
  const start = sql.indexOf(`CREATE TABLE IF NOT EXISTS ${table} (`)
  expect(start, `table ${table} not found`).toBeGreaterThanOrEqual(0)
  const end = sql.indexOf("\n);", start)
  return sql.slice(start, end)
}

/** Values of a `col ... CHECK (col IN ('a','b'))` constraint inside a table block. */
function checkValues(block: string, column: string): string[] {
  const m = block.match(new RegExp(`\\b${column}\\s+text[^\\n]*CHECK \\(${column} IN \\(([^)]+)\\)\\)`))
  expect(m, `no CHECK list for ${column}`).toBeTruthy()
  return [...m![1].matchAll(/'([a-z_]+)'/g)].map((x) => x[1]).sort()
}

/** Pinned: the kind presets as the migration must define them. */
const EXPECTED_KIND_PRESETS = {
  school: {
    admin_access: "edit",
    default_workflow_visibility: "private",
    member_access_to_shared: "view",
    members_can_create_projects: false,
    member_caps_enabled: true,
    personal_space_enabled: true,
    workspace_admins_can_invite: true,
    collaborators_can_invite: false,
  },
  team: {
    admin_access: "view",
    default_workflow_visibility: "workspace",
    member_access_to_shared: "edit",
    members_can_create_projects: true,
    member_caps_enabled: false,
    personal_space_enabled: true,
    workspace_admins_can_invite: true,
    collaborators_can_invite: true,
  },
} as const

/** Pinned: 8 chars of Crockford base32 minus vowels. */
const EXPECTED_JOIN_CODE_PATTERN = "^[0-9BCDFGHJKMNPQRSTVWXYZ]{8}$"

describe("332_orgs_foundations — kind_preset literal", () => {
  it("each kind's SQL literal deep-equals the pinned preset", () => {
    for (const kind of ["school", "team"] as const) {
      const m = sql.match(new RegExp(`WHEN '${kind}'\\s+THEN\\s+'(\\{[^']*\\})'::jsonb`))
      expect(m, `kind_preset() has no '${kind}' branch`).toBeTruthy()
      expect(JSON.parse(m![1])).toEqual(EXPECTED_KIND_PRESETS[kind])
    }
  })
})

/** RLS-facing helpers: callable by signed-in users (and the service role). */
const AUTHENTICATED_HELPERS = ["effective_setting", "org_member_status", "org_role", "workspace_member_status", "workspace_role", "ws_setting_bool"]
/** Mutating RPCs: the route authorizes, so clients must not reach them at all. */
const SERVICE_ROLE_ONLY = ["transfer_org_ownership"]

describe("332_orgs_foundations — SECURITY DEFINER functions have explicit grants", () => {
  const chunks = sql.split(/CREATE OR REPLACE FUNCTION\s+/).slice(1)
  const fns = chunks
    .map((chunk) => {
      const header = chunk.slice(0, chunk.indexOf("$$"))
      const name = chunk.match(/^(\w+)\s*\(/)?.[1] ?? ""
      const args = chunk.match(/^\w+\s*\(([^)]*)\)/)?.[1] ?? ""
      const returnsTrigger = /RETURNS\s+trigger/i.test(header)
      const definer = /SECURITY DEFINER/i.test(header)
      const pinsSearchPath = /SET search_path = public/.test(header)
      return { name, args, returnsTrigger, definer, pinsSearchPath }
    })
    .filter((f) => f.definer)

  const signature = (fn: { name: string; args: string }) => {
    const argTypes = fn.args
      .split(",")
      .map((a) => a.trim().split(/\s+/)[1])
      .join(", ")
    const sig = `public.${fn.name}(${argTypes})`
    return { sig, escaped: sig.replace(/[.()]/g, "\\$&") }
  }

  it("every SECURITY DEFINER function pins search_path", () => {
    expect(fns.filter((f) => !f.pinsSearchPath).map((f) => f.name)).toEqual([])
  })

  it("every non-trigger SECURITY DEFINER function is classified", () => {
    expect(fns.filter((f) => !f.returnsTrigger).map((f) => f.name).sort()).toEqual([...AUTHENTICATED_HELPERS, ...SERVICE_ROLE_ONLY].sort())
  })

  it.each(fns.filter((f) => AUTHENTICATED_HELPERS.includes(f.name)).map((f) => [f.name, f] as const))(
    "%s — REVOKE FROM PUBLIC, REVOKE FROM anon, GRANT TO authenticated",
    (_name, fn) => {
      const { sig, escaped } = signature(fn)
      expect(sql, `${sig} must be revoked from PUBLIC`).toMatch(new RegExp(`REVOKE EXECUTE ON FUNCTION ${escaped} FROM PUBLIC;`))
      expect(sql, `${sig} must be revoked from anon`).toMatch(new RegExp(`REVOKE EXECUTE ON FUNCTION ${escaped} FROM anon;`))
      expect(sql, `${sig} must be granted to authenticated`).toMatch(new RegExp(`GRANT\\s+EXECUTE ON FUNCTION ${escaped} TO authenticated;`))
    },
  )

  it.each(fns.filter((f) => SERVICE_ROLE_ONLY.includes(f.name)).map((f) => [f.name, f] as const))(
    "%s — REVOKE FROM PUBLIC, anon AND authenticated; GRANT TO service_role only",
    (_name, fn) => {
      const { sig, escaped } = signature(fn)
      for (const role of ["PUBLIC", "anon", "authenticated"]) {
        expect(sql, `${sig} must be revoked from ${role}`).toMatch(new RegExp(`REVOKE EXECUTE ON FUNCTION ${escaped} FROM ${role};`))
      }
      expect(sql, `${sig} must be granted to service_role`).toMatch(new RegExp(`GRANT\\s+EXECUTE ON FUNCTION ${escaped} TO service_role;`))
      expect(sql, `${sig} must NOT be granted to authenticated`).not.toMatch(new RegExp(`GRANT\\s+EXECUTE ON FUNCTION ${escaped} TO authenticated;`))
    },
  )

  it("effective_setting gates on membership (SECURITY DEFINER bypasses the table RLS)", () => {
    const body = sql.slice(sql.indexOf("FUNCTION effective_setting"), sql.indexOf("FUNCTION ws_setting_bool"))
    expect(body).toMatch(/auth\.uid\(\) IS NULL OR is_admin\(\) OR workspace_role\(p_workspace_id\) IS NOT NULL/)
    expect(body).toMatch(/NULLIF\(settings -> p_key, 'null'::jsonb\)/)
  })
})

describe("332_orgs_foundations — every new table", () => {
  it("was found", () => {
    expect(createdTables.sort()).toEqual(
      ["invitations", "organization_audit_log", "organization_members", "organizations", "workspace_join_codes", "workspace_members", "workspaces"].sort(),
    )
  })

  it.each(createdTables)("%s — has RLS enabled", (table) => {
    expect(sql).toMatch(new RegExp(`ALTER TABLE ${table}\\s+ENABLE ROW LEVEL SECURITY;`))
  })

  it.each(createdTables)("%s — exposes SELECT only to clients (writes are service-role only)", (table) => {
    // Whole statements, command derived from the FOR clause — a policy with no
    // FOR clause is FOR ALL in Postgres and must be caught as a write.
    const stmts = [...sql.matchAll(new RegExp(`CREATE\\s+POLICY\\s+\\w+\\s+ON\\s+(?:public\\.)?${table}\\b([\\s\\S]*?);`, "gi"))]
    const commands = stmts.map((m) => (m[1].match(/\bFOR\s+(\w+)/i)?.[1] ?? "ALL").toUpperCase())
    expect(commands, `${table} needs exactly one client policy, a SELECT`).toEqual(["SELECT"])
  })

  it.each(createdTables)("%s — is declared in check-tenant-scope.mjs TENANT_TABLES", (table) => {
    expect(TENANT_SCOPE_SCRIPT).toMatch(new RegExp(`^\\s*"${table}",\\s*$`, "m"))
  })
})

describe("332_orgs_foundations — CHECK enums equal the wire contract", () => {
  it("organizations.kind / status", () => {
    const block = tableBlock("organizations")
    expect(checkValues(block, "kind")).toEqual([...ORG_KINDS].sort())
    expect(checkValues(block, "status")).toEqual([...ORG_STATUSES].sort())
  })

  it("organization_members.role / status", () => {
    const block = tableBlock("organization_members")
    expect(checkValues(block, "role")).toEqual([...ORG_ROLES].sort())
    expect(checkValues(block, "status")).toEqual([...MEMBER_STATUSES].sort())
  })

  it("workspace_members.role / status", () => {
    const block = tableBlock("workspace_members")
    expect(checkValues(block, "role")).toEqual([...WORKSPACE_ROLES].sort())
    expect(checkValues(block, "status")).toEqual([...MEMBER_STATUSES].sort())
  })

  it("invitations.org_role is the non-owner subset; workspace_role the workspace roles", () => {
    const block = tableBlock("invitations")
    expect(checkValues(block, "org_role")).toEqual(ORG_ROLES.filter((r) => r !== "owner").sort())
    expect(checkValues(block, "workspace_role")).toEqual([...WORKSPACE_ROLES].sort())
  })
})

describe("332_orgs_foundations — approval gate", () => {
  it("organizations default to pending and the status CHECK allows it", () => {
    expect(sql).toMatch(/status\s+text NOT NULL DEFAULT 'pending' CHECK \(status IN \('pending','active','suspended','deleted'\)\)/)
  })

  it("seeds org_creation_requires_approval = true idempotently", () => {
    expect(sql).toMatch(/INSERT INTO app_settings \(key, value\)\s+VALUES \('org_creation_requires_approval', 'true'::jsonb\)\s+ON CONFLICT \(key\) DO NOTHING;/)
  })
})

describe("332_orgs_foundations — invitations", () => {
  it("a workspace invitation cannot point at another organization's workspace", () => {
    expect(tableBlock("invitations")).toMatch(/FOREIGN KEY \(workspace_id, org_id\) REFERENCES workspaces\(id, org_id\) ON DELETE CASCADE/)
  })

  it("the escalation guard fires on INSERT and on UPDATE of the guarded columns", () => {
    expect(sql).toMatch(/BEFORE INSERT OR UPDATE OF org_role, invited_by, org_id ON invitations/)
  })

  it("the invitee policy normalizes the profile email", () => {
    expect(sql).toMatch(/email = lower\(\(SELECT p\.email FROM profiles p WHERE p\.id = \(select auth\.uid\(\)\)\)\)/)
  })
})

describe("332_orgs_foundations — transfer_org_ownership", () => {
  const start = sql.indexOf("FUNCTION transfer_org_ownership")
  const open = sql.indexOf("$$", start)
  const body = sql.slice(start, sql.indexOf("$$;", open + 2))

  it("demotes the old owner BY ROLE before promoting the new one (single-owner index, drift-healing)", () => {
    const demote = body.indexOf("SET role = 'admin'")
    const promote = body.indexOf("SET role = 'owner'")
    const pointer = body.indexOf("SET owner_user_id = p_new_owner_id")
    expect(demote).toBeGreaterThan(0)
    expect(promote).toBeGreaterThan(demote)
    expect(pointer).toBeGreaterThan(promote)
    expect(body).toMatch(/SET role = 'admin'\s+WHERE org_id = p_org_id AND role = 'owner'/)
  })

  it("locks with FOR NO KEY UPDATE and re-checks every precondition with a stable error prefix", () => {
    expect(body).toMatch(/FROM organizations WHERE id = p_org_id FOR NO KEY UPDATE/)
    expect(body).not.toMatch(/FOR UPDATE\b/)
    for (const prefix of ["ORG_NOT_FOUND", "ORG_NOT_TRANSFERABLE", "NOT_OWNER", "SAME_OWNER", "ACTOR_SUSPENDED", "TARGET_NOT_MEMBER", "TARGET_NOT_ADMIN", "TARGET_SUSPENDED"]) {
      expect(body, `missing ${prefix} guard`).toMatch(new RegExp(`RAISE EXCEPTION '${prefix}:`))
    }
  })
})

describe("332_orgs_foundations — join-code CHECK", () => {
  it("is the pinned format", () => {
    const m = sql.match(/code\s+text NOT NULL UNIQUE CHECK \(code ~ '([^']+)'\)/)
    expect(m).toBeTruthy()
    expect(m![1]).toBe(EXPECTED_JOIN_CODE_PATTERN)
  })
})
