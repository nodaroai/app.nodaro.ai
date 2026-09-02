/**
 * Grants guard for EVERY organizations-axis migration.
 *
 * Every SECURITY DEFINER function on this axis must pin `search_path` and be
 * revoked from PUBLIC *and* anon (Supabase grants anon through default
 * privileges, so `FROM PUBLIC` alone leaves an anonymous oracle), and then be
 * one of exactly two things: an RLS-facing helper granted to `authenticated`,
 * or a mutating RPC granted to `service_role` only. A function that is
 * neither — or a migration this file does not know — fails here, so a new
 * organizations migration cannot ship an unclassified definer.
 *
 * The per-file invariants (kind presets, the transfer RPC's ordering, CHECK
 * enums) stay in the file-specific guards; this one is the family rule.
 */
import { readdirSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { describe, expect, it } from "vitest"

const MIGRATIONS_DIR = join(__dirname, "..", "..", "..", "supabase", "migrations")

/** Which functions each organizations migration defines, and for whom. */
const CLASSIFICATION: Record<string, { authenticated: string[]; serviceRole: string[] }> = {
  "332_orgs_foundations.sql": {
    authenticated: ["effective_setting", "org_member_status", "org_role", "workspace_member_status", "workspace_role", "ws_setting_bool"],
    serviceRole: ["transfer_org_ownership"],
  },
  "333_orgs_invitation_rpcs.sql": {
    authenticated: [],
    serviceRole: ["accept_invitation", "join_workspace_by_code"],
  },
  // Content scoping, part a: columns, indexes, an RLS-locked table and one
  // trigger function. `reject_self_collaborator` IS a definer, but the
  // classification covers non-trigger definers only (a trigger function is
  // reached through its table's grants, not its own), so both lists are empty;
  // the entry exists so the on-disk-vs-classified check stays exact. Its
  // search_path pin is asserted like every other definer's.
  "335_orgs_content_columns.sql": {
    authenticated: [],
    serviceRole: [],
  },
  // Content scoping, part c: the access rule, the two column-pinning checks,
  // and the autosave RPC restated with its one changed line. access_rank is
  // NOT here — plain SQL, not a definer. apply_workflow_delta is also granted
  // to service_role (the backend calls it with the service client); the
  // authenticated-shape assertions require their three lines and permit that.
  "338_orgs_content_rls.sql": {
    authenticated: [
      "apply_workflow_delta",
      "check_projects_update_allowed",
      "check_workflows_update_allowed",
      "workflow_access",
    ],
    serviceRole: [],
  },
  // P9: the personal-space gate. org_setting is the organization-level twin
  // of 332s effective_setting and gates on membership, so authenticated may
  // call it. personal_space_enabled_for takes a USER id, so it is service_role
  // only — granted broadly it answers "does user X belong to an organization
  // that disabled the personal space" for anyone who asks. kind_preset is
  // restated here but is plain SQL, not a definer, so it is not classified.
  "340_orgs_personal_space.sql": {
    authenticated: ["ensure_default_project", "org_setting"],
    serviceRole: ["personal_space_enabled_for"],
  },
  // P9: a workspace gets its landing project in one transaction. The function
  // performs no authorization of its own — the plugin route does that before
  // calling it — so it must never be reachable by a client.
  "341_orgs_workspace_project.sql": {
    authenticated: [],
    serviceRole: ["create_workspace_with_project"],
  },
  // P12: the billing schema and RPCs. Every function here is a mutating
  // credit operation called with the service client only — nothing is an
  // RLS-facing helper (the three new tables have plain SELECT policies
  // instead). reserve/commit/refund are the long-standing credit RPCs
  // restated with their workspace branch (personal bodies verbatim, pins
  // hardened to pg_temp); the other five are new.
  "351_orgs_billing.sql": {
    authenticated: [],
    serviceRole: [
      "allocate_workspace_credits",
      "claw_back_org_credits",
      "commit_credits",
      "grant_org_credits_idempotent",
      "refund_credits",
      "reserve_credits",
      "reset_member_spend",
      "set_member_credit_cap",
    ],
  },
  // P14: the payer-aware markup. One function, restated from 083/173 with the
  // workspace fork and a FRESH full grant block (083/173 predate the
  // convention — they only revoked authenticated/anon, and the old signature's
  // grants died with the DROP).
  "352_orgs_app_monetization_payer.sql": {
    authenticated: [],
    serviceRole: ["process_app_monetization"],
  },
  // Content scoping, part b: backfills and four trigger functions. Three are
  // SECURITY DEFINER (they read projects / organizations past the caller's
  // RLS); all four return trigger, so none is classified — a trigger function
  // is reached through its table's grants, never called from PostgREST. Their
  // search_path pins are asserted like every other definer's.
  "337_orgs_content_triggers.sql": {
    authenticated: [],
    serviceRole: [],
  },
  // P15: reporting over usage_logs (346: browser-unreadable) and the variance
  // ledger rows. Read-only, service-role only — the plugin route authorizes
  // (org admin+ / workspace role) and relays; nothing here is an RLS helper.
  "369_orgs_usage_reporting.sql": {
    authenticated: [],
    serviceRole: ["org_usage_report", "org_usage_rows", "org_usage_variance", "org_usage_window"],
  },
}

const orgMigrations = readdirSync(MIGRATIONS_DIR)
  .filter((f) => /^\d+_orgs[_-].*\.sql$/.test(f))
  .sort()

interface DefinerFn {
  name: string
  args: string
  returnsTrigger: boolean
  pinsSearchPath: boolean
  namesTempSchema: boolean
}

/**
 * Migrations whose definers pin `search_path = public` without naming
 * `pg_temp`. Left unnamed, the temp schema is searched FIRST for relation
 * names, so a caller who can create a temporary table shadows any table the
 * function reads. These two were applied to production before the rule; they
 * can only be hardened by a later CREATE OR REPLACE, not by an edit. The set
 * may only shrink — a new migration belongs nowhere in it.
 */
const TEMP_SCHEMA_EXCEPTIONS: ReadonlySet<string> = new Set([
  "332_orgs_foundations.sql",
  "333_orgs_invitation_rpcs.sql",
])

function definers(sql: string): DefinerFn[] {
  return sql
    .split(/CREATE OR REPLACE FUNCTION\s+/)
    .slice(1)
    .map((chunk) => {
      const header = chunk.slice(0, chunk.indexOf("$$"))
      return {
        // The optional schema prefix matters: 338 declares
        // `public.apply_workflow_delta` (restating 219 verbatim), and a parser
        // that cannot see past `public.` reports a definer named "" — which
        // then fails the classification with a phantom function.
        name: chunk.match(/^(?:public\.)?(\w+)\s*\(/)?.[1] ?? "",
        args: chunk.match(/^(?:public\.)?\w+\s*\(([^)]*)\)/)?.[1] ?? "",
        returnsTrigger: /RETURNS\s+trigger/i.test(header),
        definer: /SECURITY DEFINER/i.test(header),
        pinsSearchPath: /SET search_path = public/.test(header),
        namesTempSchema: /SET search_path = public\s*,\s*pg_temp/.test(header),
      }
    })
    .filter((f) => f.definer)
}

function signature(fn: DefinerFn): { sig: string; escaped: string } {
  const argTypes = fn.args
    .split(",")
    .map((a) => a.trim().split(/\s+/)[1])
    .join(", ")
  const sig = `public.${fn.name}(${argTypes})`
  // [ and ] must be escaped too: `text[]` in a signature would otherwise
  // become an EMPTY character class in the built regex, which matches nothing
  // — the assertion for any array-taking definer would fail against a
  // perfectly correct migration. Latent until 338 classified one.
  return { sig, escaped: sig.replace(/[.()[\]]/g, "\\$&") }
}

describe("organizations migrations — every SECURITY DEFINER function has explicit grants", () => {
  it("every organizations migration on disk is classified here", () => {
    expect(orgMigrations.length).toBeGreaterThan(0)
    expect(orgMigrations.filter((f) => !CLASSIFICATION[f])).toEqual([])
  })

  it("every classified migration exists on disk", () => {
    expect(Object.keys(CLASSIFICATION).filter((f) => !orgMigrations.includes(f))).toEqual([])
  })

  describe.each(orgMigrations.map((f) => [f] as const))("%s", (file) => {
    const sql = readFileSync(join(MIGRATIONS_DIR, file), "utf8").replace(/--[^\n]*/g, "")
    const fns = definers(sql)
    const expected = CLASSIFICATION[file] ?? { authenticated: [], serviceRole: [] }

    it("every SECURITY DEFINER function pins search_path", () => {
      expect(fns.filter((f) => !f.pinsSearchPath).map((f) => f.name)).toEqual([])
    })

    it("every SECURITY DEFINER function names pg_temp, so no temp table can shadow its reads", () => {
      const offenders = TEMP_SCHEMA_EXCEPTIONS.has(file)
        ? []
        : fns.filter((f) => !f.namesTempSchema).map((f) => f.name)
      expect(offenders).toEqual([])
    })

    it("every non-trigger SECURITY DEFINER function is classified, and nothing classified is missing", () => {
      expect(fns.filter((f) => !f.returnsTrigger).map((f) => f.name).sort()).toEqual(
        [...expected.authenticated, ...expected.serviceRole].sort(),
      )
    })

    for (const fn of fns.filter((f) => expected.authenticated.includes(f.name))) {
      it(`${fn.name} — REVOKE FROM PUBLIC, REVOKE FROM anon, GRANT TO authenticated`, () => {
        const { sig, escaped } = signature(fn)
        expect(sql, `${sig} must be revoked from PUBLIC`).toMatch(new RegExp(`REVOKE EXECUTE ON FUNCTION ${escaped} FROM PUBLIC;`))
        expect(sql, `${sig} must be revoked from anon`).toMatch(new RegExp(`REVOKE EXECUTE ON FUNCTION ${escaped} FROM anon;`))
        expect(sql, `${sig} must be granted to authenticated`).toMatch(new RegExp(`GRANT\\s+EXECUTE ON FUNCTION ${escaped} TO authenticated;`))
      })
    }

    for (const fn of fns.filter((f) => expected.serviceRole.includes(f.name))) {
      it(`${fn.name} — REVOKE FROM PUBLIC, anon AND authenticated; GRANT TO service_role only`, () => {
        const { sig, escaped } = signature(fn)
        for (const role of ["PUBLIC", "anon", "authenticated"]) {
          expect(sql, `${sig} must be revoked from ${role}`).toMatch(new RegExp(`REVOKE EXECUTE ON FUNCTION ${escaped} FROM ${role};`))
        }
        expect(sql, `${sig} must be granted to service_role`).toMatch(new RegExp(`GRANT\\s+EXECUTE ON FUNCTION ${escaped} TO service_role;`))
        expect(sql, `${sig} must NOT be granted to authenticated`).not.toMatch(new RegExp(`GRANT\\s+EXECUTE ON FUNCTION ${escaped} TO authenticated;`))
      })
    }
  })
})

describe("333_orgs_invitation_rpcs — the RAISE prefixes the routes map", () => {
  const sql = readFileSync(join(MIGRATIONS_DIR, "333_orgs_invitation_rpcs.sql"), "utf8")

  it("both functions resolve name clashes between their OUT columns and table columns in favour of the column", () => {
    // RETURNS TABLE (org_id, workspace_id) declares OUT variables named like
    // the columns the bodies write; without the pragma, `ON CONFLICT
    // (org_id, user_id)` is ambiguous and the function fails at its first
    // successful call (found on a real Postgres, 2026-08-23).
    const pragmas = sql.match(/#variable_conflict use_column/g) ?? []
    expect(pragmas).toHaveLength(2)
  })

  it("accept_invitation signals every refusal with a stable prefix and lets auth.uid() win", () => {
    const body = sql.slice(sql.indexOf("FUNCTION accept_invitation"), sql.indexOf("FUNCTION join_workspace_by_code"))
    // NO_USER is unreachable from the behavior proof — the service role
    // always supplies a uid — so this text guard is the only thing keeping
    // the null check from being dropped.
    for (const prefix of ["NO_USER:", "INVITATION_NOT_FOUND:", "INVITATION_REVOKED:", "INVITATION_ACCEPTED:", "INVITATION_EXPIRED:", "EMAIL_MISMATCH:", "ORG_NOT_ACTIVE:"]) {
      expect(body, prefix).toContain(`RAISE EXCEPTION '${prefix}`)
    }
    expect(body).toContain("COALESCE(auth.uid(), p_user_id)")
    expect(body).toContain("FOR UPDATE")
    // Consumed even when the membership rows already exist.
    expect(body).toContain("ON CONFLICT (org_id, user_id) DO NOTHING")
    expect(body).toContain("SET accepted_at = now(), accepted_by = v_uid")
  })

  it("join_workspace_by_code refuses a suspended member and an unlisted domain, and never promotes", () => {
    const body = sql.slice(sql.indexOf("FUNCTION join_workspace_by_code"))
    for (const prefix of ["NO_USER:", "JOIN_CODE_INVALID:", "ORG_NOT_ACTIVE:", "DOMAIN_NOT_ALLOWED:", "MEMBER_SUSPENDED:"]) {
      expect(body, prefix).toContain(`RAISE EXCEPTION '${prefix}`)
    }
    expect(body).toContain("COALESCE(auth.uid(), p_user_id)")
    expect(body).toContain("FOR UPDATE OF jc")
    expect(body).toContain("VALUES (v_org_id, v_uid, 'member', 'active')")
    expect(body).toContain("VALUES (v_ws_id, v_org_id, v_uid, 'member', 'active')")
  })
})
